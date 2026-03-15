
// ─── Password Hashing (PBKDF2 via Web Crypto) ────────────────

const ITERATIONS = 100_000; // Higher = slower = more secure. 100k is a good baseline.
const HASH_ALGORITHM = "SHA-256";
const KEY_LENGTH = 32; // bytes

/**
 * Hash a plain-text password using PBKDF2.
 * Stores the salt alongside the hash (needed to verify later).
 *
 * Output format: "salt:hash" (both hex-encoded)
 */
export async function hashPassword(password: string): Promise<string> {
    const encoder = new TextEncoder();

    // Generate a random 16-byte salt
    const saltBytes = crypto.getRandomValues(new Uint8Array(16));
    const salt = bufToHex(saltBytes);

    // Derive a key from the password + salt
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        encoder.encode(password),
        "PBKDF2",
        false,
        ["deriveBits"]
    );

    const hashBuffer = await crypto.subtle.deriveBits(
        {
            name: "PBKDF2",
            salt: saltBytes,
            iterations: ITERATIONS,
            hash: HASH_ALGORITHM,
        },
        keyMaterial,
        KEY_LENGTH * 8 // bits
    );

    const hash = bufToHex(new Uint8Array(hashBuffer));
    return `${salt}:${hash}`;
}

/**
 * Compare a plain-text password against a stored hash.
 * Returns true if they match.
 */
export async function verifyPassword(
    password: string,
    stored: string
): Promise<boolean> {
    const [saltHex, storedHash] = stored.split(":");
    if (!saltHex || !storedHash) return false;

    const encoder = new TextEncoder();
    const saltBytes = hexToBuf(saltHex);

    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        encoder.encode(password),
        "PBKDF2",
        false,
        ["deriveBits"]
    );

    const hashBuffer = await crypto.subtle.deriveBits(
        {
            name: "PBKDF2",
            salt: saltBytes,
            iterations: ITERATIONS,
            hash: HASH_ALGORITHM,
        },
        keyMaterial,
        KEY_LENGTH * 8
    );

    const computedHash = bufToHex(new Uint8Array(hashBuffer));
    return constantTimeEqual(computedHash, storedHash);
}

// ─── Date Helpers ─────────────────────────────────────────────

/** Current UTC datetime as ISO 8601 string */
export function nowISO(): string {
    return new Date().toISOString();
}

/** Format a Date as "YYYY-MM" (used for rentMonth field) */
export function toRentMonth(date: Date): string {
    return date.toISOString().slice(0, 7);
}

/** Format a Date as "YYYY-MM-DD" */
export function toDateString(date: Date): string {
    return date.toISOString().slice(0, 10);
}

/**
 * Calculate the next rent due date.
 * Rent is due on the 1st of the next month.
 * e.g. move-in on 2025-06-15 → next due date is 2025-07-01
 */
export function getNextRentDueDate(fromDate: Date): string {
    const next = new Date(fromDate);
    next.setMonth(next.getMonth() + 1);
    next.setDate(1);
    return toDateString(next);
}

/**
 * Check if today is within the rent payment window.
 * Returns true if today's day of month is between startDay and endDay (inclusive).
 */
export function isWithinRentWindow(startDay: number, endDay: number): boolean {
    const today = new Date().getUTCDate();
    return today >= startDay && today <= endDay;
}

/**
 * Check if rent is overdue.
 * Overdue = today's day of month is past the endDay AND rent for current month not paid.
 */
export function isRentOverdue(endDay: number): boolean {
    return new Date().getUTCDate() > endDay;
}

// ─── Crypto Helpers ──────────────────────────────────────────

