/**
 * HOW JWT AUTH WORKS:
 * 1. Tenant logs in → server creates a JWT (signed token with user info)
 * 2. Client stores the JWT and sends it in every request:
 *    Authorization: Bearer <token>
 * 3. This middleware intercepts the request, verifies the JWT,
 *    and stores the decoded user in Hono's context (c.set("user", ...))
 * 4. Route handlers read the user from context with c.get("user")
 *
 * WHY NOT SESSIONS?
 * Cloudflare Workers are stateless — there's no server memory between requests.
 * JWTs are self-contained (the token itself holds the user info), so no DB
 * lookup needed to authenticate most requests. Perfect for edge computing.
 *
 * IMPORTANT: We use the Web Crypto API (crypto.subtle) because Node's `crypto`
 * module is not fully available in Workers (even with nodejs_compat).
 */

import type { Context, Next, MiddlewareHandler } from "hono";
import type { Env } from "../types/env";
import type { JwtPayload } from "../types/api";
import { err } from "../types/api";
import { constantTimeEqual } from "../utils";

// ─── Low-level JWT helpers using Web Crypto API ──────────────

/**
 * Import the JWT secret as a CryptoKey for HMAC-SHA256 signing/verification.
 * We call this once per operation (Workers don't cache between requests anyway).
 */
async function getSigningKey(secret: string): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    return crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"]
    );
}

/** Base64URL encode (JWT uses base64url, not standard base64) */
function base64urlEncode(data: ArrayBuffer | Uint8Array): string {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    let str = "";
    for (const byte of bytes) str += String.fromCharCode(byte);
    return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/** Base64URL decode */
function base64urlDecode(str: string): string {
    const padded = str.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4;
    return atob(pad ? padded + "=".repeat(4 - pad) : padded);
}

/**
 * Sign and create a JWT token.
 * Called in the login route after verifying credentials.
 */
export async function signJwt(
    payload: Omit<JwtPayload, "iat" | "exp">,
    secret: string,
    expiresInSeconds = 60 * 60 * 24 * 7 // 7 days default
): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const fullPayload: JwtPayload = {
        ...payload,
        iat: now,
        exp: now + expiresInSeconds,
    };

    const header = base64urlEncode(
        new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    );
    const body = base64urlEncode(
        new TextEncoder().encode(JSON.stringify(fullPayload))
    );
    const signingInput = `${header}.${body}`;

    const key = await getSigningKey(secret);
    const signatureBuffer = await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(signingInput)
    );

    const signature = base64urlEncode(signatureBuffer);
    return `${signingInput}.${signature}`;
}

/**
 * Verify a JWT and return the payload, or null if invalid/expired.
 */
export async function verifyJwt(
    token: string,
    secret: string
): Promise<JwtPayload | null> {
    try {
        const parts = token.split(".");
        if (parts.length !== 3) return null;

        const [header, body, signature] = parts as [string, string, string];
        const signingInput = `${header}.${body}`;

        const key = await getSigningKey(secret);
        const expectedSigBuffer = await crypto.subtle.sign(
            "HMAC",
            key,
            new TextEncoder().encode(signingInput)
        );
        const expectedSig = base64urlEncode(expectedSigBuffer);

        // Constant-time comparison to prevent timing attacks
        if (!constantTimeEqual(signature, expectedSig)) return null;

        const payload = JSON.parse(base64urlDecode(body)) as JwtPayload;

        // Check expiry
        if (payload.exp < Math.floor(Date.now() / 1000)) return null;

        return payload;
    } catch {
        return null;
    }
}

// ─── Hono Middleware Factories ────────────────────────────────

/**
 * requireAuth — verifies JWT and stores user in context.
 * Apply to any route that needs a logged-in user.
 *
 * Usage:
 *   app.get("/profile", requireAuth(), (c) => { ... })
 *   const user = c.get("user") // typed as JwtPayload
 */
export function requireAuth(): MiddlewareHandler<{ Bindings: Env; Variables: { user: JwtPayload } }> {
    return async (c: Context, next: Next) => {
        const authHeader = c.req.header("Authorization");

        if (!authHeader?.startsWith("Bearer ")) {
            return c.json(err("Missing or invalid Authorization header"), 401);
        }

        const token = authHeader.slice(7); // Remove "Bearer "
        const payload = await verifyJwt(token, c.env.JWT_SECRET);

        if (!payload) {
            return c.json(err("Invalid or expired token"), 401);
        }

        // Store decoded user in Hono context so route handlers can access it
        c.set("user", payload);
        await next();
    };
}

/**
 * requireAdmin — composes on top of requireAuth and additionally checks role === "admin".
 * Apply to all admin-only routes.
 */
export function requireAdmin(): MiddlewareHandler<{ Bindings: Env; Variables: { user: JwtPayload } }> {
    const authMiddleware = requireAuth();
    return async (c: Context, next: Next) => {
        // First, run the standard auth check
        let authPassed = false;
        await authMiddleware(c, async () => { authPassed = true; });
        if (!authPassed) return; // requireAuth already sent the error response

        // Then check admin role
        const user = c.get("user") as JwtPayload;
        if (user.role !== "admin") {
            return c.json(err("Access denied: admin only"), 403);
        }

        await next();
    };
}