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

    const token = await signToken(
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

    const token = await signToken({
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

// Google OAuth — callback
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

    const token = await signToken({
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
