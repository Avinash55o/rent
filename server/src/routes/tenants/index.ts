import { Hono } from "hono";
import { adminMiddleware, authMiddleware } from "../../middlewares/auth.middleware";
import z from "zod";
import { invoices, payments, tenantProfiles, users } from "../../db/schema";
import { eq, desc } from "drizzle-orm";
import { zValidator } from "@hono/zod-validator";
import { hashPassword } from "../../lib/auth";
import { HonoEnv } from "../../types";

export const tenantsRouter = new Hono<HonoEnv>();
tenantsRouter.use("*", authMiddleware);

// schemas

const createTenantSchema = z.object({
    email: z.email(),
    name: z.string().min(1),
    phone: z.string().optional(),
    password: z.string().min(8).optional(),
    roomNumber: z.string().optional(),
    rentAmount: z.string().regex(/^\d+(\.\d{1,2})?$/),
    depositAmount: z.string().regex(/^\d+(\.\d{1,2})?$/),
    joinDate: z.iso.date(),
    nextDueDate: z.iso.date().optional(),
    graceLastDate: z.iso.date().optional(),
});

const updateTenantSchema = z.object({
    name: z.string().min(1).optional(),
    phone: z.string().optional(),
    roomNumber: z.string().optional(),
    rentAmount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
    depositAmount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
    nextDueDate: z.iso.date().optional(),
    graceLastDate: z.iso.date().optional(),
    isActive: z.boolean().optional(),
});

// GET /tenants
tenantsRouter.get("/", adminMiddleware, async (c) => {
    const db = c.get("db");
    const rows = await db
        .select({
            tenant: tenantProfiles,
            user: {
                id: users.id,
                email: users.email,
                name: users.name,
                phone: users.phone,
                role: users.role,
                createdAt: users.createdAt,
            },
        })
        .from(tenantProfiles)
        .innerJoin(users, eq(tenantProfiles.userId, users.id));

    return c.json({ tenants: rows });
});

// GET /tenants/:id
tenantsRouter.get("/:id", async (c) => {
    const db = c.get("db");
    const { userId, role, tenantProfileId } = c.get("user");
    const id = c.req.param("id");

    // tenants can only see their own profile
    if (role === "tenant" && tenantProfileId !== id) {
        return c.json({ error: "Forbidden" }, 403);
    }

    const row = await db
        .select({
            tenant: tenantProfiles,
            user: {
                id: users.id,
                email: users.email,
                name: users.name,
                phone: users.phone,
                role: users.role,
                createdAt: users.createdAt,
            },
        })
        .from(tenantProfiles)
        .innerJoin(users, eq(tenantProfiles.userId, users.id))
        .where(eq(tenantProfiles.id, id))
        .limit(1);

    if (!row.length) return c.json({ error: "Tenant not found" }, 404);
    return c.json(row[0]);
});

// POST /tenants
tenantsRouter.post("/", adminMiddleware, zValidator("json", createTenantSchema), async (c) => {
    const db = c.get("db");
    const body = c.req.valid("json");

    const existing = await db.query.users.findFirst({
        where: eq(users.email, body.email),
    });
    if (existing) return c.json({ error: "Email already in use" }, 409);

    const passwordHash = body.password ? await hashPassword(body.password) : undefined;

    const [user] = await db
        .insert(users)
        .values({
            email: body.email,
            name: body.name,
            phone: body.phone,
            passwordHash,
            role: "tenant",
        })
        .returning();

    const [tenant] = await db
        .insert(tenantProfiles)
        .values({
            userId: user.id,
            roomNumber: body.roomNumber,
            rentAmount: body.rentAmount,
            depositAmount: body.depositAmount,
            joinDate: body.joinDate,
            nextDueDate: body.nextDueDate,
            graceLastDate: body.graceLastDate,
        })
        .returning();

    return c.json({ tenant, user: sanitizeUser(user) }, 201);
});

// PATCH /tenants/:id
tenantsRouter.patch("/:id", adminMiddleware, zValidator("json", updateTenantSchema), async (c) => {
    const db = c.get("db");
    const id = c.req.param("id");
    const body = c.req.valid("json");

    const existing = await db.query.tenantProfiles.findFirst({
        where: eq(tenantProfiles.id, id),
    });
    if (!existing) return c.json({ error: "Tenant not found" }, 404);

    const { name, phone, ...profileFields } = body;

    // update user fields if provided
    if (name || phone) {
        await db
            .update(users)
            .set({ ...(name && { name }), ...(phone && { phone }), updatedAt: new Date() })
            .where(eq(users.id, existing.userId));
    }

    // update tenant profile
    const [updated] = await db
        .update(tenantProfiles)
        .set({ ...profileFields, updatedAt: new Date() })
        .where(eq(tenantProfiles.id, id))
        .returning();

    return c.json({ tenant: updated });
});

// DELETE /tenants/:id (soft delete)
tenantsRouter.delete("/:id", adminMiddleware, async (c) => {
    const db = c.get("db");
    const id = c.req.param("id");

    const existing = await db.query.tenantProfiles.findFirst({
        where: eq(tenantProfiles.id, id),
    });
    if (!existing) return c.json({ error: "Tenant not found" }, 404);

    await db
        .update(tenantProfiles)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(tenantProfiles.id, id));

    return c.json({ message: "Tenant deactivated" });
});

// GET /tenants/:id/invoices
tenantsRouter.get("/:id/invoices", async (c) => {
    const db = c.get("db");
    const { role, tenantProfileId } = c.get("user");
    const id = c.req.param("id");

    if (role === "tenant" && tenantProfileId !== id) {
        return c.json({ error: "Forbidden" }, 403);
    }

    const rows = await db.query.invoices.findMany({
        where: eq(invoices.tenantId, id),
        orderBy: desc(invoices.billingMonth),
    });

    return c.json({ invoices: rows });
});

// GET /tenants/:id/payments
tenantsRouter.get("/:id/payments", async (c) => {
    const db = c.get("db");
    const { role, tenantProfileId } = c.get("user");
    const id = c.req.param("id");

    if (role === "tenant" && tenantProfileId !== id) {
        return c.json({ error: "Forbidden" }, 403);
    }

    const rows = await db.query.payments.findMany({
        where: eq(payments.tenantId, id),
        orderBy: desc(payments.paidAt),
    });

    return c.json({ payments: rows });
});

// helpers 

export function sanitizeUser(user: typeof users.$inferSelect) {
    const { passwordHash, googleId, ...safe } = user;
    return safe;
}

