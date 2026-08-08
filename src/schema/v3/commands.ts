/**
 * v3 command response schema — ported from `evnex/schema/v3/commands.py`.
 *
 */

import { z } from "zod";

export const EvnexCommandResponse = z.object({
  message: z.string().nullish(),
  status: z.string(), // Accepted
});
export type EvnexCommandResponse = z.infer<typeof EvnexCommandResponse>;
