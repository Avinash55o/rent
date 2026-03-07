# Cloudflare Workers Migration Guide — Rent Server

A detailed, file-by-file breakdown of every change needed to make your Hono backend run on Cloudflare Workers with **D1 (SQLite)**, **Razorpay**, and **Google OAuth**.

---

## 📊 Database: Why Cloudflare D1?

| Feature | Cloudflare D1 (Free) | Neon (Free) | Supabase (Free) |
|---|---|---|---|
| Engine | SQLite (edge) | PostgreSQL | PostgreSQL |
| Storage | **5 GB** | 0.5 GB | 0.5 GB |
| Reads | 5M rows/day | 100 compute-hours/mo | Limited |
| Writes | 100K rows/day | Included | Limited |
| Latency | Ultra-low (same edge) | HTTP round-trip | HTTP round-trip |
| Cost | $0 | $0 | $0 |
| Integration | Native CF binding | External HTTP | External HTTP |

> [!TIP]
> D1 is the best fit here — it's **native to Cloudflare Workers** (zero cold-start, no HTTP serialization), has a generous free tier, and Drizzle ORM supports it natively. The only trade-off is switching from PostgreSQL to SQLite, which means rewriting your schema from `pgTable` → `sqliteTable`.

### D1 Setup Commands

```bash
# Create the database
npx wrangler d1 create rent-db

# This outputs a database_id — copy it into wrangler.jsonc
```

---

## 🗂 File-by-File Changes

---

### 1. [wrangler.jsonc](file:///home/ppriyankuu/Projects/rent/server/wrangler.jsonc) — Enable nodejs_compat, D1 binding, Cron Triggers

**Current issues:**
- `nodejs_compat` is commented out — needed for `jsonwebtoken`, `bcryptjs`, `node:crypto`
- No D1 database binding
- No cron triggers defined
- No environment variable declarations

**Change to:**

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "server",
  "main": "src/index.ts",
  "compatibility_date": "2026-03-05",
  "compatibility_flags": ["nodejs_compat"],

  // D1 database binding
  "d1_databases": [
    {
      "binding": "DB",          // available as env.DB in code
      "database_name": "rent-db",
      "database_id": "<paste-your-database-id-here>"
    }
  ],

  // Cron Triggers — replaces node-cron
  "triggers": {
    "crons": [
      "0 1 * * *",   // 1:00 AM UTC daily — mark overdue invoices
      "0 9 * * *",   // 9:00 AM UTC daily — send due reminders
      "0 10 * * *"   // 10:00 AM UTC daily — send overdue reminders
    ]
  }

  // Environment variables go in .dev.vars (local) or CF dashboard (prod)
  // DO NOT put secrets in this file
}
```

> [!IMPORTANT]
> **Environment variables** — Create a `.dev.vars` file in your server root for local development:
> ```env
> JWT_SECRET=your-jwt-secret
> RAZORPAY_KEY_ID=rzp_test_xxxx
> RAZORPAY_KEY_SECRET=your-razorpay-secret
> RAZORPAY_WEBHOOK_SECRET=your-webhook-secret
> GOOGLE_CLIENT_ID=your-google-client-id
> GOOGLE_CLIENT_SECRET=your-google-client-secret
> GOOGLE_REDIRECT_URI=http://localhost:8787/api/auth/google/callback
> FRONTEND_URL=http://localhost:3000
> WHATSAPP_API_URL=https://graph.facebook.com/v21.0
> WHATSAPP_PHONE_NUMBER_ID=your-phone-number-id
> WHATSAPP_ACCESS_TOKEN=your-access-token
> WHATSAPP_TEMPLATE_DUE_REMINDER=rent_due_reminder
> WHATSAPP_TEMPLATE_OVERDUE_REMINDER=rent_overdue_reminder
> ```

---

### 2. [package.json](file:///home/ppriyankuu/Projects/rent/server/package.json) — Fix dependencies

**Current issues:**
- `bcryptjs` and `jsonwebtoken` are in `devDependencies` — they're runtime deps
- `pg` (Node.js PostgreSQL driver) — **won't work** in Workers
- `node-cron` — **won't work** in Workers (no persistent process)
- `axios` — works but unnecessary, native `fetch` is available
- `razorpay` SDK — uses Node.js `http` module internally, **won't work**
- Missing `drizzle-kit` for D1 migrations

**Change to:**

```json
{
  "name": "server",
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy --minify",
    "cf-typegen": "wrangler types --env-interface CloudflareBindings",
    "db:generate": "drizzle-kit generate",
    "db:migrate:local": "wrangler d1 migrations apply rent-db --local",
    "db:migrate:prod": "wrangler d1 migrations apply rent-db --remote"
  },
  "dependencies": {
    "@hono/zod-validator": "^0.7.6",
    "bcryptjs": "^3.0.3",
    "drizzle-orm": "^0.45.1",
    "hono": "^4.12.5",
    "jsonwebtoken": "^9.0.3",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@types/bcryptjs": "^2.4.6",
    "@types/jsonwebtoken": "^9.0.10",
    "drizzle-kit": "^0.31.0",
    "wrangler": "^4.70.0"
  }
}
```

**Removed:** `pg`, `@types/pg`, `node-cron`, `axios`, `razorpay`, `@types/node`
**Moved to dependencies:** `bcryptjs`, `jsonwebtoken`
**Added:** `drizzle-kit`, `@types/bcryptjs`

---

### 3. `drizzle.config.ts` — [NEW FILE] Drizzle Kit config for D1

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
    out: "./drizzle",           // migration output directory
    schema: "./src/db/schema.ts",
    dialect: "sqlite",          // D1 = SQLite
    driver: "d1-http",
});
```

