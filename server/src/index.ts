import { Hono } from "hono";
import { cors } from "hono/cors";
import { dbMiddleware } from "./middlewares/auth.middleware";
import { auth } from "./routes/auth";
import { tenantsRouter } from "./routes/tenants";
import { invoiceRouter } from "./routes/invoices";
import { paymentRouter } from "./routes/payments";
import { webhookRouter } from "./webhooks/razorpay";
import { handleScheduled } from "./workers/reminders";
import type { HonoEnv } from "./types";

const app = new Hono<HonoEnv>();

// Global middleware
app.use("*", cors());
app.use("*", dbMiddleware);

// Health check
app.get("/", (c) => c.json({ status: "ok", service: "rent-server" }));

// Routes
app.route("/api/auth", auth);
app.route("/api/tenants", tenantsRouter);
app.route("/api/invoices", invoiceRouter);
app.route("/api/payments", paymentRouter);
app.route("/api/webhooks", webhookRouter);

// Export for Cloudflare Workers
export default {
    fetch: app.fetch,
    scheduled: handleScheduled,
};
