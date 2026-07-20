import { z } from "zod";
import { listQuerySchema, uuid } from "./admin";

/** Knowledge-module request schemas. Reuses listQuerySchema/uuid from admin.ts. */

export const documentStatusSchema = z.enum([
  "draft",
  "processing",
  "active",
  "inactive",
  "failed",
  "archived",
]);

export const listDocumentsQuerySchema = listQuerySchema.extend({
  departmentId: uuid.optional(),
  status: documentStatusSchema.optional(),
  sortBy: z
    .enum(["title", "department", "version", "status", "chunks", "created", "updated"])
    .default("created"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});

/** Multipart text fields. The file itself is validated in the service. */
export const uploadFieldsSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional(),
  departmentId: uuid,
  /** Present when replacing an existing document with a new version. */
  replacesId: uuid.optional(),
});

/** Lifecycle transitions an admin may request directly. 'processing' and
 *  'failed' are set by the pipeline, never by a caller. */
export const setStatusSchema = z.object({
  status: z.enum(["active", "archived", "inactive"]),
});

/** Editing a document's metadata — title, description, department — without
 *  re-uploading the file. At least one field must be present. */
export const updateDocumentSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    departmentId: uuid.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });

export const chunksQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const retrieveQuerySchema = z.object({
  q: z.string().trim().min(2).max(500),
  departmentId: uuid.optional(),
  global: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});