---

### 4. `src/types.ts` — [NEW FILE] Shared types

**Why:** Every file currently uses `process.env` for config. In Cloudflare Workers, environment variables are passed per-request via `env` parameter. We need a central type definition.

```typescript
import { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "./db/schema";

// All env vars & bindings available in your worker
export type Env = {
    // D1 binding
    DB: D1Database;

    // Auth
    JWT_SECRET: string;
    JWT_EXPIRES_IN?: string;

    // Razorpay
    RAZORPAY_KEY_ID: string;
    RAZORPAY_KEY_SECRET: string;
    RAZORPAY_WEBHOOK_SECRET: string;

    // Google OAuth
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    GOOGLE_REDIRECT_URI: string;
    FRONTEND_URL: string;

    // WhatsApp
    WHATSAPP_API_URL: string;
    WHATSAPP_PHONE_NUMBER_ID: string;
    WHATSAPP_ACCESS_TOKEN: string;
    WHATSAPP_TEMPLATE_DUE_REMINDER: string;
    WHATSAPP_TEMPLATE_OVERDUE_REMINDER: string;
};

// Drizzle DB type with your schema
export type AppDb = DrizzleD1Database<typeof schema>;

// Hono app-level types
export type HonoEnv = {
    Bindings: Env;
    Variables: {
        db: AppDb;
        user: import("./lib/auth").JWTPayload;
    };
};
```

---

### 5. [src/db/schema.ts](file:///home/ppriyankuu/Projects/rent/server/src/db/schema.ts) — Rewrite for SQLite (D1)

**What changes:**
- `pgTable` → `sqliteTable`
- `pgEnum` → removed (SQLite has no enum type — use `text` with `enum` option)
- `uuid()` → `text()` with `$defaultFn(() => crypto.randomUUID())`
- `numeric()` → `text()` (stored as string for decimal precision)
- `timestamp()` → `integer({ mode: "timestamp" })` (SQLite stores as unix epoch)
- `date()` → `text()` (store as ISO string `YYYY-MM-DD`)
- `boolean()` → `integer({ mode: "boolean" })` (SQLite: 0/1)
- `varchar()` → `text()` (SQLite has no varchar)
- Must add Drizzle `relations()` — **your current schema is missing these**, which means `db.query.invoices.findMany({ with: { tenantProfile: true } })` in your invoice router will crash

**Full rewritten schema:**

