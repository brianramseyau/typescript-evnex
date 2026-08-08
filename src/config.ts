/**
 * Client configuration — ported from `evnex/config.py`'s `EvnexConfig`
 * (a `pydantic-settings` `BaseSettings`).
 *
 * TODO(A1): implement. Read `process.env` for the four `EVNEX_*` variables
 * below, with the same defaults as Python, and let an explicit partial
 * override object win over the environment.
 */

export interface EvnexConfigOptions {
  EVNEX_BASE_URL?: string;
  EVNEX_COGNITO_USER_POOL_ID?: string;
  EVNEX_COGNITO_CLIENT_ID?: string;
  EVNEX_ORG_ID?: string | undefined;
}

export class EvnexConfig {
  readonly EVNEX_BASE_URL!: string;
  readonly EVNEX_COGNITO_USER_POOL_ID!: string;
  readonly EVNEX_COGNITO_CLIENT_ID!: string;
  readonly EVNEX_ORG_ID: string | undefined;

  constructor(overrides?: EvnexConfigOptions) {
    throw new Error("TODO(A1)");
  }
}
