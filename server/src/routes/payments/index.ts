import { Hono } from "hono";
import { adminMiddleware, authMiddleware } from "../../middlewares/auth.middleware";
import z from "zod";
import { zValidator } from "@hono/zod-validator";
import { invoices, paymentAttempts, payments } from "../../db/schema";
import { eq, desc } from "drizzle-orm";
import { createPaymentOrder, verifyAndCapturePayment } from "../../services/payment.service";
import { HonoEnv } from "../../types";

export const paymentRouter = new Hono<HonoEnv>();
paymentRouter.use("*", authMiddleware);

// schemas

const createOrderSchema = z.object({
    invoiceId: z.uuid(),
});

const verifySchema = z.object({
    razorpayOrderId: z.string(),
    razorpayPaymentId: z.string(),
    razorpaySignature: z.string(),
    attemptId: z.uuid(),
});

// routes

// POST /payments/create-order
paymentRouter.post("/create-order", zValidator("json", createOrderSchema), async (c) => {
    const db = c.get("db");
    const { invoiceId } = c.req.valid("json");
    const { tenantProfileId, role } = c.get("user");

    if (role === "tenant" && !tenantProfileId) {
        return c.json({ error: "No tenant profile found" }, 400);
    }

    // Admins can create orders on behalf of any tenant; tenants only for themselves
    const invoice = await db.query.invoices.findFirst({
        where: eq(invoices.id, invoiceId),
    });
    if (!invoice) return c.json({ error: "Invoice not found" }, 404);

    const tenantId = role === "admin" ? invoice.tenantId : tenantProfileId!;

    if (role === "tenant" && invoice.tenantId !== tenantId) {
        return c.json({ error: "Forbidden" }, 403);
    }

    try {
        const order = await createPaymentOrder(db, c.env, invoiceId, tenantId);
        return c.json(order);
    } catch (err: any) {
        return c.json({ error: err.message }, 400);
    }
});

// POST /payments/verify
paymentRouter.post("/verify", zValidator("json", verifySchema), async (c) => {
    const db = c.get("db");
    const body = c.req.valid("json");

    try {
        await verifyAndCapturePayment(db, c.env, body);
        return c.json({ success: true, message: "Payment verified and recorded" });
    } catch (err: any) {
        return c.json({ error: err.message }, 400);
    }
});

// GET /payments
paymentRouter.get("/", adminMiddleware, async (c) => {
    const db = c.get("db");
    const rows = await db.query.payments.findMany({
        orderBy: desc(payments.paidAt),
    });

    return c.json({ payments: rows });
});

// GET /payments/:id
paymentRouter.get("/:id", async (c) => {
    const db = c.get("db");
    const { role, tenantProfileId } = c.get("user");
    const id = c.req.param("id");

    const payment = await db.query.payments.findFirst({
        where: eq(payments.id, id),
    });
    if (!payment) return c.json({ error: "Payment not found" }, 404);

    if (role === "tenant" && payment.tenantId !== tenantProfileId) {
        return c.json({ error: "Forbidden" }, 403);
    }

    return c.json({ payment });
});


// GET /payments/attempts/:invoiceId
paymentRouter.get("/attempts/:invoiceId", async (c) => {
    const db = c.get("db");
    const { role, tenantProfileId } = c.get("user");
    const invoiceId = c.req.param("invoiceId");

    const invoice = await db.query.invoices.findFirst({
        where: eq(invoices.id, invoiceId),
    });
    if (!invoice) return c.json({ error: "Invoice not found" }, 404);

    if (role === "tenant" && invoice.tenantId !== tenantProfileId) {
        return c.json({ error: "Forbidden" }, 403);
    }

    const attempts = await db.query.paymentAttempts.findMany({
        where: eq(paymentAttempts.invoiceId, invoiceId),
        orderBy: desc(paymentAttempts.createdAt),
    });

    return c.json({ attempts });
});