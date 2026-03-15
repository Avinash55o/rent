import { eq, and, desc, or } from "drizzle-orm";
import type { DrizzleDb } from "../db/client";
import { payments, bookings, users } from "../db/schema";
import { nowISO, generateReceiptNumber, verifyRazorpaySignature } from "../utils";
import { getSetting } from "./settings.service";
import { createRazorpayOrder } from "./razorpay.service";
import type { Payment } from "../db/schema";

// ─── Types ────────────────────────────────────────────────────

export interface InitiatePaymentResult {
    paymentId: number;
    razorpayOrderId: string;
    razorpayKeyId: string;
    amount: number;
    currency: string;
    tenantName: string;
    tenantEmail: string;
}

// ─── Service Functions ────────────────────────────────────────

/**
 * Step 1: Initiate online rent payment.
 * Creates a pending payment record + Razorpay order.
 * Returns info needed by frontend to open Razorpay checkout.
 */
export async function initiateRentPayment(
    db: DrizzleDb,
    tenantId: number,
    rentMonth: string,
    razorpayKeyId: string,
    razorpayKeySecret: string
): Promise<InitiatePaymentResult> {
    // Get active booking for this tenant
    const booking = await db
        .select()
        .from(bookings)
        .where(and(eq(bookings.tenantId, tenantId), eq(bookings.status, "active")))
        .get();

    if (!booking) throw new Error("No active booking found for this tenant");

    // Get tenant details (for Razorpay notes)
    const tenant = await db
        .select()
        .from(users)
        .where(eq(users.id, tenantId))
        .get();

    if (!tenant) throw new Error("Tenant not found");

    // Check for duplicate payment for same month
    const existing = await db
        .select()
        .from(payments)
        .where(
            and(
                eq(payments.tenantId, tenantId),
                eq(payments.rentMonth, rentMonth),
                eq(payments.status, "completed")
            )
        )
        .get();

    if (existing) throw new Error(`Rent for ${rentMonth} already paid`);

    // Calculate late fee
    // Late fee applies ONLY if:
    //   1. The rentMonth being paid for is the current month (or earlier)
    //   2. Today's day is past the rent due end day
    const lateFeeRaw = await getSetting(db, "late_fee_amount");
    const rentDueEndDay = parseInt(await getSetting(db, "rent_due_end_day"), 10);
    const dateNow = new Date();
    const currentMonth = `${dateNow.getUTCFullYear()}-${String(dateNow.getUTCMonth() + 1).padStart(2, "0")}`;
    const today = dateNow.getUTCDate();

    // Paying for current or past month AND past the due date
    const isLate = rentMonth <= currentMonth && today > rentDueEndDay;
    const lateFee = isLate ? parseFloat(lateFeeRaw) : 0;

    const totalAmount = booking.monthlyRent + lateFee;

    // Create Razorpay order
    const receiptNumber = generateReceiptNumber();
    const order = await createRazorpayOrder(razorpayKeyId, razorpayKeySecret, {
        amount: totalAmount,
        receipt: receiptNumber,
        notes: {
            tenantName: tenant.name,
            tenantEmail: tenant.email,
            rentMonth,
        },
    });

    // Create pending payment record in DB
    const now = nowISO();
    const result = await db
        .insert(payments)
        .values({
            tenantId,
            bookingId: booking.id,
            amount: totalAmount,
            type: "online",
            status: "pending",
            razorpayOrderId: order.id,
            rentMonth,
            lateFee,
            createdAt: now,
        })
        .returning({ id: payments.id })
        .get();

    if (!result) throw new Error("Failed to create payment record");

    return {
        paymentId: result.id,
        razorpayOrderId: order.id,
        razorpayKeyId,
        amount: totalAmount,
        currency: "INR",
        tenantName: tenant.name,
        tenantEmail: tenant.email,
    };
}

/**
 * Step 2: Verify payment after Razorpay checkout completes.
 * Validates the signature, then marks payment as completed.
 *
 * CRITICAL: Always verify signature before trusting any payment.
 */
export async function verifyAndCompletePayment(
    db: DrizzleDb,
    tenantId: number,
    razorpayOrderId: string,
    razorpayPaymentId: string,
    razorpaySignature: string,
    razorpayKeySecret: string
): Promise<Payment> {
    // Verify signature (prevents fake payment claims)
    const isValid = await verifyRazorpaySignature(
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature,
        razorpayKeySecret
    );

    if (!isValid) throw new Error("Invalid payment signature — possible fraud attempt");

    // Find the pending payment record
    const payment = await db
        .select()
        .from(payments)
        .where(
            and(
                eq(payments.razorpayOrderId, razorpayOrderId),
                eq(payments.tenantId, tenantId),
                eq(payments.status, "pending")
            )
        )
        .get();

    if (!payment) throw new Error("Payment record not found or already processed");

    // Mark as completed
    const now = nowISO();
    const updated = await db
        .update(payments)
        .set({
            status: "completed",
            razorpayPaymentId,
            razorpaySignature,
            paidAt: now,
        })
        .where(eq(payments.id, payment.id))
        .returning()
        .get();

    if (!updated) throw new Error("Failed to update payment record");

    // Update next rent due date on booking
    const nextMonth = getNextMonth(payment.rentMonth);
    await db
        .update(bookings)
        .set({ nextRentDueDate: `${nextMonth}-01` })
        .where(eq(bookings.id, payment.bookingId));

    return updated;
}

/**
 * Admin records a manual payment (cash / direct UPI outside website).
 */
