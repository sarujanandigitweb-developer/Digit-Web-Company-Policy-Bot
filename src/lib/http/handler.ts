import { BadRequest, toErrorResponse } from "./errors";

/**
 * The slice of TanStack's route context these handlers use.
 *
 * `params` is optional because collection routes (/departments) are handed a
 * context without it while single-resource routes (/departments/$id) are not.
 * Declaring it optional keeps one wrapper usable for both.
 */
export interface ApiCtx {
  request: Request;
  params?: Record<string, string | undefined>;
}

/**
 * Wraps a route handler so every thrown AppError/ZodError becomes the right
 * Response in one place. This is what removes try/catch from the handlers: they
 * throw, and the wrapper decides what the client sees.
 *
 *   POST: api(async ({ request }) => { ... })
 */
export function api(handler: (ctx: ApiCtx) => Promise<Response>) {
  return async (ctx: ApiCtx): Promise<Response> => {
    try {
      return await handler(ctx);
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}

/** Reads a required route parameter, 400-ing rather than passing undefined on. */
export function routeParam(ctx: ApiCtx, name: string): string {
  const value = ctx.params?.[name];
  if (!value) throw BadRequest(`Missing route parameter: ${name}`);
  return value;
}

/** Parses a JSON body, turning malformed JSON into a 400 rather than a 500. */
export async function jsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw BadRequest("Request body must be valid JSON");
  }
}
