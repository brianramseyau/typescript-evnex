import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EvnexConfig } from "../src/config.js";

describe("EvnexConfig", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Save original environment
    savedEnv.EVNEX_BASE_URL = process.env["EVNEX_BASE_URL"];
    savedEnv.EVNEX_COGNITO_USER_POOL_ID =
      process.env["EVNEX_COGNITO_USER_POOL_ID"];
    savedEnv.EVNEX_COGNITO_CLIENT_ID = process.env["EVNEX_COGNITO_CLIENT_ID"];
    savedEnv.EVNEX_ORG_ID = process.env["EVNEX_ORG_ID"];

    // Clear environment
    delete process.env["EVNEX_BASE_URL"];
    delete process.env["EVNEX_COGNITO_USER_POOL_ID"];
    delete process.env["EVNEX_COGNITO_CLIENT_ID"];
    delete process.env["EVNEX_ORG_ID"];
  });

  afterEach(() => {
    // Restore original environment
    Object.entries(savedEnv).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  });

  it("uses defaults when no environment variables are set", () => {
    const config = new EvnexConfig();
    expect(config.EVNEX_BASE_URL).toBe("https://client-api.evnex.io");
    expect(config.EVNEX_COGNITO_USER_POOL_ID).toBe("ap-southeast-2_zWnqo6ASv");
    expect(config.EVNEX_COGNITO_CLIENT_ID).toBe("rol3lsv2vg41783550i18r7vi");
    expect(config.EVNEX_ORG_ID).toBeUndefined();
  });

  it("uses environment variables when set", () => {
    process.env["EVNEX_BASE_URL"] = "https://custom.example.com";
    process.env["EVNEX_COGNITO_USER_POOL_ID"] = "custom-pool-id";
    process.env["EVNEX_COGNITO_CLIENT_ID"] = "custom-client-id";
    process.env["EVNEX_ORG_ID"] = "custom-org-id";

    const config = new EvnexConfig();
    expect(config.EVNEX_BASE_URL).toBe("https://custom.example.com");
    expect(config.EVNEX_COGNITO_USER_POOL_ID).toBe("custom-pool-id");
    expect(config.EVNEX_COGNITO_CLIENT_ID).toBe("custom-client-id");
    expect(config.EVNEX_ORG_ID).toBe("custom-org-id");
  });

  it("treats empty string environment variables as unset", () => {
    process.env["EVNEX_BASE_URL"] = "";
    process.env["EVNEX_COGNITO_USER_POOL_ID"] = "";
    process.env["EVNEX_COGNITO_CLIENT_ID"] = "";
    process.env["EVNEX_ORG_ID"] = "";

    const config = new EvnexConfig();
    expect(config.EVNEX_BASE_URL).toBe("https://client-api.evnex.io");
    expect(config.EVNEX_COGNITO_USER_POOL_ID).toBe("ap-southeast-2_zWnqo6ASv");
    expect(config.EVNEX_COGNITO_CLIENT_ID).toBe("rol3lsv2vg41783550i18r7vi");
    expect(config.EVNEX_ORG_ID).toBeUndefined();
  });

  it("allows explicit overrides to win over environment", () => {
    process.env["EVNEX_BASE_URL"] = "https://env.example.com";
    process.env["EVNEX_COGNITO_USER_POOL_ID"] = "env-pool-id";
    process.env["EVNEX_COGNITO_CLIENT_ID"] = "env-client-id";
    process.env["EVNEX_ORG_ID"] = "env-org-id";

    const config = new EvnexConfig({
      EVNEX_BASE_URL: "https://override.example.com",
      EVNEX_COGNITO_USER_POOL_ID: "override-pool-id",
      EVNEX_COGNITO_CLIENT_ID: "override-client-id",
      EVNEX_ORG_ID: "override-org-id",
    });
    expect(config.EVNEX_BASE_URL).toBe("https://override.example.com");
    expect(config.EVNEX_COGNITO_USER_POOL_ID).toBe("override-pool-id");
    expect(config.EVNEX_COGNITO_CLIENT_ID).toBe("override-client-id");
    expect(config.EVNEX_ORG_ID).toBe("override-org-id");
  });

  it("allows partial overrides", () => {
    process.env["EVNEX_BASE_URL"] = "https://env.example.com";
    process.env["EVNEX_COGNITO_USER_POOL_ID"] = "env-pool-id";

    const config = new EvnexConfig({
      EVNEX_BASE_URL: "https://override.example.com",
    });
    expect(config.EVNEX_BASE_URL).toBe("https://override.example.com");
    expect(config.EVNEX_COGNITO_USER_POOL_ID).toBe("env-pool-id");
    expect(config.EVNEX_COGNITO_CLIENT_ID).toBe("rol3lsv2vg41783550i18r7vi");
    expect(config.EVNEX_ORG_ID).toBeUndefined();
  });

  it("precedence: explicit override > environment > default", () => {
    process.env["EVNEX_BASE_URL"] = "https://env.example.com";
    process.env["EVNEX_COGNITO_USER_POOL_ID"] = "env-pool-id";
    process.env["EVNEX_COGNITO_CLIENT_ID"] = "env-client-id";
    process.env["EVNEX_ORG_ID"] = "env-org-id";

    const config = new EvnexConfig({
      EVNEX_BASE_URL: "https://override.example.com",
      // EVNEX_COGNITO_USER_POOL_ID not overridden, should use env
      // EVNEX_COGNITO_CLIENT_ID not overridden, should use env
      // EVNEX_ORG_ID not overridden, should use env
    });
    expect(config.EVNEX_BASE_URL).toBe("https://override.example.com");
    expect(config.EVNEX_COGNITO_USER_POOL_ID).toBe("env-pool-id");
    expect(config.EVNEX_COGNITO_CLIENT_ID).toBe("env-client-id");
    expect(config.EVNEX_ORG_ID).toBe("env-org-id");
  });

  it("allows override to explicitly set undefined", () => {
    process.env["EVNEX_ORG_ID"] = "env-org-id";

    const config = new EvnexConfig({
      EVNEX_ORG_ID: undefined,
    });
    expect(config.EVNEX_ORG_ID).toBeUndefined();
  });

  // Note: readonly is a TypeScript compile-time check and cannot be enforced
  // at runtime in JavaScript. TypeScript will error if you try to assign to
  // these fields; this test merely documents that fact.
  it("fields have readonly type signature (compile-time enforcement)", () => {
    const config = new EvnexConfig();
    // @ts-expect-error readonly field - TypeScript prevents this
    const _shouldNotCompile = (config.EVNEX_BASE_URL = "modified");
    expect(_shouldNotCompile).toBeDefined();
  });
});
