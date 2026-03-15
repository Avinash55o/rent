export interface Env {
    // D1 database binding (defined in [[d1_databases]] in wrangler.toml)
    DB: D1Database;

    // Secrets / environment variables (set via `wrangler secret put` or [vars])
    JWT_SECRET: string;
    RAZORPAY_KEY_ID: string;
    RAZORPAY_KEY_SECRET: string;
    ENVIRONMENT: "development" | "production";
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    GOOGLE_REDIRECT_URI: string;
}