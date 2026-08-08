/**
 * Command response schema — ported from `evnex/schema/commands.py`.
 */

import { z } from "zod";

export const EvnexCommandResponse = z.object({
  message: z.string(),
  status: z.string(), // "Accepted"
});
export type EvnexCommandResponse = z.infer<typeof EvnexCommandResponse>;
