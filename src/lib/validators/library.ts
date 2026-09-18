import { z } from "zod";
import { uuid } from "./admin";

/**
 * Knowledge Library request schemas.
 *
 * The resource id is the only thing the browser gets to choose, so it is parsed
 * as a uuid here and then re-resolved server-side against status and department
 * scope before any retrieval runs. A syntactically valid id is not an authorised
 * one, and nothing downstream treats it as such.
 */

export const resourceIdSchema = uuid;

export const resourceChatSchema = z.object({
  resourceId: uuid,
});
