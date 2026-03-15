/**
 * GET  /api/rooms             → public: list all rooms with bed availability
 * POST /api/rooms             → admin: create a new room with beds
 * GET  /api/rooms/:id         → public: get one room with its beds
 * PUT  /api/rooms/:id/beds/:bedId → admin: update a specific bed
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import type { Env } from "../types/env";
import type { JwtPayload } from "../types/api";
import { ok, err } from "../types/api";
import { createDb } from "../db/client";
import { rooms, beds } from "../db/schema";
import { createRoomSchema, updateBedSchema, updateRoomSchema, addBedToRoomSchema } from "../validators";
import { nowISO } from "../utils";
import { requireAdmin } from "../middleware/auth";

type Variables = { user: JwtPayload };

const roomsRoute = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── GET /api/rooms — PUBLIC (no auth required) ───────────────
// Anyone can see room/bed availability without logging in
roomsRoute.get("/", async (c) => {
    const db = createDb(c.env.DB);

    // Get all rooms
    const allRooms = await db.select().from(rooms).all();

    // Get all beds
    const allBeds = await db.select().from(beds).all();

    // Group beds under their rooms
    const result = allRooms.map((room) => ({
        ...room,
        beds: allBeds
            .filter((bed) => bed.roomId === room.id)
            .map((bed) => ({
                id: bed.id,
                name: bed.name,
                status: bed.status,
                monthlyRent: bed.monthlyRent,
                // Only expose status publicly — don't leak internal IDs unnecessarily
            })),
    }));

    return c.json(ok(result));
});

// ─── GET /api/rooms/:id — PUBLIC ─────────────────────────────
roomsRoute.get("/:id", async (c) => {
    const roomId = parseInt(c.req.param("id"), 10);
    if (isNaN(roomId)) return c.json(err("Invalid room ID"), 400);

    const db = createDb(c.env.DB);

    const room = await db.select().from(rooms).where(eq(rooms.id, roomId)).get();
    if (!room) return c.json(err("Room not found"), 404);

    const roomBeds = await db.select().from(beds).where(eq(beds.roomId, roomId)).all();

    return c.json(ok({ ...room, beds: roomBeds }));
});

// ─── POST /api/rooms — ADMIN ONLY ─────────────────────────────
// Create a new room with multiple beds in one request
roomsRoute.post("/", requireAdmin(), zValidator("json", createRoomSchema), async (c) => {
    const body = c.req.valid("json");
    const db = createDb(c.env.DB);

    const now = nowISO();

    // Insert room
    const room = await db
        .insert(rooms)
        .values({ name: body.name, description: body.description, createdAt: now })
        .returning()
        .get();

    if (!room) return c.json(err("Failed to create room"), 500);

    // Insert all beds for this room
    const bedInserts = body.beds.map((bed) => ({
        roomId: room.id,
        name: bed.name,
        monthlyRent: bed.monthlyRent,
        status: "available" as const,
        createdAt: now,
    }));

    const createdBeds = await db.insert(beds).values(bedInserts).returning().all();

    return c.json(ok({ ...room, beds: createdBeds }), 201);
});

// ─── PUT /api/rooms/:id — ADMIN ONLY ─────────────────────────
// Update room name and description
roomsRoute.put(
    "/:id",
    requireAdmin(),
    zValidator("json", updateRoomSchema),
    async (c) => {
        const roomId = parseInt(c.req.param("id"), 10);
        if (isNaN(roomId)) return c.json(err("Invalid room ID"), 400);

        const body = c.req.valid("json");
        const db = createDb(c.env.DB);

        const updated = await db
            .update(rooms)
            .set(body)
            .where(eq(rooms.id, roomId))
            .returning()
            .get();

        if (!updated) return c.json(err("Room not found"), 404);

        return c.json(ok(updated));
    }
);

// ─── DELETE /api/rooms/:id — ADMIN ONLY ─────────────────────────
// Delete a room (only if all beds are available/empty)
roomsRoute.delete("/:id", requireAdmin(), async (c) => {
    const roomId = parseInt(c.req.param("id"), 10);
    if (isNaN(roomId)) return c.json(err("Invalid room ID"), 400);

    const db = createDb(c.env.DB);

    // Check if room exists
    const room = await db.select().from(rooms).where(eq(rooms.id, roomId)).get();
    if (!room) return c.json(err("Room not found"), 404);

    // Check if any beds are occupied or reserved
    const roomBeds = await db.select().from(beds).where(eq(beds.roomId, roomId)).all();
    const occupiedBeds = roomBeds.filter((b) => b.status !== "available");

    if (occupiedBeds.length > 0) {
        return c.json(
            err(`Cannot delete room with ${occupiedBeds.length} occupied/reserved bed(s). Free up all beds first.`),
            409
        );
    }

    // Delete all beds in the room
    await db.delete(beds).where(eq(beds.roomId, roomId));

    // Delete the room
    await db.delete(rooms).where(eq(rooms.id, roomId));

    return c.json(ok({ message: "Room and all its beds deleted successfully" }));
});

// ─── POST /api/rooms/:id/beds — ADMIN ONLY ─────────────────────
// Add a new bed to an existing room
roomsRoute.post(
    "/:id/beds",
    requireAdmin(),
    zValidator("json", addBedToRoomSchema),
    async (c) => {
        const roomId = parseInt(c.req.param("id"), 10);
        if (isNaN(roomId)) return c.json(err("Invalid room ID"), 400);

        const body = c.req.valid("json");
        const db = createDb(c.env.DB);

        // Check if room exists
        const room = await db.select().from(rooms).where(eq(rooms.id, roomId)).get();
        if (!room) return c.json(err("Room not found"), 404);

        const now = nowISO();
        const newBed = await db
            .insert(beds)
            .values({
                roomId,
                name: body.name,
                monthlyRent: body.monthlyRent,
                status: "available",
                createdAt: now,
            })
            .returning()
            .get();

        if (!newBed) return c.json(err("Failed to create bed"), 500);

        return c.json(ok(newBed), 201);
    }
);

// ─── PUT /api/rooms/:id/beds/:bedId — ADMIN ONLY ─────────────
roomsRoute.put(
    "/:id/beds/:bedId",
    requireAdmin(),
    zValidator("json", updateBedSchema),
    async (c) => {
        const bedId = parseInt(c.req.param("bedId"), 10);
        if (isNaN(bedId)) return c.json(err("Invalid bed ID"), 400);

        const body = c.req.valid("json");
        const db = createDb(c.env.DB);

        const updated = await db
            .update(beds)
            .set(body)
            .where(eq(beds.id, bedId))
            .returning()
            .get();

        if (!updated) return c.json(err("Bed not found"), 404);

        return c.json(ok(updated));
    }
);

// ─── DELETE /api/rooms/:id/beds/:bedId — ADMIN ONLY ───────────
// Delete a specific bed (only if available)
roomsRoute.delete("/:id/beds/:bedId", requireAdmin(), async (c) => {
    const bedId = parseInt(c.req.param("bedId"), 10);
    if (isNaN(bedId)) return c.json(err("Invalid bed ID"), 400);

    const db = createDb(c.env.DB);

    // Check if bed exists and is available
    const bed = await db.select().from(beds).where(eq(beds.id, bedId)).get();
    if (!bed) return c.json(err("Bed not found"), 404);

    if (bed.status !== "available") {
        return c.json(err("Cannot delete bed that is occupied or reserved"), 409);
    }

    await db.delete(beds).where(eq(beds.id, bedId));

    return c.json(ok({ message: "Bed deleted successfully" }));
});

export default roomsRoute;