```typescript
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

// ── Users ──────────────────────────────────────────
export const users = sqliteTable("users", {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    email: text("email").notNull().unique(),
    name: text("name"),
    phone: text("phone"),
    passwordHash: text("password_hash"),
    googleId: text("google_id"),
    role: text("role", { enum: ["admin", "tenant"] }).notNull().default("tenant"),
    createdAt: integer("created_at", { mode: "timestamp" })
        .$defaultFn(() => new Date()).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
        .$defaultFn(() => new Date()).notNull(),
});

// ── Tenant Profiles ────────────────────────────────
export const tenantProfiles = sqliteTable("tenant_profiles", {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id").references(() => users.id).notNull(),
    roomNumber: text("room_number"),
    rentAmount: text("rent_amount").notNull(),
    depositAmount: text("deposit_amount").notNull(),
    joinDate: text("join_date").notNull(),             // "YYYY-MM-DD"
    nextDueDate: text("next_due_date"),
    graceLastDate: text("grace_last_date"),
    isActive: integer("is_active", { mode: "boolean" }).default(true),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
}, (table) => [
    index("tenant_profiles_user_id_idx").on(table.userId),
]);

// ── Invoices ───────────────────────────────────────
export const invoices = sqliteTable("invoices", {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id").references(() => tenantProfiles.id).notNull(),
    billingMonth: text("billing_month").notNull(),
    amount: text("amount").notNull(),
    status: text("status", { enum: ["pending", "paid", "overdue"] })
        .default("pending").notNull(),
    dueDate: text("due_date").notNull(),
    graceLastDate: text("grace_last_date"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
}, (table) => [
    index("invoices_tenant_id_idx").on(table.tenantId),
    index("invoices_billing_month_idx").on(table.billingMonth),
    index("invoices_status_idx").on(table.status),
]);

// ── Payments ───────────────────────────────────────
export const payments = sqliteTable("payments", {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id").references(() => tenantProfiles.id).notNull(),
    invoiceId: text("invoice_id").references(() => invoices.id).notNull(),
    amount: text("amount").notNull(),
    paymentMethod: text("payment_method", { enum: ["upi", "card"] }),
    razorpayPaymentId: text("razorpay_payment_id"),
    paidAt: integer("paid_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
}, (table) => [
    index("payments_tenant_id_idx").on(table.tenantId),
    index("payments_invoice_id_idx").on(table.invoiceId),
]);

// ── Payment Attempts ───────────────────────────────
export const paymentAttempts = sqliteTable("payment_attempts", {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id").references(() => tenantProfiles.id).notNull(),
    invoiceId: text("invoice_id").references(() => invoices.id).notNull(),
    amount: text("amount").notNull(),
    status: text("status", { enum: ["pending", "success", "failed"] })
        .default("pending").notNull(),
    razorpayOrderId: text("razorpay_order_id"),
    razorpayPaymentId: text("razorpay_payment_id"),
    failureReason: text("failure_reason"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
}, (table) => [
    index("payment_attempts_tenant_id_idx").on(table.tenantId),
    index("payment_attempts_invoice_id_idx").on(table.invoiceId),
    index("payment_attempts_status_idx").on(table.status),
]);

// ── Notification Logs ──────────────────────────────
export const notificationLogs = sqliteTable("notification_logs", {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id").references(() => tenantProfiles.id).notNull(),
    invoiceId: text("invoice_id").references(() => invoices.id),
    type: text("type", { enum: ["due_reminder", "overdue_reminder"] }).notNull(),
    channel: text("channel"),
    status: text("status"),
    sentAt: integer("sent_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
}, (table) => [
    index("notification_logs_tenant_id_idx").on(table.tenantId),
    index("notification_logs_invoice_id_idx").on(table.invoiceId),
]);

// ── Relations (REQUIRED for db.query.*.findMany({ with: ... })) ──

export const usersRelations = relations(users, ({ many }) => ({
    tenantProfiles: many(tenantProfiles),
}));

export const tenantProfilesRelations = relations(tenantProfiles, ({ one, many }) => ({
    user: one(users, { fields: [tenantProfiles.userId], references: [users.id] }),
    invoices: many(invoices),
    payments: many(payments),
    paymentAttempts: many(paymentAttempts),
    notificationLogs: many(notificationLogs),
}));

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
    tenantProfile: one(tenantProfiles, {
        fields: [invoices.tenantId], references: [tenantProfiles.id]
    }),
    payments: many(payments),
    paymentAttempts: many(paymentAttempts),
    notificationLogs: many(notificationLogs),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
    tenantProfile: one(tenantProfiles, {
        fields: [payments.tenantId], references: [tenantProfiles.id]
    }),
    invoice: one(invoices, {
        fields: [payments.invoiceId], references: [invoices.id]
    }),
}));

export const paymentAttemptsRelations = relations(paymentAttempts, ({ one }) => ({
    tenantProfile: one(tenantProfiles, {
        fields: [paymentAttempts.tenantId], references: [tenantProfiles.id]
    }),
    invoice: one(invoices, {
        fields: [paymentAttempts.invoiceId], references: [invoices.id]
    }),
}));

export const notificationLogsRelations = relations(notificationLogs, ({ one }) => ({
    tenantProfile: one(tenantProfiles, {
        fields: [notificationLogs.tenantId], references: [tenantProfiles.id]
    }),
    invoice: one(invoices, {
        fields: [notificationLogs.invoiceId], references: [invoices.id]
    }),
}));

// ── Type exports ───────────────────────────────────
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type TenantProfile = typeof tenantProfiles.$inferSelect;
export type NewTenantProfile = typeof tenantProfiles.$inferInsert;
export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;
export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
export type PaymentAttempt = typeof paymentAttempts.$inferSelect;
export type NewPaymentAttempt = typeof paymentAttempts.$inferInsert;
export type NotificationLog = typeof notificationLogs.$inferSelect;
export type NewNotificationLog = typeof notificationLogs.$inferInsert;
```

> [!WARNING]
> **Typo fix:** Your current schema has `"due_remainder"` / `"overdue_remainder"` — should be `"due_reminder"` / `"overdue_reminder"`.

---

### 6. [src/db/drizzle.ts](file:///home/ppriyankuu/Projects/rent/server/src/db/drizzle.ts) — Rewrite for D1

**Current code** creates a `pg.Pool` singleton — this doesn't work in Workers (no TCP sockets, no persistent process).

**Change to:**

```typescript
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

// Create a per-request DB instance from the D1 binding
export function createDb(d1: D1Database) {
    return drizzle(d1, { schema });
}

export type AppDb = ReturnType<typeof createDb>;
```

