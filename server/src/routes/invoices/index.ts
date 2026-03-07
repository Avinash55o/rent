import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { adminMiddleware, authMiddleware } from "../../middlewares/auth.middleware";
import { invoices, tenantProfiles } from "../../db/schema";
import type { HonoEnv } from "../../types";

export const invoiceRouter = new Hono<HonoEnv>();
invoiceRouter.use("*", authMiddleware);

// schemas

const createInvoiceSchema = z.object({
    tenantId: z.uuid(),
    billingMonth: z.iso.date(),
    amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
    dueDate: z.iso.date(),
    graceLastDate: z.iso.date().optional(),
});

const updateInvoiceSchema = z.object({
    status: z.enum(["pending", "paid", "overdue"]).optional(),
    dueDate: z.iso.date().optional(),
    graceLastDate: z.iso.date().optional(),
    amount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
});

// routes

// GET /invoices
invoiceRouter.get("/", adminMiddleware, async (c) => {
    const db = c.get("db");
    const status = c.req.query("status") as "pending" | "paid" | "overdue" | undefined;
    const tenantId = c.req.query("tenantId");
    const from = c.req.query("from");
    const to = c.req.query("to");

    const conditions = [];
    if (status) conditions.push(eq(invoices.status, status));
    if (tenantId) conditions.push(eq(invoices.tenantId, tenantId));
    if (from) conditions.push(eq(invoices.billingMonth, from));
    if (to) conditions.push(eq(invoices.billingMonth, to));

    const rows = await db.query.invoices.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        orderBy: desc(invoices.billingMonth),
        with: { tenantProfile: true },
    });

    return c.json({ invoices: rows });
});


// GET /invoices/:id
invoiceRouter.get("/:id", async (c) => {
    const db = c.get("db");
    const { role, tenantProfileId } = c.get("user");
    const id = c.req.param("id");

    const invoice = await db.query.invoices.findFirst({
        where: eq(invoices.id, id),
    });
    if (!invoice) return c.json({ error: "Invoice not found" }, 404);

    if (role === "tenant" && invoice.tenantId !== tenantProfileId) {
        return c.json({ error: "Forbidden" }, 403);
    }

    return c.json({ invoice });
});


// POST /invoices
invoiceRouter.post("/", adminMiddleware, zValidator("json", createInvoiceSchema), async (c) => {
    const db = c.get("db");
    const body = c.req.valid("json");

    const tenant = await db.query.tenantProfiles.findFirst({
        where: eq(tenantProfiles.id, body.tenantId),
    });
    if (!tenant) return c.json({ error: "Tenant not found" }, 404);

    const duplicate = await db.query.invoices.findFirst({
        where: and(
            eq(invoices.tenantId, body.tenantId),
            eq(invoices.billingMonth, body.billingMonth)
        ),
    });
    if (duplicate) return c.json({ error: "Invoice for this billing month already exists" }, 409);

    const [invoice] = await db.insert(invoices).values(body).returning();
    return c.json({ invoice }, 201);
});

// PATCH /invoices/:id
invoiceRouter.patch("/:id", adminMiddleware, zValidator("json", updateInvoiceSchema), async (c) => {
    const db = c.get("db");
    const id = c.req.param("id");
    const body = c.req.valid("json");

    const existing = await db.query.invoices.findFirst({
        where: eq(invoices.id, id),
    });
    if (!existing) return c.json({ error: "Invoice not found" }, 404);

    const [updated] = await db
        .update(invoices)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(invoices.id, id))
        .returning();

    return c.json({ invoice: updated });
});

// POST /invoices/bulk-generate
// generate invoices for all tenants for a given billing month
invoiceRouter.post("/bulk-generate", adminMiddleware, async (c) => {
    const db = c.get("db");
    const body: { billingMonth?: string, dueDate?: string, graceLastDate?: string } = await c.req.json();
    const { billingMonth, dueDate, graceLastDate } = body;

    if (!billingMonth || !dueDate) {
        return c.json({ error: "billingMonth and dueDate are required" }, 400);
    }

    const activeTenants = await db.query.tenantProfiles.findMany({
        where: eq(tenantProfiles.isActive, true),
    });

    const created = [];
    const skipped = [];

    for (const tenant of activeTenants) {
        const existing = await db.query.invoices.findFirst({
            where: and(
                eq(invoices.tenantId, tenant.id),
                eq(invoices.billingMonth, billingMonth)
            ),
        });

        if (existing) {
            skipped.push(tenant.id);
            continue;
        }

        const [invoice] = await db
            .insert(invoices)
            .values({
                tenantId: tenant.id,
                billingMonth,
                amount: tenant.rentAmount,
                dueDate,
                graceLastDate,
            })
            .returning();

        created.push(invoice);
    }

    return c.json({
        message: `Generated ${created.length} invoices, skipped ${skipped.length} existing`,
        created,
        skipped,
    });
});

// DELETE /invoices/:id
invoiceRouter.delete("/:id", adminMiddleware, async (c) => {
    const db = c.get("db");
    const id = c.req.param("id");

    const existing = await db.query.invoices.findFirst({
        where: eq(invoices.id, id),
    });
    if (!existing) return c.json({ error: "Invoice not found" }, 404);

    if (existing.status === "paid") {
        return c.json({ error: "Cannot delete a paid invoice" }, 400);
    }

    await db.delete(invoices).where(eq(invoices.id, id));
    return c.json({ message: "Invoice deleted" });
});