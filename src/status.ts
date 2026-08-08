/**
 * Charge point / connector status — ported from `evnex/status.py`.
 *
 * TODO(A1): implement. `DeviceStatus` is a `z.enum` plus a `const` object for
 * value access (StrEnum analogue, PLAN.md §2.2). `ConnectorOcppStatus` is a
 * `Record<DeviceStatus, string>`, exhaustive over `DeviceStatus`, with every
 * string preserved verbatim from the Python source.
 */

import { z } from "zod";

export const DeviceStatus = z.enum([
  "OFFLINE",
  "AVAILABLE",
  "PREPARING",
  "CHARGING",
  "SUSPENDED_EVSE",
  "SUSPENDED_EV",
  "FINISHING",
  "RESERVED",
  "UNAVAILABLE",
  "FAULTED",
]);
export type DeviceStatus = z.infer<typeof DeviceStatus>;

/** Value-access analogue of Python's `StrEnum` members. */
export const DeviceStatusValues: Record<DeviceStatus, DeviceStatus> = {
  OFFLINE: "OFFLINE",
  AVAILABLE: "AVAILABLE",
  PREPARING: "PREPARING",
  CHARGING: "CHARGING",
  SUSPENDED_EVSE: "SUSPENDED_EVSE",
  SUSPENDED_EV: "SUSPENDED_EV",
  FINISHING: "FINISHING",
  RESERVED: "RESERVED",
  UNAVAILABLE: "UNAVAILABLE",
  FAULTED: "FAULTED",
};

/**
 * Human-readable OCPP status text per DeviceStatus, exhaustive over the enum.
 *
 * TODO(A1): populate verbatim from evnex/status.py's ConnectorOcppStatus.
 * Left as an (exhaustive, type-checked) placeholder rather than a throwing
 * stub, unlike the rest of this codebase's stubs: it is plain data re-
 * exported eagerly by src/index.ts, and a throw at module-evaluation time
 * would break every consumer of the barrel, not just callers of one
 * function.
 */
export const ConnectorOcppStatus: Record<DeviceStatus, string> = {
  OFFLINE: "TODO(A1)",
  AVAILABLE: "TODO(A1)",
  PREPARING: "TODO(A1)",
  CHARGING: "TODO(A1)",
  SUSPENDED_EVSE: "TODO(A1)",
  SUSPENDED_EV: "TODO(A1)",
  FINISHING: "TODO(A1)",
  RESERVED: "TODO(A1)",
  UNAVAILABLE: "TODO(A1)",
  FAULTED: "TODO(A1)",
};
