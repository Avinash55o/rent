/**
 * Simple in-memory rate limiting middleware for Cloudflare Workers.
 *
 * NOTE: This uses a Map that persists within a single Worker instance.
 * In a production environment with multiple Workers, consider using:
 * - Cloudflare KV for distributed rate limiting
 * - Cloudflare Rate Limiting (paid feature)
 * - Durable Objects for consistent state
 *
 * For a single-instance development/small deployment, this works well.
 */

import type { Context, Next, MiddlewareHandler } from "hono";
import type { Env } from "../types/env";
import { err } from "../types/api";

interface RateLimitEntry {
    count: number;
    resetAt: number;
}

// In-memory store for rate limit tracking
// Key format: "action:identifier" (e.g., "login:user@example.com" or "signup:192.168.1.1")
const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up expired entries periodically to prevent memory leaks
let lastCleanup = Date.now();
const CLEANUP_INTERVAL_MS = 60000; // Clean every minute

function cleanupExpiredEntries(): void {
    const now = Date.now();
    if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;

    lastCleanup = now;
    for (const [key, entry] of rateLimitStore.entries()) {
        if (now > entry.resetAt) {
            rateLimitStore.delete(key);
        }
    }
}

/**
 * Check if a request should be rate limited.
 * Returns true if the request is allowed, false if it should be blocked.
 */
export function checkRateLimit(
    key: string,
    maxAttempts: number,
    windowMs: number
): { allowed: boolean; remaining: number; resetAt: number } {
    cleanupExpiredEntries();

    const now = Date.now();
    const entry = rateLimitStore.get(key);

    // No existing entry or window expired - allow and start fresh
    if (!entry || now > entry.resetAt) {
        const resetAt = now + windowMs;
        rateLimitStore.set(key, { count: 1, resetAt });
        return { allowed: true, remaining: maxAttempts - 1, resetAt };
    }

    // Window still active - check count
    if (entry.count >= maxAttempts) {
        return { allowed: false, remaining: 0, resetAt: entry.resetAt };
    }

    // Increment count and allow
    entry.count++;
    return { allowed: true, remaining: maxAttempts - entry.count, resetAt: entry.resetAt };
}

/**
 * Reset rate limit for a specific key (e.g., after successful login)
 */
export function resetRateLimit(key: string): void {
    rateLimitStore.delete(key);
}

/**
 * Create a rate limiting middleware for Hono.
 *
 * @param keyGenerator - Function to generate the rate limit key from request context
 * @param maxAttempts - Maximum number of requests allowed in the window
 * @param windowMs - Time window in milliseconds
 * @param message - Error message to return when rate limited
 */
export function rateLimit(options: {
    keyGenerator: (c: Context) => string;
    maxAttempts: number;
    windowMs: number;
    message?: string;
}): MiddlewareHandler<{ Bindings: Env }> {
    const {
        keyGenerator,
        maxAttempts,
        windowMs,
        message = "Too many requests. Please try again later.",
    } = options;

    return async (c: Context, next: Next) => {
        const key = keyGenerator(c);
        const result = checkRateLimit(key, maxAttempts, windowMs);

        // Set rate limit headers
        c.header("X-RateLimit-Limit", maxAttempts.toString());
        c.header("X-RateLimit-Remaining", result.remaining.toString());
        c.header("X-RateLimit-Reset", Math.ceil(result.resetAt / 1000).toString());

        if (!result.allowed) {
            const retryAfterSeconds = Math.ceil((result.resetAt - Date.now()) / 1000);
            c.header("Retry-After", retryAfterSeconds.toString());
            return c.json(err(message), 429);
        }

        await next();
    };
}

/**
 * Pre-configured rate limiter for login attempts.
 * Limits: 5 attempts per 15 minutes per email address.
 */
export function loginRateLimit(): MiddlewareHandler<{ Bindings: Env }> {
    return rateLimit({
        keyGenerator: (c) => {
            // Rate limit by email from request body
            // Note: We need to read the body, but Hono's validator will handle this
            // For now, we'll use IP + path as fallback
            const ip = c.req.header("CF-Connecting-IP") ||
                       c.req.header("X-Forwarded-For")?.split(",")[0] ||
                       "unknown";
            return `login:${ip}`;
        },
        maxAttempts: 5,
        windowMs: 15 * 60 * 1000, // 15 minutes
        message: "Too many login attempts. Please try again in 15 minutes.",
    });
}

/**
 * Pre-configured rate limiter for signup attempts.
 * Limits: 3 signups per hour per IP address.
 */
export function signupRateLimit(): MiddlewareHandler<{ Bindings: Env }> {
    return rateLimit({
        keyGenerator: (c) => {
            const ip = c.req.header("CF-Connecting-IP") ||
                       c.req.header("X-Forwarded-For")?.split(",")[0] ||
                       "unknown";
            return `signup:${ip}`;
        },
        maxAttempts: 3,
        windowMs: 60 * 60 * 1000, // 1 hour
        message: "Too many signup attempts. Please try again in an hour.",
    });
}

/**
 * Helper to create a rate limit key that combines IP and email.
 * Call this in the route handler after validating the body.
 */
export function getRateLimitKey(action: string, ip: string, email?: string): string {
    if (email) {
        return `${action}:${email}:${ip}`;
    }
    return `${action}:${ip}`;
}
