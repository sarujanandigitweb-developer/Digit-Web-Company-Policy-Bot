import { z } from "zod";

/**
 * Every expected failure is an AppError carrying its own HTTP status, so route
 * handlers throw instead of assembling Responses, and one place decides what the
 * client sees. Anything else that escapes is a bug and becomes a 500 with the
 * detail logged but not returned.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const BadRequest = (message: string, details?: unknown) =>
  new AppError(400, "bad_request", message, details);

/** Not authenticated — no/invalid token. */
export const Unauthorized = (message = "Authentication required") =>
  new AppError(401, "unauthorized", message);

/** Authenticated but not permitted. Distinct from 401: re-logging in won't help. */
export const Forbidden = (message = "You do not have permission to do this") =>
  new AppError(403, "forbidden", message);

export const NotFound = (message = "Not found") => new AppError(404, "not_found", message);

/** State prevents the action, e.g. deleting a department that still has documents. */
export const Conflict = (message: string, details?: unknown) =>
  new AppError(409, "conflict", message, details);

export const UnprocessableEntity = (message: string, details?: unknown) =>
  new AppError(422, "unprocessable_entity", message, details);

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

/**
 * Maps any thrown value to a Response. Zod failures become 422 with the issue
 * list; AppErrors use their own status; everything else is logged and returned
 * as an opaque 500 — internal messages must not leak to callers.
 */
export function toErrorResponse(error: unknown): Response {
  if (error instanceof z.ZodError) {
    return json(422, {
      error: {
        code: "validation_failed",
        message: "Request validation failed",
        details: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    });
  }

  if (error instanceof AppError) {
    return json(error.status, {
      error: { code: error.code, message: error.message, details: error.details },
    });
  }

  console.error("[api] unhandled error:", error);
  return json(500, { error: { code: "internal_error", message: "Something went wrong" } });
}

function json(status: number, body: ErrorBody): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Success helper so handlers never hand-roll headers. */
export function ok(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}
