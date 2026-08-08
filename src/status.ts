/**
 * Charge point / connector status — ported from `evnex/status.py`.
 *
 * `DeviceStatus` is a `z.enum` plus a `const` object for value access
 * (StrEnum analogue, PLAN.md §2.2). `ConnectorOcppStatus` is a
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
 * Preserved verbatim from python-evnex.
 */
export const ConnectorOcppStatus: Record<DeviceStatus, string> = {
  AVAILABLE: "Available",
  CHARGING: "Charging",
  FAULTED: "Faulted",
  FINISHING: "Finished charging - unplug charge point",
  PREPARING: "Preparing to charge",
  RESERVED: "Reserved",
  SUSPENDED_EV: "The vehicle is not currently requesting energy",
  SUSPENDED_EVSE: "Charging has been paused by the charge point",
  UNAVAILABLE: "Disabled",
  OFFLINE: "Offline",
};