> [!IMPORTANT]
> The DB is now created **per-request** in middleware (see [index.ts](file:///home/ppriyankuu/Projects/rent/server/src/index.ts)), not as a global singleton. Every route/service that uses the DB must receive it as a parameter or read it from Hono context.

---

### 7. [src/lib/auth.ts](file:///home/ppriyankuu/Projects/rent/server/src/lib/auth.ts) — Pass env, no process.env

**Current issues:**
- Reads `JWT_SECRET` from `process.env` at module level — in Workers, env is per-request
- `bcryptjs` and `jsonwebtoken` are fine with `nodejs_compat`

**Change to:**

```typescript
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

export interface JWTPayload {
    userId: string;
    email: string;
    role: "admin" | "tenant";
    tenantProfileId?: string;
}

// Pass secret explicitly — no process.env
export function signToken(payload: JWTPayload, secret: string, expiresIn = "7d"): string {
    return jwt.sign(payload, secret, { expiresIn } as jwt.SignOptions);
}

export function verifyToken(token: string, secret: string): JWTPayload {
    return jwt.verify(token, secret) as JWTPayload;
}

export async function hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
}
```

---

### 8. [src/middlewares/auth.middleware.ts](file:///home/ppriyankuu/Projects/rent/server/src/middlewares/auth.middleware.ts) — Use `c.env` for secrets, set db in context

**Change to:**

```typescript
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { verifyToken, type JWTPayload } from "../lib/auth";
import { createDb } from "../db/drizzle";
import type { HonoEnv } from "../types";

// Middleware: create per-request DB and attach to context
export const dbMiddleware = createMiddleware<HonoEnv>(async (c, next) => {
    const db = createDb(c.env.DB);
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
        const payload = verifyToken(token, c.env.JWT_SECRET);
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
```

---

### 9. [src/services/payment.service.ts](file:///home/ppriyankuu/Projects/rent/server/src/services/payment.service.ts) — Replace Razorpay SDK with fetch

**Current issues:**
- `razorpay` npm SDK uses Node.js `http`/`https` — **won't work in Workers**
- Creates a global `Razorpay` instance — env not available at module level
- Uses `crypto.createHmac` — works fine with `nodejs_compat`

**Change to:**

```typescript
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { invoices, paymentAttempts, payments } from "../db/schema";
import type { AppDb } from "../db/drizzle";
import type { Env } from "../types";

// ── Razorpay REST API helper ────────────────────────
async function razorpayFetch(
    env: Env,
    path: string,
    options: RequestInit = {}
): Promise<any> {
    const credentials = btoa(
        `${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`
    );

    const res = await fetch(`https://api.razorpay.com/v1${path}`, {
        ...options,
        headers: {
            Authorization: `Basic ${credentials}`,
            "Content-Type": "application/json",
            ...options.headers,
        },
    });

    if (!res.ok) {
        const error = await res.text();
        throw new Error(`Razorpay API error (${res.status}): ${error}`);
    }

    return res.json();
}

// ── Create Order ────────────────────────────────────
export interface CreateOrderResult {
    orderId: string;
    amount: number;
    currency: string;
    attemptId: string;
}

export async function createPaymentOrder(
    db: AppDb,
    env: Env,
    invoiceId: string,
    tenantId: string
): Promise<CreateOrderResult> {
    const invoice = await db.query.invoices.findFirst({
        where: eq(invoices.id, invoiceId),
    });

    if (!invoice) throw new Error("Invoice not found");
    if (invoice.status === "paid") throw new Error("Invoice already paid");
    if (invoice.tenantId !== tenantId)
        throw new Error("Invoice does not belong to this tenant");

    const amountInPaise = Math.round(Number(invoice.amount) * 100);

    // Razorpay REST API — POST /v1/orders
    const order = await razorpayFetch(env, "/orders", {
        method: "POST",
        body: JSON.stringify({
            amount: amountInPaise,
            currency: "INR",
            receipt: `inv_${invoiceId}`,
            notes: { invoiceId, tenantId },
        }),
    });

    const [attempt] = await db
        .insert(paymentAttempts)
        .values({
            tenantId,
            invoiceId,
            amount: invoice.amount,
            status: "pending",
            razorpayOrderId: order.id,
        })
        .returning();

    return {
        orderId: order.id,
        amount: amountInPaise,
        currency: "INR",
        attemptId: attempt.id,
    };
}

// ── Verify & Capture ────────────────────────────────
export async function verifyAndCapturePayment(
    db: AppDb,
    env: Env,
    params: {
        razorpayOrderId: string;
        razorpayPaymentId: string;
        razorpaySignature: string;
        attemptId: string;
    }
): Promise<void> {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature, attemptId }
        = params;

    // Verify signature using HMAC SHA256
    const expected = crypto
        .createHmac("sha256", env.RAZORPAY_KEY_SECRET)
        .update(`${razorpayOrderId}|${razorpayPaymentId}`)
        .digest("hex");

    if (expected !== razorpaySignature) {
        await db
            .update(paymentAttempts)
            .set({
                status: "failed",
                failureReason: "Signature mismatch",
                updatedAt: new Date(),
            })
            .where(eq(paymentAttempts.id, attemptId));
        throw new Error("Payment signature verification failed");
    }

    const attempt = await db.query.paymentAttempts.findFirst({
        where: eq(paymentAttempts.id, attemptId),
    });
    if (!attempt) throw new Error("Payment attempt not found");

    // Fetch payment details — GET /v1/payments/:id
    const rzpPayment = await razorpayFetch(
        env, `/payments/${razorpayPaymentId}`
    );
    const method = rzpPayment.method === "upi" ? "upi" : "card";

    await db.insert(payments).values({
        tenantId: attempt.tenantId,
        invoiceId: attempt.invoiceId,
        amount: attempt.amount,
        paymentMethod: method,
        razorpayPaymentId,
        paidAt: new Date(),
    });

    await db
        .update(invoices)
        .set({ status: "paid", updatedAt: new Date() })
        .where(eq(invoices.id, attempt.invoiceId));

    await db
        .update(paymentAttempts)
        .set({
            status: "success",
            razorpayPaymentId,
            updatedAt: new Date(),
        })
        .where(eq(paymentAttempts.id, attemptId));
}

