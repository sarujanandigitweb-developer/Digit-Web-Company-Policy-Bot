import { z } from "zod";

/**
 * Validators for the Document Library's own routes.
 *
 * Separate from validators/library.ts, which belongs to the Admin Knowledge
 * Library (knowledge_documents.folder_id, a database UUID). This file
 * validates Google Drive's own id format, which is neither a UUID nor
 * anything the admin side ever handles.
 */

/** Drive/Docs ids are URL-safe base64-ish strings, typically 25-70 chars. */
export const driveFileIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{10,80}$/, "Not a valid Google Drive file id");

export const askDocumentSchema = z.object({
  driveFileId: driveFileIdSchema,
});
