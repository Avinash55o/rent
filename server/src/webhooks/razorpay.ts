import { Hono } from "hono";
import { verifyWebhookSignature } from "../services/payment.service";
import { invoices, paymentAttempts, payments } from "../db/schema";
import { eq } from "drizzle-orm";
import type { AppDB, HonoEnv } from "../types";

export const webhookRouter = new Hono<HonoEnv>();

/**
 * Razorpay webhook endpoint.
 * Verifies signature and processes payment.captured / payment.failed events.
 */
webhookRouter.post("/razorpay", async (c) => {
    const db = c.get("db");
    const rawBody = await c.req.text();
    const signature = c.req.header("x-razorpay-signature") || "";

    if (!(await verifyWebhookSignature(rawBody, signature, c.env.RAZORPAY_WEBHOOK_SECRET))) {
        console.warn("[Webhook] Invalid Razorpay signature");
        return c.json({ error: "Invalid signature" }, 400);
    }

    let event: any;
    try {
        event = JSON.parse(rawBody);
    } catch {
        return c.json({ error: "Invalid JSON" }, 400);
    }

    const eventType: string = event.event;
    const paymentEntity = event.payload?.payment?.entity;

    console.log(`[Webhook] Received: ${eventType}`);

    if (eventType === "payment.captured") {
        await handlePaymentCaptured(paymentEntity, db);
    } else if (eventType === "payment.failed") {
        await handlePaymentFailed(paymentEntity, db);
    }
});

// handlers

async function handlePaymentCaptured(entity: any, db: AppDB) {
    const razorpayOrderId = entity.order_id;
    const razorpayPaymentId = entity.id;

    // find the pending attempt
    const attempt = await db.query.paymentAttempts.findFirst({
        where: eq(paymentAttempts.razorpayOrderId, razorpayOrderId),
    });

    if (!attempt) {
        console.warn(`[Webhook] No attempt found for order ${razorpayOrderId}`);
        return;
    }

    if (attempt.status === "success") {
        console.log(`[Webhook] Payment already captured for order ${razorpayOrderId}`);
        return;
    }

    const method = entity.method === "upi" ? "upi" : "card";

    // create payment record
    await db.insert(payments).values({
        tenantId: attempt.tenantId,
        invoiceId: attempt.invoiceId,
        amount: attempt.amount,
        paymentMethod: method,
        razorpayPaymentId,
        paidAt: new Date(entity.created_at * 1000),
    });

    // mark invoice as paid
    await db
        .update(invoices)
        .set({ status: "paid", updatedAt: new Date() })
        .where(eq(invoices.id, attempt.invoiceId));

    await db
        .update(paymentAttempts)
        .set({ status: "success", razorpayPaymentId, updatedAt: new Date() })
        .where(eq(paymentAttempts.id, attempt.id));

    console.log(`[Webhook] Payment captured for invoice ${attempt.invoiceId}`);
}

async function handlePaymentFailed(entity: any, db: AppDB) {
    const razorpayOrderId = entity.order_id;
    const razorpayPaymentId = entity.id;
    const failureReason = entity.error_description || "Payment failed";

    const attempt = await db.query.paymentAttempts.findFirst({
        where: eq(paymentAttempts.razorpayOrderId, razorpayOrderId),
    });

    if (!attempt) {
        console.warn(`[Webhook] No attempt found for failed order ${razorpayOrderId}`);
        return;
    }

    await db
        .update(paymentAttempts)
        .set({ status: "failed", razorpayPaymentId, failureReason, updatedAt: new Date() })
        .where(eq(paymentAttempts.id, attempt.id));

    console.log(`[Webhook] Payment failed for invoice ${attempt.invoiceId}: ${failureReason}`);
}