// ── Webhook signature verification ──────────────────
export function verifyWebhookSignature(
    body: string,
    signature: string,
    secret: string
): boolean {
    const expected = crypto
        .createHmac("sha256", secret)
        .update(body)
        .digest("hex");
    return expected === signature;
}
```

---

### 10. [src/services/notification.service.ts](file:///home/ppriyankuu/Projects/rent/server/src/services/notification.service.ts) — Replace axios with fetch

**Current issues:**
- Uses `axios` — unnecessary, Workers has native `fetch`
- Reads env vars at module level via `process.env`

**Change to:**

```typescript
import { eq } from "drizzle-orm";
import { invoices, notificationLogs, tenantProfiles, users } from "../db/schema";
import type { AppDb } from "../db/drizzle";
import type { Env } from "../types";

export interface SendWhatsAppParams {
    to: string;
    templateName: string;
    languageCode?: string;
    components?: object[];
}

// Send WhatsApp template message via Meta Cloud API
export async function sendWhatsAppMessage(
    env: Env,
    params: SendWhatsAppParams
): Promise<boolean> {
    const { to, templateName, languageCode = "en", components = [] } = params;

    try {
        const res = await fetch(
            `${env.WHATSAPP_API_URL}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    messaging_product: "whatsapp",
                    to,
                    type: "template",
                    template: {
                        name: templateName,
                        language: { code: languageCode },
                        components,
                    },
                }),
            }
        );

        if (!res.ok) {
            const error = await res.text();
            console.error("[WhatsApp] Failed to send message:", error);
            return false;
        }
        return true;
    } catch (error: any) {
        console.error("[WhatsApp] Failed to send message:", error.message);
        return false;
    }
}

// Send due reminder
export async function sendDueReminder(
    db: AppDb, env: Env, tenantId: string, invoiceId: string
): Promise<void> {
    const invoice = await db.query.invoices.findFirst({
        where: eq(invoices.id, invoiceId),
    });
    const tenant = await db.query.tenantProfiles.findFirst({
        where: eq(tenantProfiles.id, tenantId),
    });
    if (!invoice || !tenant) return;

    const user = await db.query.users.findFirst({
        where: eq(users.id, tenant.userId),
    });
    if (!user?.phone) return;

    const phone = normalizePhone(user.phone);
    const success = await sendWhatsAppMessage(env, {
        to: phone,
        templateName: env.WHATSAPP_TEMPLATE_DUE_REMINDER,
        components: [{
            type: "body",
            parameters: [
                { type: "text", text: user.name || "Tenant" },
                { type: "text", text: `₹${invoice.amount}` },
                { type: "text", text: invoice.dueDate },
            ],
        }],
    });

    await db.insert(notificationLogs).values({
        tenantId, invoiceId,
        type: "due_reminder",
        channel: "whatsapp",
        status: success ? "sent" : "failed",
        sentAt: new Date(),
    });
}

// Send overdue reminder
export async function sendOverdueReminder(
    db: AppDb, env: Env, tenantId: string, invoiceId: string
): Promise<void> {
    const invoice = await db.query.invoices.findFirst({
        where: eq(invoices.id, invoiceId),
    });
    const tenant = await db.query.tenantProfiles.findFirst({
        where: eq(tenantProfiles.id, tenantId),
    });
    if (!invoice || !tenant) return;

    const user = await db.query.users.findFirst({
        where: eq(users.id, tenant.userId),
    });
    if (!user?.phone) return;

    const phone = normalizePhone(user.phone);
    const success = await sendWhatsAppMessage(env, {
        to: phone,
        templateName: env.WHATSAPP_TEMPLATE_OVERDUE_REMINDER,
        components: [{
            type: "body",
            parameters: [
                { type: "text", text: user.name || "Tenant" },
                { type: "text", text: `₹${invoice.amount}` },
                { type: "text", text: invoice.dueDate },
            ],
        }],
    });

    await db.insert(notificationLogs).values({
        tenantId, invoiceId,
        type: "overdue_reminder",
        channel: "whatsapp",
        status: success ? "sent" : "failed",
        sentAt: new Date(),
    });
}

function normalizePhone(phone: string): string {
    const digits = phone.replace(/\D/g, "");
    if (digits.startsWith("91") && digits.length === 12) return digits;
    if (digits.length === 10) return `91${digits}`;
    return digits;
}
```

---

### 11. [src/services/invoice.service.ts](file:///home/ppriyankuu/Projects/rent/server/src/services/invoice.service.ts) — Accept db param

**Change to:**

```typescript
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { invoices } from "../db/schema";
import type { AppDb } from "../db/drizzle";

export async function markOverdueInvoices(db: AppDb): Promise<number> {
    const today = new Date().toISOString().split("T")[0];

    const result = await db
        .update(invoices)
        .set({ status: "overdue", updatedAt: new Date() })
        .where(
            and(
                eq(invoices.status, "pending"),
                sql`coalesce(${invoices.graceLastDate}, ${invoices.dueDate}) <= ${today}`
            )
        )
        .returning({ id: invoices.id });

    return result.length;
}

export async function getInvoicesDueInDays(db: AppDb, days: number) {
    const today = new Date();
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + days);

    const todayStr = today.toISOString().split("T")[0];
    const targetStr = targetDate.toISOString().split("T")[0];

    return db.query.invoices.findMany({
        where: and(
            eq(invoices.status, "pending"),
            gte(invoices.dueDate, todayStr),
            lte(invoices.dueDate, targetStr)
        ),
    });
}

export async function getOverdueInvoices(db: AppDb) {
    return db.query.invoices.findMany({
        where: eq(invoices.status, "overdue"),
    });
}
```

---

### 12. [src/routes/auth/index.ts](file:///home/ppriyankuu/Projects/rent/server/src/routes/auth/index.ts) — Replace axios, use c.env/c.var

**Key changes:**
- Replace `axios.post` / `axios.get` with native `fetch`
- Replace `db` import with `c.get("db")`
- Replace `process.env.*` with `c.env.*`
- Replace [signToken(payload)](file:///home/ppriyankuu/Projects/rent/server/src/lib/auth.ts#14-17) with [signToken(payload, c.env.JWT_SECRET)](file:///home/ppriyankuu/Projects/rent/server/src/lib/auth.ts#14-17)

```typescript
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import z from "zod";
import { tenantProfiles, users } from "../../db/schema";
import { eq } from "drizzle-orm";
import { comparePassword, hashPassword, signToken } from "../../lib/auth";
import { sanitizeUser } from "../tenants";
import { authMiddleware } from "../../middlewares/auth.middleware";
import type { HonoEnv } from "../../types";

export const auth = new Hono<HonoEnv>();

const registerSchema = z.object({
    email: z.email(),
    password: z.string().min(8, "Password must be at least 8 characters"),
    name: z.string().min(1).max(255),
    phone: z.string().optional(),
});

const loginSchema = z.object({
    email: z.email(),
    password: z.string().min(1),
});

// Register
auth.post("/register", zValidator("json", registerSchema), async (c) => {
    const db = c.get("db");
    const { email, password, name, phone } = c.req.valid("json");

    const existing = await db.query.users.findFirst({
        where: eq(users.email, email),
    });
    if (existing) return c.json({ error: "Email already in use" }, 409);

    const passwordHash = await hashPassword(password);
    const [user] = await db
        .insert(users)
        .values({ email, name, phone, passwordHash, role: "tenant" })
        .returning();

    const token = signToken(
        { userId: user.id, email: user.email, role: user.role },
        c.env.JWT_SECRET
    );
    return c.json({ token, user: sanitizeUser(user) }, 201);
});

// Login
auth.post("/login", zValidator("json", loginSchema), async (c) => {
    const db = c.get("db");
    const { email, password } = c.req.valid("json");

    const user = await db.query.users.findFirst({
        where: eq(users.email, email),
    });
    if (!user || !user.passwordHash)
        return c.json({ error: "Invalid credentials" }, 401);

    const valid = await comparePassword(password, user.passwordHash);
    if (!valid) return c.json({ error: "Invalid credentials" }, 401);

    const tenantProfile = await db.query.tenantProfiles.findFirst({
        where: eq(tenantProfiles.userId, user.id),
    });

    const token = signToken({
        userId: user.id,
        email: user.email,
        role: user.role,
        tenantProfileId: tenantProfile?.id,
    }, c.env.JWT_SECRET);

    return c.json({ token, user: sanitizeUser(user) });
});

// Google OAuth — redirect to Google
auth.get("/google", (c) => {
    const scope = encodeURIComponent("openid email profile");
    const redirectUri = encodeURIComponent(c.env.GOOGLE_REDIRECT_URI);
    const url = `https://accounts.google.com/o/oauth2/v2/auth`
        + `?client_id=${c.env.GOOGLE_CLIENT_ID}`
        + `&redirect_uri=${redirectUri}`
        + `&response_type=code&scope=${scope}&access_type=offline`;
    return c.redirect(url);
});

// Google OAuth — callback (native fetch instead of axios)
auth.get("/google/callback", async (c) => {
    const db = c.get("db");
    const code = c.req.query("code");
    if (!code) return c.json({ error: "No code provided" }, 400);

    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            code,
            client_id: c.env.GOOGLE_CLIENT_ID,
            client_secret: c.env.GOOGLE_CLIENT_SECRET,
            redirect_uri: c.env.GOOGLE_REDIRECT_URI,
            grant_type: "authorization_code",
        }),
    });
    const tokenData: any = await tokenRes.json();

    // Fetch Google user profile
    const profileRes = await fetch(
        "https://www.googleapis.com/oauth2/v3/userinfo",
        { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
    );
    const { sub: googleId, email, name } = await profileRes.json() as any;

    // Upsert user
    let user = await db.query.users.findFirst({
        where: eq(users.email, email),
    });

    if (!user) {
        const [created] = await db
            .insert(users)
            .values({ email, name, googleId, role: "tenant" })
            .returning();
        user = created;
    } else if (!user.googleId) {
        const [updated] = await db
            .update(users)
            .set({ googleId, updatedAt: new Date() })
            .where(eq(users.id, user.id))
            .returning();
        user = updated;
    }

    const tenantProfile = await db.query.tenantProfiles.findFirst({
        where: eq(tenantProfiles.userId, user.id),
    });

    const token = signToken({
        userId: user.id,
        email: user.email,
        role: user.role,
        tenantProfileId: tenantProfile?.id,
    }, c.env.JWT_SECRET);

    return c.redirect(
        `${c.env.FRONTEND_URL}/auth/callback?token=${token}`
    );
});

