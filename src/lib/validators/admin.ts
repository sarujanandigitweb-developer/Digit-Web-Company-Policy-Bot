import { z } from "zod";

/**
 * Request schemas. Every admin route parses its input through one of these, so
 * services receive values that are already the right shape and handlers never
 * hand-check fields.
 */

export const uuid = z.string().uuid("Must be a valid id");

export const roleSchema = z.enum(["super_admin", "admin", "staff"]);
export const userStatusSchema = z.enum(["active", "suspended"]);
export const departmentStatusSchema = z.enum(["active", "inactive"]);

/** Matches the CHECK constraint on departments.slug — reject here, not at the DB. */
const slugSchema = z
  .string()
  .min(2)
  .max(40)
  .regex(/^[a-z][a-z0-9_-]*$/, "Lowercase letters, digits, hyphen and underscore only");

export const sortDirectionSchema = z.enum(["asc", "desc"]).default("desc");

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  // Capped: an unbounded page size lets one request read the whole table.
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().min(1).max(200).optional(),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

// --- users -----------------------------------------------------------------

export const listUsersQuerySchema = listQuerySchema.extend({
  role: roleSchema.optional(),
  status: userStatusSchema.optional(),
  departmentId: uuid.optional(),
  // Allowlisted: these map to fixed SQL fragments, never to raw input.
  sortBy: z.enum(["name", "email", "role", "status", "created"]).default("created"),
  sortDir: sortDirectionSchema,
});

export const createUserSchema = z.object({
  email: z.string().email(),
  fullName: z.string().trim().min(1).max(120),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
  role: roleSchema,
  departmentId: uuid.nullable().optional(),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    fullName: z.string().trim().min(1).max(120).optional(),
    role: roleSchema.optional(),
    departmentId: uuid.nullable().optional(),
    status: userStatusSchema.optional(),
  })
  // An empty PATCH is a caller mistake, not a no-op worth a 200.
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

// --- departments -----------------------------------------------------------

export const createDepartmentSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  status: departmentStatusSchema.default("active"),
  /** Shared departments' knowledge is searchable from every department. */
  isShared: z.boolean().default(false),
});
export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;

export const updateDepartmentSchema = z
  .object({
    // slug is intentionally absent: application code and stored references key
    // off it, so renaming is a migration, not an edit.
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    status: departmentStatusSchema.optional(),
    isShared: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;

// --- conversations & gaps ---------------------------------------------------

export const listConversationsQuerySchema = listQuerySchema.extend({
  departmentId: uuid.optional(),
  /** Inclusive date bounds, YYYY-MM-DD, as a date input emits them. */
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  sortBy: z
    .enum(["started", "activity", "messages", "confidence", "department"])
    .default("activity"),
  sortDir: sortDirectionSchema,
});

export const gapStatusSchema = z.enum(["pending", "reviewed", "resolved", "ignored"]);

export const listGapsQuerySchema = listQuerySchema.extend({
  departmentId: uuid.optional(),
  status: gapStatusSchema.optional(),
  // Inclusive date bounds on last_asked_at (YYYY-MM-DD), matching conversations.
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  sortBy: z
    .enum(["frequency", "last_asked", "confidence", "department", "status"])
    .default("frequency"),
  sortDir: sortDirectionSchema,
});

export const updateGapSchema = z
  .object({
    // The question text and department are editable so an admin can correct a
    // mis-captured gap; the rest drive the review workflow.
    question: z.string().trim().min(1).max(2000).optional(),
    departmentId: uuid.nullable().optional(),
    status: gapStatusSchema.optional(),
    resolutionNote: z.string().trim().max(2000).nullable().optional(),
    resolvedDocumentId: uuid.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });

/** Shared body for bulk-delete endpoints: a non-empty list of ids, capped. */
export const bulkDeleteSchema = z.object({
  ids: z.array(uuid).min(1, "Select at least one record").max(500),
});
