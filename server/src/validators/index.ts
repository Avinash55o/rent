import z from "zod";

export const signupSchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    email: z.email("Invalid email address"),
    phone: z.string().regex(/^\+?[0-9]{10,13}$/).optional().default(""),
    password: z.string().min(8, "Password must be at least 8 characters"),
});

export const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
});

export const updateProfileSchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters").optional(),
    phone: z.string().regex(/^\+?[0-9]{10,13}$/).optional(),
});


// ─── Rooms & Beds ─────────────────────────────────────────────

export const createRoomSchema = z.object({
    name: z.string().min(1, "Room name is required"),
    description: z.string().optional(),
    beds: z
        .array(
            z.object({
                name: z.string().min(1),
                monthlyRent: z.number().positive("Rent must be positive"),
            })
        )
        .min(1, "At least one bed is required"),
});

export const updateBedSchema = z.object({
    name: z.string().min(1).optional(),
    monthlyRent: z.number().positive().optional(),
    status: z.enum(["available", "reserved", "occupied"]).optional(),
});

// ─── Bookings ─────────────────────────────────────────────────

export const createBookingSchema = z.object({
    bedId: z.number().int().positive("Bed ID must be a positive integer"),
    depositAmount: z.number().positive("Deposit amount must be positive"),
});

export const endBookingSchema = z.object({
    moveOutDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
    refundAmount: z.number().min(0),
    deductionAmount: z.number().min(0).default(0),
    deductionReason: z.string().optional(),
});

// ─── Payments ─────────────────────────────────────────────────

// Tenant initiates an online payment → we create a Razorpay order
export const initiatePaymentSchema = z.object({
    rentMonth: z
        .string()
        .regex(/^\d{4}-\d{2}$/, "rentMonth must be YYYY-MM format"),
});

// Razorpay calls back after payment — tenant sends us these 3 fields to verify
export const verifyPaymentSchema = z.object({
    razorpayOrderId: z.string().min(1),
    razorpayPaymentId: z.string().min(1),
    razorpaySignature: z.string().min(1),
    rentMonth: z.string().regex(/^\d{4}-\d{2}$/),
});

// Admin records a manual payment (cash / direct UPI)
export const manualPaymentSchema = z.object({
    tenantId: z.number().int().positive(),
    amount: z.number().positive(),
    rentMonth: z.string().regex(/^\d{4}-\d{2}$/),
    notes: z.string().optional(),
});

// ─── Complaints ───────────────────────────────────────────────

export const createComplaintSchema = z.object({
    subject: z.string().min(3, "Subject must be at least 3 characters"),
    message: z.string().min(10, "Message must be at least 10 characters"),
});

export const updateComplaintSchema = z.object({
    status: z.enum(["open", "in_progress", "resolved", "closed"]),
    adminReply: z.string().optional(),
});

// ─── Settings ─────────────────────────────────────────────────

export const updateSettingsSchema = z.object({
    rent_due_start_day: z.number().int().min(1).max(28).optional(),
    rent_due_end_day: z.number().int().min(1).max(28).optional(),
    late_fee_amount: z.number().min(0).optional(),
    deposit_amount: z.number().positive().optional(),
});

// ─── Admin: update tenant rent ────────────────────────────────

export const updateRentSchema = z.object({
    monthlyRent: z.number().positive("Rent must be positive"),
    applyToAll: z.boolean().default(false), // if true, update all active bookings
});

// ─── Google OAuth callback ────────────────────────────────────

export const googleCallbackSchema = z.object({
    code: z.string().min(1, "Authorization code is required"),
    state: z.string().min(1, "State parameter is required for CSRF protection"),
});

// ─── Admin: create tenant manually ────────────────────────────

export const adminCreateTenantSchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    email: z.string().email("Invalid email address"),
    phone: z.string().regex(/^\+?[0-9]{10,13}$/, "Invalid phone number"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    bedId: z.number().int().positive().optional(),  // optionally assign a bed immediately
});

// ─── Type exports (inferred from schemas) ─────────────────────
export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type CreateRoomInput = z.infer<typeof createRoomSchema>;
export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type InitiatePaymentInput = z.infer<typeof initiatePaymentSchema>;
export type VerifyPaymentInput = z.infer<typeof verifyPaymentSchema>;
export type ManualPaymentInput = z.infer<typeof manualPaymentSchema>;
export type CreateComplaintInput = z.infer<typeof createComplaintSchema>;
export type UpdateComplaintInput = z.infer<typeof updateComplaintSchema>;
export type GoogleCallbackInput = z.infer<typeof googleCallbackSchema>;
export type AdminCreateTenantInput = z.infer<typeof adminCreateTenantSchema>;