// Get current user
auth.get("/me", authMiddleware, async (c) => {
    const db = c.get("db");
    const { userId } = c.get("user");
    const user = await db.query.users.findFirst({
        where: eq(users.id, userId),
    });
    if (!user) return c.json({ error: "User not found" }, 404);
    return c.json({ user: sanitizeUser(user) });
});
```

---

### 13. Routes: `invoices`, `payments`, `tenants` — Same pattern

For **all three route files**, apply this pattern:

```diff
-import { db } from "../../db/drizzle";
+import type { HonoEnv } from "../../types";

-export const router = new Hono<{ Variables: Variables }>();
+export const router = new Hono<HonoEnv>();

 // In EVERY route handler, first line:
+    const db = c.get("db");
```

**For payments**, also update service calls:

```diff
-const order = await createPaymentOrder(invoiceId, tenantId);
+const order = await createPaymentOrder(c.get("db"), c.env, invoiceId, tenantId);

-await verifyAndCapturePayment(body);
+await verifyAndCapturePayment(c.get("db"), c.env, body);
```

---

### 14. [src/webhooks/razorpay.ts](file:///home/ppriyankuu/Projects/rent/server/src/webhooks/razorpay.ts) — Use context-based db/env

```diff
-import { db } from "../db/drizzle";
+import type { HonoEnv } from "../types";

