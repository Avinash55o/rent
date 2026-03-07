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