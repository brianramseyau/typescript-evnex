/**
 * Command response schema — ported from `evnex/schema/commands.py`.
 *
 * TODO(A3): implement/refine and add tests.
 */

import { z } from "zod";

export const EvnexCommandResponse = z.object({
  message: z.string(),
  status: z.string(), // "Accepted"
});
export type EvnexCommandResponse = z.infer<typeof EvnexCommandResponse>;
