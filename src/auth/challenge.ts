/**
 * Pending authentication challenge — ported from `evnex/auth.py`'s
 * `AuthChallenge` (a frozen dataclass).
 *
 * JSON-serialisable so a challenge can be answered by a different process or
 * a later request (within the short session lifetime, around 3 minutes).
 *
 * TODO(A7): implement.
 */

export interface AuthChallengeOptions {
  name: string;
  session: string;
  username: string;
  parameters?: Record<string, string> | undefined;
}

export interface AuthChallengeJSON {
  name: string;
  session: string;
  username: string;
  parameters: Record<string, string>;
}

export class AuthChallenge {
  readonly name: string;
  readonly session: string;
  readonly username: string;
  readonly parameters: Readonly<Record<string, string>>;

  constructor(options: AuthChallengeOptions) {
    this.name = options.name;
    this.session = options.session;
    this.username = options.username;
    this.parameters = options.parameters ?? {};
    throw new Error("TODO(A7)");
  }

  toJSON(): AuthChallengeJSON {
    throw new Error("TODO(A7)");
  }

  static fromJSON(data: AuthChallengeJSON): AuthChallenge {
    throw new Error("TODO(A7)");
  }
}

/** Type guard distinguishing an `AuthChallenge` from a resolved `TokenSet`. */
export function isAuthChallenge(value: unknown): value is AuthChallenge {
  throw new Error("TODO(A7)");
}
