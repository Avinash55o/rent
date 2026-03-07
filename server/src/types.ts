import type { AppDB } from "./db/drizzle";
export type { AppDB };

// All env vars & bindings available in your worker
export type Env = {
    // D1 binding (must match wrangler.jsonc binding name)
    rent_db: D1Database;

    // Auth
    JWT_SECRET: string;
    JWT_EXPIRES_IN?: string;

    // Razorpay
    RAZORPAY_KEY_ID: string;
    RAZORPAY_KEY_SECRET: string;
    RAZORPAY_WEBHOOK_SECRET: string;

    // Google OAuth (Also used for Gmail API)
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    GOOGLE_REDIRECT_URI: string;
    FRONTEND_URL: string;
    GOOGLE_REFRESH_TOKEN?: string;

    // Resend (email — primary)
    RESEND_API_KEY: string;
    RESEND_FROM_EMAIL: string;
    GMAIL_FROM_MAIL: string;

    // WhatsApp (optional — for future use)
    WHATSAPP_API_URL?: string;
    WHATSAPP_PHONE_NUMBER_ID?: string;
    WHATSAPP_ACCESS_TOKEN?: string;
    WHATSAPP_TEMPLATE_DUE_REMINDER?: string;
    WHATSAPP_TEMPLATE_OVERDUE_REMINDER?: string;
};

// Hono app-level types
export type HonoEnv = {
    Bindings: Env;
    Variables: {
        db: AppDB;
        user: import("./lib/auth").JWTPayload;
    };
};

