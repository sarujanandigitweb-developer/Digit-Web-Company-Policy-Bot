import { getToken } from "@/lib/auth/client";

/**
 * Client for our own admin API.
 *
 * Attaches the Bearer token to every call and turns the server's error envelope
 * back into a typed error, so pages surface the server's own message rather than
 * inventing their own wording for the same failure.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Zod issue list on a 422, so forms can mark the offending field. */
    readonly details?: Array<{ path: string; message: string }>,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get isPermissionDenied() {
    return this.status === 401 || this.status === 403;
  }
  get isValidation() {
    return this.status === 422;
  }
}

interface ServerError {
  error?: { code?: string; message?: string; details?: Array<{ path: string; message: string }> };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken();
  if (!token)
    throw new ApiError(401, "unauthorized", "Your session has expired. Please sign in again.");

  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  // FormData sets its own multipart boundary; overriding it corrupts the body.
  if (init.body && !(init.body instanceof FormData))
    headers.set("content-type", "application/json");

  const response = await fetch(path, { ...init, headers });

  if (response.status === 204) return undefined as T;

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const err = (body ?? {}) as ServerError;
    throw new ApiError(
      response.status,
      err.error?.code ?? "error",
      err.error?.message ?? `Request failed (${response.status})`,
      err.error?.details,
    );
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "POST",
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

/** Builds a query string, dropping empty values so filters can be optional. */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const str = search.toString();
  return str ? `?${str}` : "";
}

// --- shared response shapes -------------------------------------------------

export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AdminUser {
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: "super_admin" | "admin" | "staff";
  department_id: string | null;
  department_name: string | null;
  status: "active" | "suspended";
  created_at: string;
  updated_at: string;
}

export interface Department {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: "active" | "inactive";
  is_shared: boolean;
  document_count: number;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeDocument {
  id: string;
  department_id: string;
  department_name: string | null;
  title: string;
  description: string | null;
  file_name: string;
  file_type: "pdf" | "docx" | "txt" | "md";
  file_size_bytes: number;
  version: number;
  supersedes_id: string | null;
  status: "draft" | "processing" | "active" | "inactive" | "failed" | "archived";
  processing_error: string | null;
  processing_attempts: number;
  processing_started_at: string | null;
  processing_completed_at: string | null;
  chunk_count: number;
  embedded_count: number;
  page_count: number | null;
  uploaded_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeStats {
  total_documents: number;
  draft: number;
  processing: number;
  active: number;
  failed: number;
  archived: number;
  chunk_count: number;
  embedding_count: number;
}

export interface ActivityItem {
  id: number;
  action: string;
  table_name: string | null;
  record_id: string | null;
  created_at: string;
  actor_name: string | null;
  subject: string | null;
}

export type Health = "healthy" | "warning" | "offline";

export interface SystemStatus {
  overall: Health;
  checks: Array<{ name: string; status: Health; detail: string; latency_ms: number | null }>;
  queue_depth: number;
  failed_documents: number;
}
