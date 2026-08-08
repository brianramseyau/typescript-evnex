/**
 * Client configuration — ported from `evnex/config.py`'s `EvnexConfig`
 * (a `pydantic-settings` `BaseSettings`).
 *
 * Reads `process.env` for the four `EVNEX_*` variables with defaults
 * matching Python's. An explicit partial override object wins over the
 * environment.
 */

export interface EvnexConfigOptions {
  EVNEX_BASE_URL?: string;
  EVNEX_COGNITO_USER_POOL_ID?: string;
  EVNEX_COGNITO_CLIENT_ID?: string;
  EVNEX_ORG_ID?: string | undefined;
}

export class EvnexConfig {
  readonly EVNEX_BASE_URL: string;
  readonly EVNEX_COGNITO_USER_POOL_ID: string;
  readonly EVNEX_COGNITO_CLIENT_ID: string;
  readonly EVNEX_ORG_ID: string | undefined;

  constructor(overrides?: EvnexConfigOptions) {
    // Explicit overrides win over environment, which wins over defaults.
    // Treat empty string from env as if unset (the same as Python).
    if (overrides?.EVNEX_BASE_URL !== undefined) {
      this.EVNEX_BASE_URL = overrides.EVNEX_BASE_URL;
    } else {
      const baseUrlEnv = process.env["EVNEX_BASE_URL"];
      this.EVNEX_BASE_URL =
        baseUrlEnv && baseUrlEnv.length > 0
          ? baseUrlEnv
          : "https://client-api.evnex.io";
    }

    if (overrides?.EVNEX_COGNITO_USER_POOL_ID !== undefined) {
      this.EVNEX_COGNITO_USER_POOL_ID = overrides.EVNEX_COGNITO_USER_POOL_ID;
    } else {
      const poolIdEnv = process.env["EVNEX_COGNITO_USER_POOL_ID"];
      this.EVNEX_COGNITO_USER_POOL_ID =
        poolIdEnv && poolIdEnv.length > 0
          ? poolIdEnv
          : "ap-southeast-2_zWnqo6ASv";
    }

    if (overrides?.EVNEX_COGNITO_CLIENT_ID !== undefined) {
      this.EVNEX_COGNITO_CLIENT_ID = overrides.EVNEX_COGNITO_CLIENT_ID;
    } else {
      const clientIdEnv = process.env["EVNEX_COGNITO_CLIENT_ID"];
      this.EVNEX_COGNITO_CLIENT_ID =
        clientIdEnv && clientIdEnv.length > 0
          ? clientIdEnv
          : "rol3lsv2vg41783550i18r7vi";
    }

    if (overrides?.EVNEX_ORG_ID !== undefined) {
      this.EVNEX_ORG_ID = overrides.EVNEX_ORG_ID;
    } else {
      const orgIdEnv = process.env["EVNEX_ORG_ID"];
      this.EVNEX_ORG_ID =
        orgIdEnv && orgIdEnv.length > 0 ? orgIdEnv : undefined;
    }
  }
}
