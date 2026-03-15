/**
 * POST /api/auth/signup  → create a new tenant account
 * POST /api/auth/login   → login and receive a JWT
 * GET  /api/auth/google
 * POST /api/auth/google/callback
 * GET  /api/auth/me      → get current user's profile (requires auth)
 *
 * ROUTE STRUCTURE IN HONO:
 * Each route is a Hono app that gets mounted on the main app in index.ts.
 * This "sub-app" pattern keeps routes organized by feature.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import type { Env } from "../types/env";
import type { JwtPayload } from "../types/api";
import { ok, err } from "../types/api";
import { createDb } from "../db/client";
import { users } from "../db/schema";
import { signupSchema, loginSchema, updateProfileSchema, googleCallbackSchema } from "../validators";
import { hashPassword, verifyPassword, nowISO, omit, createOAuthState, verifyOAuthState } from "../utils";
import { signJwt, requireAuth } from "../middleware/auth";
import { getGoogleAuthUrl, exchangeCodeForProfile } from "../services/google.service";
import { loginRateLimit, signupRateLimit, resetRateLimit, getRateLimitKey } from "../middleware/rateLimit";

type Variables = { user: JwtPayload };

const auth = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── POST /api/auth/signup ────────────────────────────────────
// Rate limited: 3 signups per hour per IP
auth.post("/signup", signupRateLimit(), zValidator("json", signupSchema), async (c) => {
    const body = c.req.valid("json");
    const db = createDb(c.env.DB);

    // Check if email already exists
    const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, body.email))
        .get();

    if (existing) {
        return c.json(err("An account with this email already exists"), 409);
    }

    // Hash password before storing (NEVER store plain text passwords)
    const passwordHash = await hashPassword(body.password);

    const now = nowISO();
    const newUser = await db
        .insert(users)
        .values({
            name: body.name,
            email: body.email,
            phone: body.phone,
            passwordHash,
            role: "tenant",
            isActive: true,
            createdAt: now,
        })
        .returning()
        .get();

    if (!newUser) return c.json(err("Failed to create account"), 500);

    // Return user without passwordHash
    return c.json(ok({ user: omit(newUser, ["passwordHash"]) }), 201);
});

// ─── POST /api/auth/login ─────────────────────────────────────
// Rate limited: 5 login attempts per 15 minutes per IP
auth.post("/login", loginRateLimit(), zValidator("json", loginSchema), async (c) => {
    const { email, password } = c.req.valid("json");
    const db = createDb(c.env.DB);

    const user = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .get();

    // Use the same error message for "not found" and "wrong password"
    // This prevents "email enumeration" attacks (attacker can't tell which is wrong)
    if (!user || !user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
        return c.json(err("Invalid email or password"), 401);
    }

    if (!user.isActive) {
        return c.json(err("Account is deactivated. Please contact the admin."), 403);
    }

    // Create JWT token
    const token = await signJwt(
        { sub: user.id, email: user.email, role: user.role },
        c.env.JWT_SECRET
    );

    // Reset rate limit on successful login
    const ip = c.req.header("CF-Connecting-IP") ||
               c.req.header("X-Forwarded-For")?.split(",")[0] ||
               "unknown";
    resetRateLimit(getRateLimitKey("login", ip));

    return c.json(
        ok({
            token,
            user: omit(user, ["passwordHash"]),
        })
    );
});


// Frontend calls this to get the Google login URL, then redirects user there
auth.get("/google", async (c) => {
    // Generate a signed state parameter to prevent CSRF attacks
    // The state is signed with JWT_SECRET and expires after 10 minutes
    const state = await createOAuthState(c.env.JWT_SECRET);
    const url = await getGoogleAuthUrl(c.env.GOOGLE_CLIENT_ID, c.env.GOOGLE_REDIRECT_URI, state);
    return c.json(ok({ url, state }));
});

// Frontend sends the `code` it received from Google after user logs in
auth.post("/google/callback", zValidator("json", googleCallbackSchema), async (c) => {
    const { code, state } = c.req.valid("json");
    if (!code) return c.json(err("Missing code"), 400);

    // Verify the state parameter to prevent CSRF attacks
    const isValidState = await verifyOAuthState(state, c.env.JWT_SECRET);
    if (!isValidState) {
        return c.json(err("Invalid or expired state parameter - possible CSRF attack"), 400);
    }

    const db = createDb(c.env.DB);

    // Get user info from Google
    const profile = await exchangeCodeForProfile(
        code,
        c.env.GOOGLE_CLIENT_ID,
        c.env.GOOGLE_CLIENT_SECRET,
        c.env.GOOGLE_REDIRECT_URI
    );

    // Find existing user OR create new one (this is called "upsert on OAuth")
    let user = await db.select().from(users).where(eq(users.googleId, profile.sub)).get();

    if (!user) {
        // Check if email already exists (user signed up with password before)
        const byEmail = await db.select().from(users).where(eq(users.email, profile.email)).get();

        if (byEmail) {
            // Link Google account to existing email account
            user = await db.update(users)
                .set({ googleId: profile.sub })
                .where(eq(users.id, byEmail.id))
                .returning().get();
        } else {
            // Brand new user — create account (no password)
            user = await db.insert(users).values({
                name: profile.name,
                email: profile.email,
                phone: "",           // Google doesn't give phone — tenant fills later
                passwordHash: null,  // no password for OAuth users
                googleId: profile.sub,
                role: "tenant",
                isActive: true,
                createdAt: nowISO(),
            }).returning().get();
        }
    }

    if (!user) return c.json(err("Failed to create account"), 500);
    if (!user.isActive) return c.json(err("Account is deactivated"), 403);

    // Issue your own JWT — same as regular login from here
    const token = await signJwt(
        { sub: user.id, email: user.email, role: user.role },
        c.env.JWT_SECRET
    );

    return c.json(ok({ token, user: omit(user, ["passwordHash"]) }));
});

// ─── GET /api/auth/me ─────────────────────────────────────────
auth.get("/me", requireAuth(), async (c) => {
    const { sub } = c.get("user");
    const db = createDb(c.env.DB);

    const user = await db
        .select()
        .from(users)
        .where(eq(users.id, sub))
        .get();

    if (!user) return c.json(err("User not found"), 404);

    return c.json(ok({ user: omit(user, ["passwordHash"]) }));
});

// ─── PUT /api/auth/me ─────────────────────────────────────────
auth.put("/me", requireAuth(), zValidator("json", updateProfileSchema), async (c) => {
    const { sub } = c.get("user");
    const body = c.req.valid("json");
    const db = createDb(c.env.DB);

    const updatedUser = await db
        .update(users)
        .set(body)
        .where(eq(users.id, sub))
        .returning()
        .get();

    if (!updatedUser) return c.json(err("User not found or update failed"), 404);

    return c.json(ok({ user: omit(updatedUser, ["passwordHash"]) }));
});

export default auth;