function bufToHex(buf: Uint8Array): string {
    return Array.from(buf)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

function hexToBuf(hex: string): Uint8Array {
    const pairs = hex.match(/.{2}/g) ?? [];
    return new Uint8Array(pairs.map((p) => parseInt(p, 16)));
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * Uses XOR comparison on each byte — always compares all bytes
 * regardless of where the first mismatch occurs.
 */
export function constantTimeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) {
        result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
}

// ─── Razorpay Signature Verification ─────────────────────────

/**
 * Verify Razorpay webhook/payment signature using HMAC-SHA256.
 * Razorpay signs the payload with your key secret. We verify it matches.
 *
 * For payment verification:
 *   message = razorpay_order_id + "|" + razorpay_payment_id
 *   signature = HMAC-SHA256(message, key_secret)
 */
export async function verifyRazorpaySignature(
    orderId: string,
    paymentId: string,
    signature: string,
    keySecret: string
): Promise<boolean> {
    const message = `${orderId}|${paymentId}`;
    const encoder = new TextEncoder();

    const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(keySecret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );

    const signatureBuffer = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(message)
    );

    const expectedSignature = bufToHex(new Uint8Array(signatureBuffer));
    return constantTimeEqual(expectedSignature, signature);
}

// ─── OAuth State Token (CSRF Protection) ─────────────────────

/**
 * Create a signed OAuth state token to prevent CSRF attacks.
 * The state contains a timestamp and random value, signed with HMAC.
 * Format: "timestamp:random:signature"
 *
 * The state expires after 10 minutes to prevent replay attacks.
 */
export async function createOAuthState(secret: string): Promise<string> {
    const timestamp = Date.now();
    const random = crypto.randomUUID();
    const payload = `${timestamp}:${random}`;

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );

    const signatureBuffer = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(payload)
    );

    const signature = bufToHex(new Uint8Array(signatureBuffer));
    return `${payload}:${signature}`;
}

/**
 * Verify an OAuth state token.
 * Returns true if:
 * - The signature is valid
 * - The token is not expired (10 minute window)
 */
export async function verifyOAuthState(
    state: string,
    secret: string,
    maxAgeMs: number = 10 * 60 * 1000 // 10 minutes
): Promise<boolean> {
    try {
        const parts = state.split(":");
        if (parts.length !== 3) return false;

        const [timestampStr, random, signature] = parts as [string, string, string];
        const timestamp = parseInt(timestampStr, 10);

        if (isNaN(timestamp)) return false;

        // Check expiry
        const now = Date.now();
        if (now - timestamp > maxAgeMs) return false;

        // Verify signature
        const payload = `${timestamp}:${random}`;
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
            "raw",
            encoder.encode(secret),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign"]
        );

        const expectedSigBuffer = await crypto.subtle.sign(
            "HMAC",
            key,
            encoder.encode(payload)
        );

        const expectedSignature = bufToHex(new Uint8Array(expectedSigBuffer));
        return constantTimeEqual(signature, expectedSignature);
    } catch {
        return false;
    }
}

// ─── Misc ─────────────────────────────────────────────────────

/** Generate a simple alphanumeric ID (for receipt numbers, etc.) */
export function generateReceiptNumber(): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `RCP-${timestamp}-${random}`;
}

/** Pick specific keys from an object (like lodash.pick) */
export function pick<T extends object, K extends keyof T>(
    obj: T,
    keys: K[]
): Pick<T, K> {
    return keys.reduce((acc, key) => {
        acc[key] = obj[key];
        return acc;
    }, {} as Pick<T, K>);
}

/** Omit specific keys from an object (useful for removing passwordHash) */
export function omit<T extends object, K extends keyof T>(
    obj: T,
    keys: K[]
): Omit<T, K> {
    const result = { ...obj };
    for (const key of keys) delete result[key];
    return result as Omit<T, K>;
}

/**
 * Escape a value for CSV output.
 * - Converts to string
 * - Escapes double quotes by doubling them ("" for each ")
 * - Wraps in quotes if the value contains comma, newline, or quote
 * - Also handles CSV injection by prefixing dangerous characters
 */
export function escapeCSV(value: unknown): string {
    const str = String(value ?? "");

    // CSV injection prevention: prefix cells starting with dangerous characters
    // These could be interpreted as formulas in Excel/Google Sheets
    if (/^[=+\-@\t\r]/.test(str)) {
        return `"'${str.replace(/"/g, '""')}"`;
    }

    // Escape quotes by doubling them
    const escaped = str.replace(/"/g, '""');

    // Wrap in quotes if contains special characters
    if (/[",\n\r]/.test(str)) {
        return `"${escaped}"`;
    }

    // Always wrap in quotes for consistency and safety
    return `"${escaped}"`;
}