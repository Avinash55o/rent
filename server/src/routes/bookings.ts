/**
 * POST /api/bookings                → tenant: initiate booking (creates deposit order)
 * POST /api/bookings/deposit/verify → tenant: verify deposit payment → activates booking
 * GET  /api/bookings/my             → tenant: get their active booking details
 * GET  /api/bookings                → admin: list all bookings
 * GET  /api/bookings/:id            → admin: get booking details
 * POST /api/bookings/:id/end        → admin: end booking (tenant moves out)
 *
 * BOOKING LIFECYCLE:
 *   1. Tenant selects a bed and submits createBookingSchema
 *   2. We create a Razorpay ORDER for the deposit amount
 *   3. Tenant pays deposit via Razorpay checkout (frontend)
 *   4. Tenant POSTs to /deposit/verify with Razorpay payment details
 *   5. We verify signature → mark deposit as paid → set bed to "occupied"
 *   6. Booking becomes "active"
 *   7. Admin ends booking when tenant leaves → bed becomes "available" again
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, and, desc, or } from "drizzle-orm";
import type { Env } from "../types/env";
import type { JwtPayload } from "../types/api";
import { ok, err } from "../types/api";
import { createDb } from "../db/client";
import { bookings, beds, deposits, users } from "../db/schema";
import {
    createBookingSchema,
    endBookingSchema,
    verifyPaymentSchema,
} from "../validators";
import { createRazorpayOrder } from "../services/razorpay.service";
import { verifyRazorpaySignature, nowISO, getNextRentDueDate, toDateString, generateReceiptNumber } from "../utils";
import { requireAdmin, requireAuth } from "../middleware/auth";

type Variables = { user: JwtPayload };

const bookingsRoute = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── POST /api/bookings — TENANT: initiate booking + deposit order ───
bookingsRoute.post(
    "/",
    requireAuth(),
    zValidator("json", createBookingSchema),
    async (c) => {
        const { sub: tenantId } = c.get("user");
        const { bedId, depositAmount } = c.req.valid("json");
        const db = createDb(c.env.DB);

        // Check tenant doesn't already have an active or pending_deposit booking
        const existingBooking = await db
            .select({ id: bookings.id })
            .from(bookings)
            .where(and(
                eq(bookings.tenantId, tenantId),
                or(eq(bookings.status, "active"), eq(bookings.status, "pending_deposit"))
            ))
            .get();

        if (existingBooking) {
            return c.json(err("You already have an active or pending booking"), 409);
        }

        // Check bed is available
        const bed = await db.select().from(beds).where(eq(beds.id, bedId)).get();
        if (!bed) return c.json(err("Bed not found"), 404);
        if (bed.status !== "available") {
            return c.json(err(`Bed is currently ${bed.status}`), 409);
        }

        // Get tenant info
        const tenant = await db.select().from(users).where(eq(users.id, tenantId)).get();
        if (!tenant) return c.json(err("Tenant not found"), 404);

        const now = nowISO();
        const today = new Date();

        // Create booking record (status = "pending_deposit" — becomes "active" after deposit verified)
        const booking = await db
            .insert(bookings)
            .values({
                tenantId,
                bedId,
                status: "pending_deposit",
                monthlyRent: bed.monthlyRent,
                moveInDate: toDateString(today),
                nextRentDueDate: getNextRentDueDate(today),
                createdAt: now,
            })
            .returning()
            .get();

        if (!booking) return c.json(err("Failed to create booking"), 500);

        // Create Razorpay order for deposit
        const receipt = generateReceiptNumber();
        const order = await createRazorpayOrder(
            c.env.RAZORPAY_KEY_ID,
            c.env.RAZORPAY_KEY_SECRET,
            {
                amount: depositAmount,
                receipt,
                notes: { tenantName: tenant.name, type: "deposit" },
            }
        );

        // Create deposit record (not yet paid)
        await db.insert(deposits).values({
            bookingId: booking.id,
            tenantId,
            amount: depositAmount,
            status: "held",
            razorpayOrderId: order.id,
            createdAt: now,
        });

        // Mark bed as "reserved" while waiting for deposit payment
        await db.update(beds).set({ status: "reserved" }).where(eq(beds.id, bedId));

        return c.json(
            ok({
                bookingId: booking.id,
                razorpayOrderId: order.id,
                razorpayKeyId: c.env.RAZORPAY_KEY_ID,
                amount: depositAmount,
                currency: "INR",
            }),
            201
        );
    }
);

// ─── POST /api/bookings/deposit/verify — TENANT ───────────────
// Called after tenant completes deposit payment in Razorpay checkout
bookingsRoute.post(
    "/deposit/verify",
    requireAuth(),
    zValidator("json", verifyPaymentSchema),
    async (c) => {
        const { sub: tenantId } = c.get("user");
        const { razorpayOrderId, razorpayPaymentId, razorpaySignature } =
            c.req.valid("json");
        const db = createDb(c.env.DB);

        // Verify Razorpay signature
        const isValid = await verifyRazorpaySignature(
            razorpayOrderId,
            razorpayPaymentId,
            razorpaySignature,
            c.env.RAZORPAY_KEY_SECRET
        );

        if (!isValid) {
            return c.json(err("Payment verification failed — invalid signature"), 400);
        }

        // Find deposit record
        const deposit = await db
            .select()
            .from(deposits)
            .where(
                and(
                    eq(deposits.tenantId, tenantId),
                    eq(deposits.razorpayOrderId, razorpayOrderId)
                )
            )
            .get();

        if (!deposit) return c.json(err("Deposit record not found"), 404);

        // Replay attack protection: check if deposit is already paid
        if (deposit.paidAt) {
            return c.json(err("Deposit has already been verified"), 409);
        }

        const now = nowISO();

        // Mark deposit as paid
        await db
            .update(deposits)
            .set({ razorpayPaymentId, paidAt: now })
            .where(eq(deposits.id, deposit.id));

        // Transition booking from pending_deposit → active and mark bed as occupied
        const booking = await db
            .select()
            .from(bookings)
            .where(eq(bookings.id, deposit.bookingId))
            .get();

        if (booking) {
            await db
                .update(bookings)
                .set({ status: "active" })
                .where(eq(bookings.id, booking.id));

            await db
                .update(beds)
                .set({ status: "occupied" })
                .where(eq(beds.id, booking.bedId));
        }

        return c.json(ok({ message: "Deposit verified. Booking confirmed!" }));
    }
);

// ─── GET /api/bookings/my — TENANT ───────────────────────────
bookingsRoute.get("/my", requireAuth(), async (c) => {
    const { sub: tenantId } = c.get("user");
    const db = createDb(c.env.DB);

    const booking = await db
        .select()
        .from(bookings)
        .where(and(
            eq(bookings.tenantId, tenantId),
            or(eq(bookings.status, "active"), eq(bookings.status, "pending_deposit"))
        ))
        .get();

    if (!booking) return c.json(err("No active booking found"), 404);

    // Get bed and room info
    const bed = await db.select().from(beds).where(eq(beds.id, booking.bedId)).get();
    const deposit = await db
        .select()
        .from(deposits)
        .where(eq(deposits.bookingId, booking.id))
        .get();

    return c.json(ok({ booking, bed, deposit }));
});

// ─── GET /api/bookings — ADMIN ────────────────────────────────
bookingsRoute.get("/", requireAdmin(), async (c) => {
    const db = createDb(c.env.DB);

    const allBookings = await db
        .select()
        .from(bookings)
        .orderBy(desc(bookings.createdAt))
        .all();

    return c.json(ok(allBookings));
});

// ─── GET /api/bookings/:id — ADMIN ───────────────────────────
bookingsRoute.get("/:id", requireAdmin(), async (c) => {
    const bookingId = parseInt(c.req.param("id"), 10);
    if (isNaN(bookingId)) return c.json(err("Invalid booking ID"), 400);

    const db = createDb(c.env.DB);

    const booking = await db
        .select()
        .from(bookings)
        .where(eq(bookings.id, bookingId))
        .get();

    if (!booking) return c.json(err("Booking not found"), 404);

    const bed = await db.select().from(beds).where(eq(beds.id, booking.bedId)).get();
    const deposit = await db
        .select()
        .from(deposits)
        .where(eq(deposits.bookingId, bookingId))
        .get();
    const tenant = await db
        .select({ id: users.id, name: users.name, email: users.email, phone: users.phone })
        .from(users)
        .where(eq(users.id, booking.tenantId))
        .get();

    return c.json(ok({ booking, bed, deposit, tenant }));
});

// ─── POST /api/bookings/:id/end — ADMIN: end booking ─────────
bookingsRoute.post(
    "/:id/end",
    requireAdmin(),
    zValidator("json", endBookingSchema),
    async (c) => {
        const bookingId = parseInt(c.req.param("id"), 10);
        if (isNaN(bookingId)) return c.json(err("Invalid booking ID"), 400);

        const body = c.req.valid("json");
        const db = createDb(c.env.DB);

        const booking = await db
            .select()
            .from(bookings)
            .where(eq(bookings.id, bookingId))
            .get();

        if (!booking) return c.json(err("Booking not found"), 404);
        if (booking.status === "ended") {
            return c.json(err("Booking is already ended"), 409);
        }

        const now = nowISO();

        // End the booking
        await db
            .update(bookings)
            .set({ status: "ended", moveOutDate: body.moveOutDate })
            .where(eq(bookings.id, bookingId));

        // Free up the bed
        await db
            .update(beds)
            .set({ status: "available" })
            .where(eq(beds.id, booking.bedId));

        // Update deposit refund info
        await db
            .update(deposits)
            .set({
                status: body.deductionAmount > 0 ? "partially_refunded" : "refunded",
                refundAmount: body.refundAmount,
                deductionAmount: body.deductionAmount,
                deductionReason: body.deductionReason,
                refundedAt: now,
            })
            .where(eq(deposits.bookingId, bookingId));

        return c.json(ok({ message: "Booking ended. Bed is now available." }));
    }
);

export default bookingsRoute;