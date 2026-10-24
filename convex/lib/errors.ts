import { ConvexError } from "convex/values";

// BUILD-CONTRACT "API conventions": errors carry the HTTP-style code the UI and API routes map to.
export type ErrorCode = 401 | 403 | 404 | 409 | 422 | 503;

export function fail(code: ErrorCode, message: string): never {
  throw new ConvexError({ code, message });
}
