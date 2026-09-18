import { z } from "zod";

/**
 * Validators for the Document Library's own routes.
 *
 * Separate from validators/library.ts, which belongs to the Admin Knowledge
 * Library (knowledge_documents.folder_id, a database UUID). This file
 * validates Google Drive's own id format, which is neither a UUID nor
 * anything the admin side ever handles.
 */

/**
 * The browser sends the stable library node id (`d:<Drive id>`), not the raw
 * Drive id. The prefix distinguishes linked documents from path-based folders.
 */
export const driveFileIdSchema = z
  .string()
  .trim()
  .regex(/^d:[A-Za-z0-9_-]{10,80}$/, "Not a valid Document Library document id");

export const askDocumentSchema = z.object({
  driveFileId: driveFileIdSchema,
});
