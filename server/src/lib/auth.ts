export interface JWTPayload {
    userId: string;
    email: string;
    role: "admin" | "tenant";
    tenantProfileId?: string;
}

// ── Helpers ────────────────────────────────────────

function base64UrlEncode(data: ArrayBuffer | Uint8Array): string {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
    let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4) base64 += "=";
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

async function hmacSign(secret: string, data: string): Promise<string> {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw",
        enc.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
    return base64UrlEncode(sig);
}

async function hmacVerify(secret: string, data: string, signature: string): Promise<boolean> {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw",
        enc.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"]
    );
    const sigBytes = base64UrlDecode(signature) as Uint8Array<ArrayBuffer>;
    return crypto.subtle.verify("HMAC", key, sigBytes, enc.encode(data));
}

// ── JWT (HS256 via Web Crypto) ─────────────────────

export async function signToken(payload: JWTPayload, secret: string, expiresIn = "7d"): Promise<string> {
    const header = { alg: "HS256", typ: "JWT" };
    const now = Math.floor(Date.now() / 1000);
    const exp = now + parseDuration(expiresIn);

    const enc = new TextEncoder();
    const headerB64 = base64UrlEncode(enc.encode(JSON.stringify(header)));
    const payloadB64 = base64UrlEncode(enc.encode(JSON.stringify({ ...payload, iat: now, exp })));

    const signature = await hmacSign(secret, `${headerB64}.${payloadB64}`);
    return `${headerB64}.${payloadB64}.${signature}`;
}

export async function verifyToken(token: string, secret: string): Promise<JWTPayload> {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Invalid token format");

    const [headerB64, payloadB64, signature] = parts;
    const valid = await hmacVerify(secret, `${headerB64}.${payloadB64}`, signature);
    if (!valid) throw new Error("Invalid token signature");

    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64)));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        throw new Error("Token expired");
    }
    return payload as JWTPayload;
}

function parseDuration(dur: string): number {
    const match = dur.match(/^(\d+)([smhd])$/);
    if (!match) return 7 * 86400; // default 7 days
    const val = parseInt(match[1], 10);
    switch (match[2]) {
        case "s": return val;
        case "m": return val * 60;
        case "h": return val * 3600;
        case "d": return val * 86400;
        default: return 7 * 86400;
    }
}

// ── Password hashing (PBKDF2 via Web Crypto) ──────

const PBKDF2_ITERATIONS = 100_000;
const SALT_LENGTH = 16;

export async function hashPassword(password: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
    const derived = await crypto.subtle.deriveBits(
        { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
        key,
        256
    );
    const saltHex = [...salt].map((b) => b.toString(16).padStart(2, "0")).join("");
    const hashHex = [...new Uint8Array(derived)].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${PBKDF2_ITERATIONS}:${saltHex}:${hashHex}`;
}

export async function comparePassword(password: string, stored: string): Promise<boolean> {
    const [iterStr, saltHex, storedHashHex] = stored.split(":");
    const iterations = parseInt(iterStr, 10);
    const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
    const derived = await crypto.subtle.deriveBits(
        { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
        key,
        256
    );
    const hashHex = [...new Uint8Array(derived)].map((b) => b.toString(16).padStart(2, "0")).join("");
    return hashHex === storedHashHex;
}
