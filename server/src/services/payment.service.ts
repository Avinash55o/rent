import { eq } from "drizzle-orm";
import { invoices, paymentAttempts, payments } from "../db/schema";
import type { AppDB } from "../db/drizzle";
import type { Env } from "../types";

// ── Web Crypto HMAC-SHA256 helper ───────────────────
async function hmacSha256Hex(secret: string, data: string): Promise<string> {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw",
        enc.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
    return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Razorpay REST API helper ────────────────────────
async function razorpayFetch(
    env: Env,
    path: string,
    options: RequestInit = {}
): Promise<any> {
    const credentials = btoa(
        `${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`
    );

    const res = await fetch(`https://api.razorpay.com/v1${path}`, {
        ...options,
        headers: {
            Authorization: `Basic ${credentials}`,
            "Content-Type": "application/json",
            ...options.headers,
        },
    });

    if (!res.ok) {
        const error = await res.text();
        throw new Error(`Razorpay API error (${res.status}): ${error}`);
    }

    return res.json();
}

// ── Create Order ────────────────────────────────────
export interface CreateOrderResult {
    orderId: string;
    amount: number;
    currency: string;
    attemptId: string;
}

export async function createPaymentOrder(
    db: AppDB,
    env: Env,
    invoiceId: string,
    tenantId: string
): Promise<CreateOrderResult> {
    const invoice = await db.query.invoices.findFirst({
        where: eq(invoices.id, invoiceId),
    });

    if (!invoice) throw new Error("Invoice not found");
    if (invoice.status === "paid") throw new Error("Invoice already paid");
    if (invoice.tenantId !== tenantId)
        throw new Error("Invoice does not belong to this tenant");

    const amountInPaise = Math.round(Number(invoice.amount) * 100);

    // Razorpay REST API — POST /v1/orders
    const order = await razorpayFetch(env, "/orders", {
        method: "POST",
        body: JSON.stringify({
            amount: amountInPaise,
            currency: "INR",
            receipt: `inv_${invoiceId}`,
            notes: { invoiceId, tenantId },
        }),
    });

    const [attempt] = await db
        .insert(paymentAttempts)
        .values({
            tenantId,
            invoiceId,
            amount: invoice.amount,
            status: "pending",
            razorpayOrderId: order.id,
        })
        .returning();

    return {
        orderId: order.id,
        amount: amountInPaise,
        currency: "INR",
        attemptId: attempt.id,
    };
}

// ── Verify & Capture ────────────────────────────────
export async function verifyAndCapturePayment(
    db: AppDB,
    env: Env,
    params: {
        razorpayOrderId: string;
        razorpayPaymentId: string;
        razorpaySignature: string;
        attemptId: string;
    }
): Promise<void> {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature, attemptId }
        = params;

    // Verify signature using HMAC SHA256 (Web Crypto)
    const expected = await hmacSha256Hex(
        env.RAZORPAY_KEY_SECRET,
        `${razorpayOrderId}|${razorpayPaymentId}`
    );

    if (expected !== razorpaySignature) {
        await db
            .update(paymentAttempts)
            .set({
                status: "failed",
                failureReason: "Signature mismatch",
                updatedAt: new Date(),
            })
            .where(eq(paymentAttempts.id, attemptId));
        throw new Error("Payment signature verification failed");
    }

    const attempt = await db.query.paymentAttempts.findFirst({
        where: eq(paymentAttempts.id, attemptId),
    });
    if (!attempt) throw new Error("Payment attempt not found");

    // Fetch payment details — GET /v1/payments/:id
    const rzpPayment = await razorpayFetch(
        env, `/payments/${razorpayPaymentId}`
    );
    const method = rzpPayment.method === "upi" ? "upi" : "card";

    await db.insert(payments).values({
        tenantId: attempt.tenantId,
        invoiceId: attempt.invoiceId,
        amount: attempt.amount,
        paymentMethod: method,
        razorpayPaymentId,
        paidAt: new Date(),
    });

    await db
        .update(invoices)
        .set({ status: "paid", updatedAt: new Date() })
        .where(eq(invoices.id, attempt.invoiceId));

    await db
        .update(paymentAttempts)
        .set({
            status: "success",
            razorpayPaymentId,
            updatedAt: new Date(),
        })
        .where(eq(paymentAttempts.id, attemptId));
}

// ── Webhook signature verification ──────────────────
export async function verifyWebhookSignature(
    body: string,
    signature: string,
    secret: string
): Promise<boolean> {
    const expected = await hmacSha256Hex(secret, body);
    return expected === signature;
}