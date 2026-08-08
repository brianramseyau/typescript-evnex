/**
 * Pending authentication challenge — ported from `evnex/auth.py`'s
 * `AuthChallenge` (a frozen dataclass).
 *
 * JSON-serialisable so a challenge can be answered by a different process or
 * a later request (within the short session lifetime, around 3 minutes).
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
    this.parameters = Object.freeze({ ...(options.parameters ?? {}) });
    Object.freeze(this);
  }

  toJSON(): AuthChallengeJSON {
    return {
      name: this.name,
      session: this.session,
      username: this.username,
      parameters: { ...this.parameters },
    };
  }

  static fromJSON(data: AuthChallengeJSON): AuthChallenge {
    return new AuthChallenge({
      name: data.name,
      session: data.session,
      username: data.username,
      parameters: { ...(data.parameters ?? {}) },
    });
  }
}

/** Type guard distinguishing an `AuthChallenge` from a resolved `TokenSet`. */
export function isAuthChallenge(value: unknown): value is AuthChallenge {
  return value instanceof AuthChallenge;
}
