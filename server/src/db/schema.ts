import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────
// ROOMS
// Each room has a name (e.g. "Room 1") and optional description.
// Beds belong to rooms.
// ─────────────────────────────────────────────────────────────
export const rooms = sqliteTable("rooms", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),                         // e.g. "Room 1"
    description: text("description"),                     // optional notes
    createdAt: text("created_at").notNull(),
});

// ─────────────────────────────────────────────────────────────
// BEDS
// Each bed belongs to a room and has a status.
// Status transitions: available → reserved → occupied → available
// ─────────────────────────────────────────────────────────────
export const beds = sqliteTable("beds", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    roomId: integer("room_id").notNull().references(() => rooms.id),
    name: text("name").notNull(),                         // e.g. "Bed 1"
    status: text("status", {
        enum: ["available", "reserved", "occupied"],
    }).notNull().default("available"),
    monthlyRent: real("monthly_rent").notNull().default(5000), // per-bed rent
    createdAt: text("created_at").notNull(),
}, (table) => ([
    index("idx_beds_room_id").on(table.roomId),
    index("idx_beds_status").on(table.status),
]));

// ─────────────────────────────────────────────────────────────
// USERS (Tenants + Admin)
// A single users table handles both roles.
// Role "admin" has full access; role "tenant" sees only their own data.
// ─────────────────────────────────────────────────────────────
export const users = sqliteTable("users", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    phone: text("phone").notNull(),
    passwordHash: text("password_hash"),   // NULLABLE (Google users have no password)
    googleId: text("google_id").unique(),  // Google's unique user ID
    role: text("role", { enum: ["admin", "tenant"] }).notNull().default("tenant"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
}, (table) => ([
    index("idx_users_role").on(table.role),
    index("idx_users_is_active").on(table.isActive),
]));

// ─────────────────────────────────────────────────────────────
// BOOKINGS
// A booking links a tenant to a specific bed.
// One tenant = one active booking at a time.
// When a tenant leaves, moveOutDate is set and bed becomes available.
//
// CONSTRAINT ENFORCEMENT:
// - One booking per bed: Enforced via optimistic locking on beds.status
//   (see bookings.ts - UPDATE WHERE status='available' is atomic)
// - One active booking per tenant: Enforced at application level
//   (check before booking creation). SQLite doesn't support partial
//   unique indexes, so DB-level enforcement isn't possible.
// ─────────────────────────────────────────────────────────────
export const bookings = sqliteTable("bookings", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tenantId: integer("tenant_id").notNull().references(() => users.id),
    bedId: integer("bed_id").notNull().references(() => beds.id),
    status: text("status", {
        enum: ["pending_deposit", "active", "ended"],
    }).notNull().default("pending_deposit"),
    monthlyRent: real("monthly_rent").notNull(),          // snapshot of rent at booking time
    moveInDate: text("move_in_date").notNull(),
    moveOutDate: text("move_out_date"),                   // null until tenant leaves
    nextRentDueDate: text("next_rent_due_date").notNull(),
    createdAt: text("created_at").notNull(),
}, (table) => ([
    index("idx_bookings_tenant_status").on(table.tenantId, table.status),
]));

// ─────────────────────────────────────────────────────────────
// DEPOSITS
// Each booking has one deposit record.
// Deposit is paid upfront; refunded (minus deductions) when tenant leaves.
// ─────────────────────────────────────────────────────────────
export const deposits = sqliteTable("deposits", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    bookingId: integer("booking_id").notNull().references(() => bookings.id).unique(),
    tenantId: integer("tenant_id").notNull().references(() => users.id),
    amount: real("amount").notNull(),
    status: text("status", {
        enum: ["held", "refunded", "partially_refunded"],
    }).notNull().default("held"),
    razorpayOrderId: text("razorpay_order_id"),
    razorpayPaymentId: text("razorpay_payment_id"),
    paidAt: text("paid_at"),
    refundedAt: text("refunded_at"),
    refundAmount: real("refund_amount"),                  // actual amount returned
    deductionAmount: real("deduction_amount"),            // deducted for damages
    deductionReason: text("deduction_reason"),
    createdAt: text("created_at").notNull(),
}, (table) => ([
    index("idx_deposits_tenant_id").on(table.tenantId),
    index("idx_deposits_status").on(table.status),
]));

