/**
 * GET  /api/admin/dashboard          → overview stats
 * GET  /api/admin/tenants            → list all tenants with booking info
 * GET  /api/admin/tenants/:id        → full tenant profile
 * PUT  /api/admin/tenants/:id/rent   → update rent (single or all tenants)
 * PUT  /api/admin/tenants/:id/deactivate → deactivate tenant account
 * GET  /api/admin/settings           → get all settings
 * PUT  /api/admin/settings           → update settings
 * GET  /api/admin/export/payments    → export payments CSV
 * GET  /api/admin/export/tenants     → export tenants CSV
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, and, desc, count, like, or, sql } from "drizzle-orm";
import type { Env } from "../types/env";
import type { JwtPayload } from "../types/api";
import { ok, err } from "../types/api";
import { createDb } from "../db/client";
import { users, bookings, beds, rooms, payments, deposits, complaints } from "../db/schema";
import { updateRentSchema, updateSettingsSchema, adminCreateTenantSchema, paginationSchema, type PaginatedResponse } from "../validators";
import { requireAdmin } from "../middleware/auth";
import { adminDeleteRateLimit } from "../middleware/rateLimit";
import { getAllSettings, updateSettings } from "../services/settings.service";
import { getTenantPayments } from "../services/payment.service";
import { omit, hashPassword, nowISO, escapeCSV } from "../utils";

type Variables = { user: JwtPayload };

const adminRoute = new Hono<{ Bindings: Env; Variables: Variables }>();

// All admin routes require admin role
adminRoute.use("*", requireAdmin());

// ─── GET /api/admin/dashboard ─────────────────────────────────
adminRoute.get("/dashboard", async (c) => {
    const db = createDb(c.env.DB);

    // Parallel queries for efficiency (Promise.all)
    const [
        totalBeds,
        occupiedBeds,
        reservedBeds,
        totalTenants,
        overduePayments,
    ] = await Promise.all([
        db.select({ count: count() }).from(beds).get(),
        db.select({ count: count() }).from(beds).where(eq(beds.status, "occupied")).get(),
        db.select({ count: count() }).from(beds).where(eq(beds.status, "reserved")).get(),
        db.select({ count: count() }).from(users).where(eq(users.role, "tenant")).get(),
        // Payments where current month rent isn't paid yet
        db
            .select({ count: count() })
            .from(bookings)
            .where(eq(bookings.status, "active"))
            .get(),
    ]);

    return c.json(
        ok({
            beds: {
                total: totalBeds?.count ?? 0,
                occupied: occupiedBeds?.count ?? 0,
                reserved: reservedBeds?.count ?? 0,
                available: (totalBeds?.count ?? 0) - (occupiedBeds?.count ?? 0) - (reservedBeds?.count ?? 0),
            },
            tenants: {
                total: totalTenants?.count ?? 0,
                activeBookings: overduePayments?.count ?? 0,
            },
        })
    );
});

// ─── GET /api/admin/tenants ───────────────────────────────────
// Supports pagination: ?page=1&limit=20&search=john
adminRoute.get("/tenants", zValidator("query", paginationSchema), async (c) => {
    const { page, limit, search } = c.req.valid("query");
    const db = createDb(c.env.DB);
    const offset = (page - 1) * limit;

    // Build search condition if search term provided
    const searchCondition = search
        ? or(
            like(users.name, `%${search}%`),
            like(users.email, `%${search}%`),
            like(users.phone, `%${search}%`)
        )
        : undefined;

    // Get total count for pagination
    const totalResult = await db
        .select({ count: count() })
        .from(users)
        .where(searchCondition ? and(eq(users.role, "tenant"), searchCondition) : eq(users.role, "tenant"))
        .get();
    const total = totalResult?.count ?? 0;

    // Get paginated tenants with their active booking + bed + room info
    const tenantList = await db
        .select({
            id: users.id,
            name: users.name,
            email: users.email,
            phone: users.phone,
            isActive: users.isActive,
            createdAt: users.createdAt,
            bookingId: bookings.id,
            bookingStatus: bookings.status,
            monthlyRent: bookings.monthlyRent,
            moveInDate: bookings.moveInDate,
            nextRentDueDate: bookings.nextRentDueDate,
            bedName: beds.name,
            roomName: rooms.name,
        })
        .from(users)
        .where(searchCondition ? and(eq(users.role, "tenant"), searchCondition) : eq(users.role, "tenant"))
        .leftJoin(
            bookings,
            and(eq(bookings.tenantId, users.id), eq(bookings.status, "active"))
        )
        .leftJoin(beds, eq(beds.id, bookings.bedId))
        .leftJoin(rooms, eq(rooms.id, beds.roomId))
        .orderBy(desc(users.createdAt))
        .limit(limit)
        .offset(offset)
        .all();

    const totalPages = Math.ceil(total / limit);

    const response: PaginatedResponse<typeof tenantList[0]> = {
        data: tenantList,
        pagination: {
            page,
            limit,
            total,
            totalPages,
            hasNext: page < totalPages,
            hasPrev: page > 1,
        },
    };

    return c.json(ok(response));
});

// ─── GET /api/admin/tenants/:id ───────────────────────────────
// Full profile: user + booking + deposit + payment history + complaints
// Optimized: Uses JOINs to reduce queries from 7+ to 3
adminRoute.get("/tenants/:id", async (c) => {
    const tenantId = parseInt(c.req.param("id"), 10);
    if (isNaN(tenantId)) return c.json(err("Invalid tenant ID"), 400);

    const db = createDb(c.env.DB);

    // Single query with JOINs for tenant + active booking + bed + room + deposit
    const tenantWithBooking = await db
        .select({
            // User fields
            id: users.id,
            name: users.name,
            email: users.email,
            phone: users.phone,
            role: users.role,
            isActive: users.isActive,
            googleId: users.googleId,
            createdAt: users.createdAt,
            // Booking fields
            bookingId: bookings.id,
            bookingStatus: bookings.status,
            monthlyRent: bookings.monthlyRent,
            moveInDate: bookings.moveInDate,
            moveOutDate: bookings.moveOutDate,
            nextRentDueDate: bookings.nextRentDueDate,
            bookingCreatedAt: bookings.createdAt,
            // Bed fields
            bedId: beds.id,
            bedName: beds.name,
            bedStatus: beds.status,
            // Room fields
            roomId: rooms.id,
            roomName: rooms.name,
            roomDescription: rooms.description,
            // Deposit fields
            depositId: deposits.id,
            depositAmount: deposits.amount,
            depositStatus: deposits.status,
            depositPaidAt: deposits.paidAt,
            depositRefundAmount: deposits.refundAmount,
            depositDeductionAmount: deposits.deductionAmount,
            depositDeductionReason: deposits.deductionReason,
        })
        .from(users)
        .where(and(eq(users.id, tenantId), eq(users.role, "tenant")))
        .leftJoin(bookings, and(eq(bookings.tenantId, users.id), eq(bookings.status, "active")))
        .leftJoin(beds, eq(beds.id, bookings.bedId))
        .leftJoin(rooms, eq(rooms.id, beds.roomId))
        .leftJoin(deposits, eq(deposits.bookingId, bookings.id))
        .get();

    if (!tenantWithBooking) return c.json(err("Tenant not found"), 404);

    // Only 2 more queries needed: payments and complaints (in parallel)
    // Limited to most recent 50 entries each to prevent memory issues
    const [paymentHistory, tenantComplaints] = await Promise.all([
        getTenantPayments(db, tenantId, 50),
        db
            .select()
            .from(complaints)
            .where(eq(complaints.tenantId, tenantId))
            .orderBy(desc(complaints.createdAt))
            .limit(50)
            .all(),
    ]);

    // Restructure the flat result into nested objects
    const tenant = {
        id: tenantWithBooking.id,
        name: tenantWithBooking.name,
        email: tenantWithBooking.email,
        phone: tenantWithBooking.phone,
        role: tenantWithBooking.role,
        isActive: tenantWithBooking.isActive,
        googleId: tenantWithBooking.googleId,
        createdAt: tenantWithBooking.createdAt,
    };

    const booking = tenantWithBooking.bookingId ? {
        id: tenantWithBooking.bookingId,
        tenantId,
        bedId: tenantWithBooking.bedId,
        status: tenantWithBooking.bookingStatus,
        monthlyRent: tenantWithBooking.monthlyRent,
        moveInDate: tenantWithBooking.moveInDate,
        moveOutDate: tenantWithBooking.moveOutDate,
        nextRentDueDate: tenantWithBooking.nextRentDueDate,
        createdAt: tenantWithBooking.bookingCreatedAt,
    } : null;

    const bed = tenantWithBooking.bedId ? {
        id: tenantWithBooking.bedId,
        roomId: tenantWithBooking.roomId,
        name: tenantWithBooking.bedName,
        status: tenantWithBooking.bedStatus,
        roomName: tenantWithBooking.roomName,
    } : null;

    const deposit = tenantWithBooking.depositId ? {
        id: tenantWithBooking.depositId,
        bookingId: tenantWithBooking.bookingId,
        tenantId,
        amount: tenantWithBooking.depositAmount,
        status: tenantWithBooking.depositStatus,
        paidAt: tenantWithBooking.depositPaidAt,
        refundAmount: tenantWithBooking.depositRefundAmount,
        deductionAmount: tenantWithBooking.depositDeductionAmount,
        deductionReason: tenantWithBooking.depositDeductionReason,
    } : null;

    return c.json(
        ok({
            tenant,
            booking,
            bed,
            deposit,
            payments: paymentHistory,
            complaints: tenantComplaints,
        })
    );
});

// ─── PUT /api/admin/tenants/:id/rent ──────────────────────────
adminRoute.put(
    "/tenants/:id/rent",
    zValidator("json", updateRentSchema),
    async (c) => {
        const tenantId = parseInt(c.req.param("id"), 10);
        if (isNaN(tenantId)) return c.json(err("Invalid tenant ID"), 400);

        const { monthlyRent, applyToAll } = c.req.valid("json");
        const db = createDb(c.env.DB);

        if (applyToAll) {
            // Update all active bookings
            await db
                .update(bookings)
                .set({ monthlyRent })
                .where(eq(bookings.status, "active"));

            // Update all beds' monthly rent as well
            await db.update(beds).set({ monthlyRent });

            return c.json(ok({ message: `Monthly rent updated to ₹${monthlyRent} for all tenants` }));
        } else {
            // Update only this tenant's active booking
            const updated = await db
                .update(bookings)
                .set({ monthlyRent })
                .where(and(eq(bookings.tenantId, tenantId), eq(bookings.status, "active")))
                .returning()
                .get();

            if (!updated) return c.json(err("No active booking found for this tenant"), 404);

            return c.json(ok({ message: `Rent updated to ₹${monthlyRent}`, booking: updated }));
        }
    }
);

// ─── PUT /api/admin/tenants/:id/deactivate ────────────────────
adminRoute.put("/tenants/:id/deactivate", async (c) => {
    const tenantId = parseInt(c.req.param("id"), 10);
    if (isNaN(tenantId)) return c.json(err("Invalid tenant ID"), 400);

    const db = createDb(c.env.DB);

    const updated = await db
        .update(users)
        .set({ isActive: false })
        .where(and(eq(users.id, tenantId), eq(users.role, "tenant")))
        .returning({ id: users.id })
        .get();

    if (!updated) return c.json(err("Tenant not found"), 404);

    // End any active booking and free the bed
    const activeBooking = await db
        .select()
        .from(bookings)
        .where(and(eq(bookings.tenantId, tenantId), eq(bookings.status, "active")))
        .get();

    if (activeBooking) {
        const now = nowISO();
        await db
            .update(bookings)
            .set({ status: "ended", moveOutDate: now.slice(0, 10) })
            .where(eq(bookings.id, activeBooking.id));

        await db
            .update(beds)
            .set({ status: "available" })
            .where(eq(beds.id, activeBooking.bedId));
    }

    // Also clean up any pending_deposit bookings
    const pendingBooking = await db
        .select()
        .from(bookings)
        .where(and(eq(bookings.tenantId, tenantId), eq(bookings.status, "pending_deposit")))
        .get();

    if (pendingBooking) {
        await db
            .update(bookings)
            .set({ status: "ended" })
            .where(eq(bookings.id, pendingBooking.id));

        await db
            .update(beds)
            .set({ status: "available" })
            .where(eq(beds.id, pendingBooking.bedId));
    }

    return c.json(ok({ message: "Tenant account deactivated, booking ended, bed freed" }));
});

// ─── DELETE /api/admin/tenants/:id ─────────────────────────────
// Permanently delete a tenant and all their associated data
// Rate limited to prevent accidental mass deletion
adminRoute.delete("/tenants/:id", adminDeleteRateLimit(), async (c) => {
    const tenantId = parseInt(c.req.param("id"), 10);
    if (isNaN(tenantId)) return c.json(err("Invalid tenant ID"), 400);

    const db = createDb(c.env.DB);

    // Check if tenant exists
    const tenant = await db
        .select()
        .from(users)
        .where(and(eq(users.id, tenantId), eq(users.role, "tenant")))
        .get();

    if (!tenant) return c.json(err("Tenant not found"), 404);

    // Get all bookings for this tenant (active, pending_deposit, or ended)
    const tenantBookings = await db
        .select()
        .from(bookings)
        .where(eq(bookings.tenantId, tenantId))
        .all();

    // Free up any beds that are reserved or occupied by this tenant
    for (const booking of tenantBookings) {
        if (booking.status === "active" || booking.status === "pending_deposit") {
            // Free up the bed
            await db
                .update(beds)
                .set({ status: "available" })
                .where(eq(beds.id, booking.bedId));
        }
    }

    // Delete in order to respect foreign key constraints:
    // 1. Delete complaints
    await db.delete(complaints).where(eq(complaints.tenantId, tenantId));

    // 2. Delete payments
    await db.delete(payments).where(eq(payments.tenantId, tenantId));

    // 3. Delete deposits for each booking
    for (const booking of tenantBookings) {
        await db.delete(deposits).where(eq(deposits.bookingId, booking.id));
    }

    // 4. Delete bookings
    await db.delete(bookings).where(eq(bookings.tenantId, tenantId));

    // 5. Finally, delete the user
    await db.delete(users).where(eq(users.id, tenantId));

    return c.json(ok({ message: "Tenant and all associated data permanently deleted, beds freed" }));
});

// ─── GET /api/admin/settings ──────────────────────────────────
adminRoute.get("/settings", async (c) => {
    const db = createDb(c.env.DB);
    const allSettings = await getAllSettings(db);
    return c.json(ok(allSettings));
});

// ─── POST /api/admin/tenants — manually create a tenant ───────
adminRoute.post(
    "/tenants",
    zValidator("json", adminCreateTenantSchema),
    async (c) => {
        const body = c.req.valid("json");
        const db = createDb(c.env.DB);

        // Check if email already exists
        const existing = await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.email, body.email))
            .get();

        if (existing) {
            return c.json(err("An account with this email already exists"), 409);
        }

        const passwordHash = await hashPassword(body.password);
        const now = nowISO();

        const newUser = await db
            .insert(users)
            .values({
                name: body.name,
                email: body.email,
                phone: body.phone,
                passwordHash,
                role: "tenant",
                isActive: true,
                createdAt: now,
            })
            .returning()
            .get();

        if (!newUser) return c.json(err("Failed to create tenant"), 500);

        // If a bedId was provided, create a booking (admin manually assigning a bed)
        let booking = null;
        if (body.bedId) {
            const bed = await db.select().from(beds).where(eq(beds.id, body.bedId)).get();
            if (!bed) return c.json(err("Bed not found"), 404);
            if (bed.status !== "available") {
                return c.json(err(`Bed is currently ${bed.status}`), 409);
            }

            const today = new Date();
            const { getNextRentDueDate, toDateString } = await import("../utils");

            booking = await db
                .insert(bookings)
                .values({
                    tenantId: newUser.id,
                    bedId: body.bedId,
                    status: "active",  // admin-created bookings are immediately active
                    monthlyRent: bed.monthlyRent,
                    moveInDate: toDateString(today),
                    nextRentDueDate: getNextRentDueDate(today),
                    createdAt: now,
                })
                .returning()
                .get();

            // Mark bed as occupied
            await db.update(beds).set({ status: "occupied" }).where(eq(beds.id, body.bedId));
        }

        return c.json(
            ok({
                tenant: omit(newUser, ["passwordHash"]),
                booking,
            }),
            201
        );
    }
);

// ─── PUT /api/admin/settings ──────────────────────────────────
adminRoute.put(
    "/settings",
    zValidator("json", updateSettingsSchema),
    async (c) => {
        const body = c.req.valid("json");
        const db = createDb(c.env.DB);

        const updates: Record<string, string> = {};
        if (body.rent_due_start_day !== undefined)
            updates["rent_due_start_day"] = body.rent_due_start_day.toString();
        if (body.rent_due_end_day !== undefined)
            updates["rent_due_end_day"] = body.rent_due_end_day.toString();
        if (body.late_fee_amount !== undefined)
            updates["late_fee_amount"] = body.late_fee_amount.toString();
        if (body.deposit_amount !== undefined)
            updates["deposit_amount"] = body.deposit_amount.toString();

        await updateSettings(db, updates as Parameters<typeof updateSettings>[1]);

        return c.json(ok({ message: "Settings updated successfully" }));
    }
);

// ─── GET /api/admin/export/payments — CSV export ──────────────
// Generates a CSV file of all payments for record keeping
adminRoute.get("/export/payments", async (c) => {
    const db = createDb(c.env.DB);

    const allPayments = await db
        .select({
            id: payments.id,
            tenantName: users.name,
            tenantEmail: users.email,
            amount: payments.amount,
            lateFee: payments.lateFee,
            rentMonth: payments.rentMonth,
            type: payments.type,
            status: payments.status,
            razorpayPaymentId: payments.razorpayPaymentId,
            paidAt: payments.paidAt,
        })
        .from(payments)
        .leftJoin(users, eq(payments.tenantId, users.id))
        .orderBy(desc(payments.paidAt))
        .all();

    // Build CSV string
    const headers = [
        "Payment ID", "Tenant Name", "Email", "Amount (₹)", "Late Fee (₹)",
        "Rent Month", "Type", "Status", "Razorpay ID", "Paid At",
    ];

    const rows = allPayments.map((p) =>
        [
            p.id, p.tenantName ?? "", p.tenantEmail ?? "", p.amount, p.lateFee,
            p.rentMonth, p.type, p.status, p.razorpayPaymentId ?? "", p.paidAt ?? "",
        ]
            .map(escapeCSV)
            .join(",")
    );

    const csv = [headers.join(","), ...rows].join("\n");

    return new Response(csv, {
        headers: {
            "Content-Type": "text/csv",
            "Content-Disposition": `attachment; filename="payments-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
    });
});

// ─── GET /api/admin/export/tenants — CSV export ───────────────
adminRoute.get("/export/tenants", async (c) => {
    const db = createDb(c.env.DB);

    const tenantData = await db
        .select({
            id: users.id,
            name: users.name,
            email: users.email,
            phone: users.phone,
            isActive: users.isActive,
            createdAt: users.createdAt,
            room: rooms.name,
            bed: beds.name,
            monthlyRent: bookings.monthlyRent,
            moveInDate: bookings.moveInDate,
        })
        .from(users)
        .where(eq(users.role, "tenant"))
        .leftJoin(bookings, and(eq(bookings.tenantId, users.id), eq(bookings.status, "active")))
        .leftJoin(beds, eq(beds.id, bookings.bedId))
        .leftJoin(rooms, eq(rooms.id, beds.roomId))
        .all();

    const headers = ["ID", "Name", "Email", "Phone", "Active", "Joined", "Room", "Bed", "Monthly Rent (₹)", "Move-in Date"];
    const rows = tenantData.map((t) =>
        [
            t.id, t.name, t.email, t.phone, t.isActive ? "Yes" : "No",
            t.createdAt, t.room ?? "", t.bed ?? "", t.monthlyRent ?? "", t.moveInDate ?? "",
        ]
            .map(escapeCSV)
            .join(",")
    );

    const csv = [headers.join(","), ...rows].join("\n");

    return new Response(csv, {
        headers: {
            "Content-Type": "text/csv",
            "Content-Disposition": `attachment; filename="tenants-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
    });
});

export default adminRoute;