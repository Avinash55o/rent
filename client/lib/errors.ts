/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Safely extract an error message string from an API error response.
 * Handles:
 * - Axios errors with string error: { response: { data: { error: "message" } } }
 * - Zod validation errors: { response: { data: { error: { issues: [...] } } } }
 * - Network errors: { message: "Network Error" }
 * - Unknown errors
 */
export function getErrorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (!err || typeof err !== "object") return fallback;

  const error = err as any;

  // Axios error with response
  const dataError = error?.response?.data?.error;
  if (dataError) {
    if (typeof dataError === "string") return dataError;
    // Zod validation error — issues as an array (Hono zValidator format)
    if (Array.isArray(dataError) && dataError.length > 0) {
      return dataError[0]?.message || "Validation error";
    }
    // Zod validation error — object with issues array
    if (dataError?.issues && Array.isArray(dataError.issues) && dataError.issues.length > 0) {
      return dataError.issues[0]?.message || "Validation error";
    }
    // Other object error
    if (typeof dataError === "object" && dataError.message) {
      return String(dataError.message);
    }
    return "Validation error";
  }

  // Check if the response data itself is an array (some APIs return errors this way)
  const responseData = error?.response?.data;
  if (Array.isArray(responseData) && responseData.length > 0) {
    return responseData[0]?.message || "Validation error";
  }

  // Axios error message
  const responseMessage = error?.response?.data?.message;
  if (typeof responseMessage === "string") return responseMessage;

  // Generic error with message
  if (typeof error?.message === "string") return error.message;

  return fallback;
}
