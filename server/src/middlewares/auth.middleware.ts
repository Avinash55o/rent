import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { verifyToken } from "../lib/auth";
import { createDb } from "../db/drizzle";
import type { HonoEnv } from "../types";

// Middleware: create per-request DB and attach to context
export const dbMiddleware = createMiddleware<HonoEnv>(async (c, next) => {
    const db = createDb(c.env.rent_db);
    c.set("db", db);
    await next();
});

// Middleware: verify JWT from Authorization header
export const authMiddleware = createMiddleware<HonoEnv>(async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
        throw new HTTPException(401, {
            message: "Missing or invalid Authorization header"
        });
    }

    const token = authHeader.slice(7);
    try {
        const payload = await verifyToken(token, c.env.JWT_SECRET);
        c.set("user", payload);
        await next();
    } catch {
        throw new HTTPException(401, { message: "Invalid or expired token" });
    }
});

export const adminMiddleware = createMiddleware<HonoEnv>(async (c, next) => {
    const user = c.get("user");
    if (user.role !== "admin") {
        throw new HTTPException(403, { message: "Admin access required" });
    }
    await next();
});
