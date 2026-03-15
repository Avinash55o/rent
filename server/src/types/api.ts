export type ApiSuccess<T> = {
    success: true;
    data: T;
};

export type ApiError = {
    success: false;
    error: string;
    details?: unknown;
};

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

// ─── Convenience factory functions ───────────────────────────
// Use these in route handlers instead of building objects by hand.

export function ok<T>(data: T): ApiSuccess<T> {
    return { success: true, data };
}

export function err(message: string, details?: unknown): ApiError {
    return { success: false, error: message, details };
}

// ─── JWT Payload ─────────────────────────────────────────────
// Shape of the decoded JWT token (what's stored inside the token)
export interface JwtPayload {
    sub: number;              // user id
    email: string;
    role: "admin" | "tenant";
    iat: number;              // issued at (Unix timestamp)
    exp: number;              // expires at (Unix timestamp)
}