// ─────────────────────────────────────────────────────────────
// PAYMENTS (Monthly Rent Payments)
// Each row = one rent payment event.
// type: "online" = paid via Razorpay | "manual" = admin recorded cash/UPI
// ─────────────────────────────────────────────────────────────
export const payments = sqliteTable("payments", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tenantId: integer("tenant_id").notNull().references(() => users.id),
    bookingId: integer("booking_id").notNull().references(() => bookings.id),
    amount: real("amount").notNull(),
    type: text("type", { enum: ["online", "manual"] }).notNull(),
    status: text("status", {
        enum: ["pending", "completed", "failed"],
    }).notNull().default("pending"),
    // Razorpay fields (only filled for online payments)
    razorpayOrderId: text("razorpay_order_id"),
    razorpayPaymentId: text("razorpay_payment_id"),
    razorpaySignature: text("razorpay_signature"),
    // Rent period this payment covers (e.g. "2025-06")
    rentMonth: text("rent_month").notNull(),              // format: YYYY-MM
    lateFee: real("late_fee").notNull().default(0),
    notes: text("notes"),                                 // admin notes for manual payments
    paidAt: text("paid_at"),
    createdAt: text("created_at").notNull(),
}, (table) => ([
    index("idx_payments_tenant_month").on(table.tenantId, table.rentMonth),
    index("idx_payments_tenant_status").on(table.tenantId, table.status),
    index("idx_payments_status").on(table.status),
    index("idx_payments_booking_id").on(table.bookingId),
]));

// ─────────────────────────────────────────────────────────────
// COMPLAINTS
// Tenants submit complaints/queries. Admin manages status.
// ─────────────────────────────────────────────────────────────
export const complaints = sqliteTable("complaints", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tenantId: integer("tenant_id").notNull().references(() => users.id),
    subject: text("subject").notNull(),
    message: text("message").notNull(),
    status: text("status", {
        enum: ["open", "in_progress", "resolved", "closed"],
    }).notNull().default("open"),
    adminReply: text("admin_reply"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
}, (table) => ([
    index("idx_complaints_tenant_id").on(table.tenantId),
    index("idx_complaints_status").on(table.status),
    index("idx_complaints_tenant_status").on(table.tenantId, table.status),
]));

// ─────────────────────────────────────────────────────────────
// SETTINGS
// Key-value store for admin-configurable values.
// Stored in DB so admin can change them without redeploying code.
//
// Keys used:
//   rent_due_start_day   → "1"    (1st of month)
//   rent_due_end_day     → "5"    (5th of month)
//   late_fee_amount      → "100"  (₹100)
//   deposit_amount       → "5000" (default deposit)
// ─────────────────────────────────────────────────────────────
export const settings = sqliteTable("settings", {
    key: text("key").primaryKey(),
    value: text("value").notNull(),
    updatedAt: text("updated_at").notNull(),
});

// ─────────────────────────────────────────────────────────────
// RELATIONS
// Drizzle relations let you write type-safe JOIN queries.
// These don't create DB constraints — they're for the query builder.
// ─────────────────────────────────────────────────────────────

export const roomsRelations = relations(rooms, ({ many }) => ({
    beds: many(beds),
}));

export const bedsRelations = relations(beds, ({ one, many }) => ({
    room: one(rooms, { fields: [beds.roomId], references: [rooms.id] }),
    bookings: many(bookings),
}));

export const usersRelations = relations(users, ({ many }) => ({
    bookings: many(bookings),
    payments: many(payments),
    complaints: many(complaints),
    deposits: many(deposits),
}));

export const bookingsRelations = relations(bookings, ({ one, many }) => ({
    tenant: one(users, { fields: [bookings.tenantId], references: [users.id] }),
    bed: one(beds, { fields: [bookings.bedId], references: [beds.id] }),
    payments: many(payments),
    deposit: one(deposits, { fields: [bookings.id], references: [deposits.bookingId] }),
}));

export const depositsRelations = relations(deposits, ({ one }) => ({
    booking: one(bookings, { fields: [deposits.bookingId], references: [bookings.id] }),
    tenant: one(users, { fields: [deposits.tenantId], references: [users.id] }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
    tenant: one(users, { fields: [payments.tenantId], references: [users.id] }),
    booking: one(bookings, { fields: [payments.bookingId], references: [bookings.id] }),
}));

export const complaintsRelations = relations(complaints, ({ one }) => ({
    tenant: one(users, { fields: [complaints.tenantId], references: [users.id] }),
}));

// ─────────────────────────────────────────────────────────────
// TYPE EXPORTS
// Drizzle infers TypeScript types from the schema automatically.
// Use these types throughout the app instead of writing them by hand.
// ─────────────────────────────────────────────────────────────
export type Room = typeof rooms.$inferSelect;
export type NewRoom = typeof rooms.$inferInsert;

export type Bed = typeof beds.$inferSelect;
export type NewBed = typeof beds.$inferInsert;

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;

export type Deposit = typeof deposits.$inferSelect;
export type NewDeposit = typeof deposits.$inferInsert;

export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;

export type Complaint = typeof complaints.$inferSelect;
export type NewComplaint = typeof complaints.$inferInsert;

export type Setting = typeof settings.$inferSelect;