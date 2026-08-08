/**
 * SRP (Secure Remote Password) protocol maths for Cognito's `USER_SRP_AUTH`,
 * per RFC 5054 with AWS's Cognito-specific variations — see PLAN.md §3.3.
 *
 * Pure, dependency-free, network-free: the highest-risk component in the
 * port, deliberately isolated so it can be tested exhaustively without any
 * AWS involvement (a differential oracle against `amazon-cognito-identity-js`
 * is the primary mitigation — PLAN.md §5 A5, §8 risk 1).
 *
 * TODO(A5): implement.
 */

export interface SrpChallengeParams {
  srpB: string;
  salt: string;
  secretBlock: string;
  username: string;
  password: string;
  /** Overridable for deterministic tests; defaults to the current time. */
  timestamp?: Date;
}

export interface SrpChallengeResponse {
  signature: string;
  timestamp: string;
}

export interface SrpClient {
  /** `A = g^a mod N`, hex-encoded, to send as `SRP_A` in `InitiateAuth`. */
  srpA: string;
  computeChallengeResponse(params: SrpChallengeParams): SrpChallengeResponse;
}

/**
 * Build an SRP client for one authentication attempt.
 *
 * @param poolName the user pool id's segment after the underscore
 *   (`ap-southeast-2_zWnqo6ASv` -> `zWnqo6ASv`)
 */
export function createSrpClient(poolName: string): SrpClient {
  throw new Error("TODO(A5)");
}
