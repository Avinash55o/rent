/**
 * POST /api/payments/initiate         → tenant: create Razorpay order for rent
 * POST /api/payments/verify           → tenant: verify payment + mark as complete
 * GET  /api/payments/my               → tenant: get payment history
 * GET  /api/payments/my/:id/receipt   → tenant: get receipt data for a payment
 * POST /api/payments/manual           → admin: record manual (cash/UPI) payment
 * GET  /api/payments                  → admin: list all payments
 * GET  /api/payments/tenant/:tenantId → admin: get payments for a specific tenant
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, and, desc } from "drizzle-orm";
import type { Env } from "../types/env";
import type { JwtPayload } from "../types/api";
import { ok, err } from "../types/api";
import { createDb } from "../db/client";
import { payments, bookings, users, beds, rooms } from "../db/schema";
import {
    initiatePaymentSchema,
    verifyPaymentSchema,
    manualPaymentSchema,
} from "../validators";
import { requireAuth, requireAdmin } from "../middleware/auth";
import {
    initiateRentPayment,
    verifyAndCompletePayment,
    recordManualPayment,
    getTenantPayments,
} from "../services/payment.service";

type Variables = { user: JwtPayload };

const paymentsRoute = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── POST /api/payments/initiate — TENANT ────────────────────
paymentsRoute.post(
    "/initiate",
    requireAuth(),
    zValidator("json", initiatePaymentSchema),
    async (c) => {
        const { sub: tenantId } = c.get("user");
        const { rentMonth } = c.req.valid("json");

        try {
            const result = await initiateRentPayment(
                createDb(c.env.DB),
                tenantId,
                rentMonth,
                c.env.RAZORPAY_KEY_ID,
                c.env.RAZORPAY_KEY_SECRET
            );
            return c.json(ok(result), 201);
        } catch (e) {
            const message = e instanceof Error ? e.message : "Payment initiation failed";
            return c.json(err(message), 400);
        }
    }
);

// ─── POST /api/payments/verify — TENANT ──────────────────────
paymentsRoute.post(
    "/verify",
    requireAuth(),
    zValidator("json", verifyPaymentSchema),
    async (c) => {
        const { sub: tenantId } = c.get("user");
        const { razorpayOrderId, razorpayPaymentId, razorpaySignature } =
            c.req.valid("json");

        try {
            const payment = await verifyAndCompletePayment(
                createDb(c.env.DB),
                tenantId,
                razorpayOrderId,
                razorpayPaymentId,
                razorpaySignature,
                c.env.RAZORPAY_KEY_SECRET
            );
            return c.json(ok({ message: "Payment successful!", payment }));
        } catch (e) {
            const message = e instanceof Error ? e.message : "Payment verification failed";
            return c.json(err(message), 400);
        }
    }
);

// ─── GET /api/payments/my — TENANT ───────────────────────────
paymentsRoute.get("/my", requireAuth(), async (c) => {
    const { sub: tenantId } = c.get("user");
    const db = createDb(c.env.DB);

    const history = await getTenantPayments(db, tenantId);
    return c.json(ok(history));
});

// ─── GET /api/payments/my/:id/receipt — TENANT ───────────────
// Returns structured data for receipt generation
// The actual PDF is generated client-side or via a separate endpoint
paymentsRoute.get("/my/:id/receipt", requireAuth(), async (c) => {
    const { sub: tenantId } = c.get("user");
    const paymentId = parseInt(c.req.param("id"), 10);

    if (isNaN(paymentId)) return c.json(err("Invalid payment ID"), 400);

    const db = createDb(c.env.DB);

    // Get payment (ensure it belongs to this tenant)
    const payment = await db
        .select()
        .from(payments)
        .where(and(eq(payments.id, paymentId), eq(payments.tenantId, tenantId)))
        .get();

    if (!payment) return c.json(err("Payment not found"), 404);

    // Get tenant info
    const tenant = await db
        .select({ id: users.id, name: users.name, email: users.email, phone: users.phone })
        .from(users)
        .where(eq(users.id, tenantId))
        .get();

    // Get booking → bed → room for the receipt
    const booking = await db
        .select()
        .from(bookings)
        .where(eq(bookings.id, payment.bookingId))
        .get();

    const bed = booking
        ? await db.select().from(beds).where(eq(beds.id, booking.bedId)).get()
        : null;

    const room = bed
        ? await db.select().from(rooms).where(eq(rooms.id, bed.roomId)).get()
        : null;

    // Return structured receipt data
    // Frontend uses this to render / generate PDF
    return c.json(
        ok({
            receiptNumber: `RCP-${payment.id.toString().padStart(6, "0")}`,
            tenant,
            room: room?.name ?? "N/A",
            bed: bed?.name ?? "N/A",
            rentMonth: payment.rentMonth,
            rentAmount: payment.amount - payment.lateFee,
            lateFee: payment.lateFee,
            totalAmount: payment.amount,
            paymentType: payment.type,
            paidAt: payment.paidAt,
            razorpayPaymentId: payment.razorpayPaymentId,
        })
    );
});

// ─── POST /api/payments/manual — ADMIN ───────────────────────
paymentsRoute.post(
    "/manual",
    requireAdmin(),
    zValidator("json", manualPaymentSchema),
    async (c) => {
        const { sub: adminId } = c.get("user");
        const { tenantId, amount, rentMonth, notes } = c.req.valid("json");

        try {
            const payment = await recordManualPayment(
                createDb(c.env.DB),
                tenantId,
                amount,
                rentMonth,
                adminId,
                notes
            );
            return c.json(ok(payment), 201);
        } catch (e) {
            const message = e instanceof Error ? e.message : "Failed to record payment";
            return c.json(err(message), 400);
        }
    }
);

// ─── GET /api/payments — ADMIN ────────────────────────────────
paymentsRoute.get("/", requireAdmin(), async (c) => {
    const db = createDb(c.env.DB);

    const allPayments = await db
        .select()
        .from(payments)
        .orderBy(desc(payments.createdAt))
        .all();

    return c.json(ok(allPayments));
});

// ─── GET /api/payments/tenant/:tenantId — ADMIN ───────────────
paymentsRoute.get("/tenant/:tenantId", requireAdmin(), async (c) => {
    const tenantId = parseInt(c.req.param("tenantId"), 10);
    if (isNaN(tenantId)) return c.json(err("Invalid tenant ID"), 400);

    const db = createDb(c.env.DB);
    const history = await getTenantPayments(db, tenantId);

    return c.json(ok(history));
});

export default paymentsRoute;