export async function recordManualPayment(
    db: DrizzleDb,
    tenantId: number,
    amount: number,
    rentMonth: string,
    adminId: number,
    notes?: string
): Promise<Payment> {
    const booking = await db
        .select()
        .from(bookings)
        .where(and(eq(bookings.tenantId, tenantId), eq(bookings.status, "active")))
        .get();

    if (!booking) throw new Error("No active booking found for this tenant");

    // Check for duplicate manual payment for same month
    const existingPayment = await db
        .select({ id: payments.id })
        .from(payments)
        .where(
            and(
                eq(payments.tenantId, tenantId),
                eq(payments.rentMonth, rentMonth),
                eq(payments.status, "completed")
            )
        )
        .get();

    if (existingPayment) throw new Error(`Rent for ${rentMonth} already paid`);

    const now = nowISO();
    const result = await db
        .insert(payments)
        .values({
            tenantId,
            bookingId: booking.id,
            amount,
            type: "manual",
            status: "completed",
            rentMonth,
            lateFee: 0,
            notes: notes ?? `Manually recorded by admin ${adminId}`,
            paidAt: now,
            createdAt: now,
        })
        .returning()
        .get();

    if (!result) throw new Error("Failed to record manual payment");

    // Update next rent due date
    const nextMonth = getNextMonth(rentMonth);
    await db
        .update(bookings)
        .set({ nextRentDueDate: `${nextMonth}-01` })
        .where(eq(bookings.id, booking.id));

    return result;
}

/**
 * Get payment history for a tenant.
 * @param limit - Maximum number of payments to return (default: no limit)
 */
export async function getTenantPayments(
    db: DrizzleDb,
    tenantId: number,
    limit?: number
): Promise<Payment[]> {
    let query = db
        .select()
        .from(payments)
        .where(
            and(
                eq(payments.tenantId, tenantId),
                eq(payments.status, "completed")
            )
        )
        .orderBy(desc(payments.paidAt));

    if (limit) {
        query = query.limit(limit) as typeof query;
    }

    return query.all();
}

// ─── Helpers ──────────────────────────────────────────────────

/** Get next month in YYYY-MM format (e.g. "2025-06" → "2025-07") */
function getNextMonth(rentMonth: string): string {
    const [year, month] = rentMonth.split("-").map(Number) as [number, number];
    const date = new Date(year, month - 1 + 1, 1); // add 1 month
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
}

// ─── Webhook Handler ─────────────────────────────────────────

interface WebhookResult {
    success: boolean;
    error?: string;
}

/**
 * Handle Razorpay webhook events.
 * This is a backup verification in case client-side verification fails.
 * Razorpay sends events like "payment.captured" to this endpoint.
 */
export async function handleWebhookPayment(
    db: DrizzleDb,
    rawBody: string,
    signature: string,
    webhookSecret: string
): Promise<WebhookResult> {
    // Verify webhook signature using HMAC-SHA256
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(webhookSecret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );

    const expectedSigBuffer = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(rawBody)
    );

    const expectedSig = Array.from(new Uint8Array(expectedSigBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

    // Constant-time comparison to prevent timing attacks
    if (signature.length !== expectedSig.length) {
        return { success: false, error: "Invalid signature" };
    }

    let mismatch = 0;
    for (let i = 0; i < signature.length; i++) {
        mismatch |= signature.charCodeAt(i) ^ expectedSig.charCodeAt(i);
    }

    if (mismatch !== 0) {
        return { success: false, error: "Invalid signature" };
    }

    // Parse the webhook payload
    let event: {
        event: string;
        payload: {
            payment?: {
                entity: {
                    id: string;
                    order_id: string;
                    status: string;
                    amount: number;
                };
            };
        };
    };

    try {
        event = JSON.parse(rawBody);
    } catch {
        return { success: false, error: "Invalid JSON payload" };
    }

    // Handle payment.captured event
    if (event.event === "payment.captured") {
        const paymentEntity = event.payload.payment?.entity;
        if (!paymentEntity) {
            return { success: false, error: "Missing payment entity" };
        }

        const { id: razorpayPaymentId, order_id: razorpayOrderId } = paymentEntity;

        // Find the pending payment by order ID
        const payment = await db
            .select()
            .from(payments)
            .where(
                and(
                    eq(payments.razorpayOrderId, razorpayOrderId),
                    eq(payments.status, "pending")
                )
            )
            .get();

        if (!payment) {
            // Payment already processed or doesn't exist - that's okay
            return { success: true };
        }

        // Mark as completed
        const now = nowISO();
        await db
            .update(payments)
            .set({
                status: "completed",
                razorpayPaymentId,
                paidAt: now,
            })
            .where(eq(payments.id, payment.id));

        // Update next rent due date on booking
        const nextMonth = getNextMonth(payment.rentMonth);
        await db
            .update(bookings)
            .set({ nextRentDueDate: `${nextMonth}-01` })
            .where(eq(bookings.id, payment.bookingId));

        return { success: true };
    }

    // Handle payment.failed event
    if (event.event === "payment.failed") {
        const paymentEntity = event.payload.payment?.entity;
        if (!paymentEntity) {
            return { success: false, error: "Missing payment entity" };
        }

        const { order_id: razorpayOrderId } = paymentEntity;

        // Mark payment as failed
        await db
            .update(payments)
            .set({ status: "failed" })
            .where(
                and(
                    eq(payments.razorpayOrderId, razorpayOrderId),
                    eq(payments.status, "pending")
                )
            );

        return { success: true };
    }

    // Unknown event type - acknowledge receipt
    return { success: true };
}