-export const webhookRouter = new Hono();
+export const webhookRouter = new Hono<HonoEnv>();

 webhookRouter.post("/razorpay", async (c) => {
+    const db = c.get("db");
     ...
-    if (!verifyWebhookSignature(rawBody, signature)) {
+    if (!verifyWebhookSignature(rawBody, signature, c.env.RAZORPAY_WEBHOOK_SECRET)) {
```

Also update [handlePaymentCaptured](file:///home/ppriyankuu/Projects/rent/server/src/webhooks/razorpay.ts#43-87) and [handlePaymentFailed](file:///home/ppriyankuu/Projects/rent/server/src/webhooks/razorpay.ts#88-109) to accept `db` as parameter.

---

### 15. [src/workers/reminders.ts](file:///home/ppriyankuu/Projects/rent/server/src/workers/reminders.ts) — Convert to CF Cron Trigger

**Current code** uses `node-cron` which requires a persistent process — **impossible in Workers**.

**Change to:**

```typescript
import { and, eq, gte } from "drizzle-orm";
import { notificationLogs } from "../db/schema";
import {
    getInvoicesDueInDays,
    getOverdueInvoices,
    markOverdueInvoices,
} from "../services/invoice.service";
import {
    sendDueReminder,
    sendOverdueReminder,
} from "../services/notification.service";
import { createDb } from "../db/drizzle";
import type { Env } from "../types";

async function wasReminderSentToday(
    db: ReturnType<typeof createDb>,
    tenantId: string,
    invoiceId: string,
    type: "due_reminder" | "overdue_reminder"
): Promise<boolean> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const existing = await db.query.notificationLogs.findFirst({
        where: and(
            eq(notificationLogs.tenantId, tenantId),
            eq(notificationLogs.invoiceId, invoiceId),
            eq(notificationLogs.type, type),
            gte(notificationLogs.createdAt, startOfDay)
        ),
    });

    return !!existing;
}

// Called by the CF scheduled handler in index.ts
export async function handleScheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
) {
    const db = createDb(env.DB);
    const cron = event.cron;

    // 1:00 AM UTC — mark overdue
    if (cron === "0 1 * * *") {
        console.log("[Cron] Running: markOverdueInvoices");
        const count = await markOverdueInvoices(db);
        console.log(`[Cron] Marked ${count} invoices as overdue`);
    }

    // 9:00 AM UTC — due reminders
    if (cron === "0 9 * * *") {
        console.log("[Cron] Running: sendDueReminders");
        const upcoming = await getInvoicesDueInDays(db, 5);
        for (const invoice of upcoming) {
            const alreadySent = await wasReminderSentToday(
                db, invoice.tenantId, invoice.id, "due_reminder"
            );
            if (alreadySent) continue;
            await sendDueReminder(db, env, invoice.tenantId, invoice.id);
        }
    }

    // 10:00 AM UTC — overdue reminders
    if (cron === "0 10 * * *") {
        console.log("[Cron] Running: sendOverdueReminders");
        const overdue = await getOverdueInvoices(db);
        for (const invoice of overdue) {
            const alreadySent = await wasReminderSentToday(
                db, invoice.tenantId, invoice.id, "overdue_reminder"
            );
            if (alreadySent) continue;
            await sendOverdueReminder(db, env, invoice.tenantId, invoice.id);
        }
    }
}
```

> [!NOTE]
> **Timezone:** CF Cron Triggers run in **UTC**. Adjust if you need IST:
> - 1:00 AM IST = `"30 19 * * *"` (previous day UTC)
> - 9:00 AM IST = `"30 3 * * *"` UTC
> - 10:00 AM IST = `"30 4 * * *"` UTC

---

### 16. [src/index.ts](file:///home/ppriyankuu/Projects/rent/server/src/index.ts) — Mount everything, export scheduled

**Change to:**

```typescript
import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "./routes/auth";
import { tenantsRouter } from "./routes/tenants";
import { invoiceRouter } from "./routes/invoices";
import { paymentRouter } from "./routes/payments";
import { webhookRouter } from "./webhooks/razorpay";
import { dbMiddleware } from "./middlewares/auth.middleware";
import { handleScheduled } from "./workers/reminders";
import type { HonoEnv } from "./types";

const app = new Hono<HonoEnv>();

// Global middleware
app.use("*", cors());
app.use("*", dbMiddleware);  // creates per-request DB from D1 binding

// Routes
app.route("/api/auth", auth);
app.route("/api/tenants", tenantsRouter);
app.route("/api/invoices", invoiceRouter);
app.route("/api/payments", paymentRouter);
app.route("/api/webhooks", webhookRouter);

app.get("/", (c) => c.json({
    status: "ok",
    message: "Rent Server API"
}));

// Export for Cloudflare Workers
export default {
    fetch: app.fetch,
    scheduled: handleScheduled,
};
```

---

## 🔑 Summary of All Changes

| # | File | Issue | Fix |
|---|---|---|---|
| 1 | [wrangler.jsonc](file:///home/ppriyankuu/Projects/rent/server/wrangler.jsonc) | `nodejs_compat` off, no D1, no cron | Enable flag, D1 binding, cron triggers |
| 2 | [package.json](file:///home/ppriyankuu/Projects/rent/server/package.json) | Wrong dep placement, incompatible pkgs | Move bcryptjs/jwt, remove pg/cron/axios/razorpay |
| 3 | `drizzle.config.ts` | **Missing** | New — D1/SQLite migration config |
| 4 | `src/types.ts` | **Missing** | New — central Env + HonoEnv types |
| 5 | [src/db/schema.ts](file:///home/ppriyankuu/Projects/rent/server/src/db/schema.ts) | `pgTable`, `pgEnum`, no relations | Rewrite to `sqliteTable`, add all relations |
| 6 | [src/db/drizzle.ts](file:///home/ppriyankuu/Projects/rent/server/src/db/drizzle.ts) | `pg.Pool` singleton | `createDb(d1)` factory per request |
| 7 | [src/lib/auth.ts](file:///home/ppriyankuu/Projects/rent/server/src/lib/auth.ts) | `process.env` at module level | Accept secret as parameter |
| 8 | `src/middlewares/` | No env/db middleware | `dbMiddleware` + `c.env` for secrets |
| 9 | [payment.service.ts](file:///home/ppriyankuu/Projects/rent/server/src/services/payment.service.ts) | Razorpay SDK, global db | `fetch` REST calls, accept db/env |
| 10 | [notification.service.ts](file:///home/ppriyankuu/Projects/rent/server/src/services/notification.service.ts) | `axios`, `process.env` | `fetch`, accept db/env |
| 11 | [invoice.service.ts](file:///home/ppriyankuu/Projects/rent/server/src/services/invoice.service.ts) | Global db | Accept db param |
| 12 | `routes/auth` | `axios`, `process.env` | `fetch`, `c.env`, `c.get("db")` |
| 13 | `routes/invoices` | Global db | `c.get("db")`, `HonoEnv` type |
| 14 | `routes/payments` | Global db, service args | `c.get("db")`, pass db/env |
| 15 | `routes/tenants` | Global db | `c.get("db")`, `HonoEnv` type |
| 16 | `webhooks/razorpay` | Global db, process.env | `c.get("db")`, `c.env` |
| 17 | `workers/reminders` | `node-cron` | Export `handleScheduled()` |
| 18 | [src/index.ts](file:///home/ppriyankuu/Projects/rent/server/src/index.ts) | No routes, no scheduled | Mount routes, export fetch+scheduled |

---

## 🚀 Setup Steps (After Making All Changes)

```bash
# 1. Install updated dependencies
pnpm install

# 2. Create D1 database
npx wrangler d1 create rent-db
# Copy the database_id into wrangler.jsonc

# 3. Generate migration from schema
pnpm db:generate

# 4. Apply migration locally
pnpm db:migrate:local

# 5. Create .dev.vars with all env vars (see section 1)

# 6. Start dev server
pnpm dev

# 7. Test
curl http://localhost:8787/
# Expected: {"status":"ok","message":"Rent Server API"}

# 8. Deploy to production
pnpm db:migrate:prod
pnpm deploy
```
