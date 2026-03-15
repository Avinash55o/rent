/**
 * This is the root of the application. It:
 *   1. Creates the main Hono app
 *   2. Registers global middleware (CORS, error handler)
 *   3. Mounts all route sub-apps under their prefixes
 *   4. Exports the fetch handler for Cloudflare Workers
 *
 * HOW CLOUDFLARE WORKERS WORK:
 * A Worker exports a `fetch` handler function. Cloudflare calls this function
 * for every incoming HTTP request. Hono handles the routing internally and
 * returns a Response object, which Cloudflare sends back to the client.
 *
 * ROUTE MAP:
 *   /api/auth/*        → auth.ts     (signup, login, me)
 *   /api/rooms/*       → rooms.ts    (room/bed availability + admin CRUD)
 *   /api/bookings/*    → bookings.ts (book a bed, deposit flow, admin management)
 *   /api/payments/*    → payments.ts (rent payment, history, receipts)
 *   /api/complaints/*  → complaints.ts (submit + manage complaints)
 *   /api/admin/*       → admin.ts    (dashboard, tenant mgmt, settings, export)
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { Env } from "./types/env";
import { err } from "./types/api";

// Route modules
import authRoutes from "./routes/auth";
import roomsRoutes from "./routes/rooms";
import bookingsRoutes from "./routes/bookings";
import paymentsRoutes from "./routes/payments";
import complaintsRoutes from "./routes/complaints";
import adminRoutes from "./routes/admin";

// Create the main Hono app with the Env type (gives access to c.env everywhere)
const app = new Hono<{ Bindings: Env }>();

// ─── Global Middleware ────────────────────────────────────────

// CORS: Allow requests from configured frontend domains
// Configure via ALLOWED_ORIGINS environment variable (comma-separated)
// Example: ALLOWED_ORIGINS=http://localhost:3000,https://myapp.com
app.use("*", async (c, next) => {
  const allowedOrigins = c.env.ALLOWED_ORIGINS
    ? c.env.ALLOWED_ORIGINS.split(",").map((o: string) => o.trim())
    : ["http://localhost:3000"];

  const corsMiddleware = cors({
    origin: allowedOrigins,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  });

  return corsMiddleware(c, next);
});

// Logger: Logs request method, path, and status to console (visible in wrangler dev)
app.use("*", logger());

// ─── Health Check ─────────────────────────────────────────────
app.get("/", (c) => {
  return c.json({
    name: "Rent Payment API",
    version: "1.0.0",
    status: "running",
    environment: c.env.ENVIRONMENT,
  });
});

app.get("/health", (c) => c.json({ status: "ok" }));

// ─── Route Mounting ───────────────────────────────────────────
app.route("/api/auth", authRoutes);
app.route("/api/rooms", roomsRoutes);
app.route("/api/bookings", bookingsRoutes);
app.route("/api/payments", paymentsRoutes);
app.route("/api/complaints", complaintsRoutes);
app.route("/api/admin", adminRoutes);

// ─── Global Error Handler ─────────────────────────────────────
// Catches any unhandled errors and returns a consistent JSON error response
// This prevents the Worker from crashing and leaking stack traces to clients
app.onError((error, c) => {
  console.error("Unhandled error:", error);

  // Don't leak internal error details in production
  const message =
    c.env.ENVIRONMENT === "development"
      ? error.message
      : "Internal server error";

  return c.json(err(message), 500);
});

// ─── 404 Handler ─────────────────────────────────────────────
app.notFound((c) => {
  return c.json(err(`Route not found: ${c.req.method} ${c.req.path}`), 404);
});

// ─── Export ───────────────────────────────────────────────────
// Cloudflare Workers require a default export with a `fetch` method
export default app;
