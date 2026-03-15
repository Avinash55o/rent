/**
 * POST /api/complaints         → tenant: submit a complaint
 * GET  /api/complaints/my      → tenant: view own complaints
 * GET  /api/complaints         → admin: list all complaints
 * GET  /api/complaints/:id     → admin: get one complaint
 * PUT  /api/complaints/:id     → admin: update status + reply
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, desc } from "drizzle-orm";
import type { Env } from "../types/env";
import type { JwtPayload } from "../types/api";
import { ok, err } from "../types/api";
import { createDb } from "../db/client";
import { complaints, users } from "../db/schema";
import { createComplaintSchema, updateComplaintSchema } from "../validators";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { nowISO } from "../utils";

type Variables = { user: JwtPayload };

const complaintsRoute = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── POST /api/complaints — TENANT ───────────────────────────
complaintsRoute.post(
    "/",
    requireAuth(),
    zValidator("json", createComplaintSchema),
    async (c) => {
        const { sub: tenantId } = c.get("user");
        const { subject, message } = c.req.valid("json");
        const db = createDb(c.env.DB);

        const now = nowISO();
        const complaint = await db
            .insert(complaints)
            .values({ tenantId, subject, message, status: "open", createdAt: now, updatedAt: now })
            .returning()
            .get();

        if (!complaint) return c.json(err("Failed to submit complaint"), 500);

        return c.json(ok(complaint), 201);
    }
);

// ─── GET /api/complaints/my — TENANT ─────────────────────────
complaintsRoute.get("/my", requireAuth(), async (c) => {
    const { sub: tenantId } = c.get("user");
    const db = createDb(c.env.DB);

    const myComplaints = await db
        .select()
        .from(complaints)
        .where(eq(complaints.tenantId, tenantId))
        .orderBy(desc(complaints.createdAt))
        .all();

    return c.json(ok(myComplaints));
});

// ─── GET /api/complaints — ADMIN ─────────────────────────────
complaintsRoute.get("/", requireAdmin(), async (c) => {
    const db = createDb(c.env.DB);

    // Join with users to get tenant name
    const result = await db
        .select({
            id: complaints.id,
            subject: complaints.subject,
            message: complaints.message,
            status: complaints.status,
            adminReply: complaints.adminReply,
            createdAt: complaints.createdAt,
            updatedAt: complaints.updatedAt,
            tenantId: complaints.tenantId,
            tenantName: users.name,
            tenantEmail: users.email,
        })
        .from(complaints)
        .leftJoin(users, eq(complaints.tenantId, users.id))
        .orderBy(desc(complaints.createdAt))
        .all();

    return c.json(ok(result));
});

// ─── GET /api/complaints/:id — ADMIN ─────────────────────────
complaintsRoute.get("/:id", requireAdmin(), async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    if (isNaN(id)) return c.json(err("Invalid ID"), 400);

    const db = createDb(c.env.DB);
    const complaint = await db
        .select()
        .from(complaints)
        .where(eq(complaints.id, id))
        .get();

    if (!complaint) return c.json(err("Complaint not found"), 404);

    return c.json(ok(complaint));
});

// ─── PUT /api/complaints/:id — ADMIN ─────────────────────────
complaintsRoute.put(
    "/:id",
    requireAdmin(),
    zValidator("json", updateComplaintSchema),
    async (c) => {
        const id = parseInt(c.req.param("id"), 10);
        if (isNaN(id)) return c.json(err("Invalid ID"), 400);

        const body = c.req.valid("json");
        const db = createDb(c.env.DB);

        const updated = await db
            .update(complaints)
            .set({ ...body, updatedAt: nowISO() })
            .where(eq(complaints.id, id))
            .returning()
            .get();

        if (!updated) return c.json(err("Complaint not found"), 404);

        return c.json(ok(updated));
    }
);

export default complaintsRoute;