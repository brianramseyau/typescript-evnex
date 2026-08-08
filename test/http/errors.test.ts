import { describe, it, expect } from "vitest";
import { EvnexError } from "../../src/errors.js";
import {
  EvnexHttpError,
  EvnexTimeoutError,
} from "../../src/http/errors.js";

describe("EvnexHttpError", () => {
  it("stores status, path, body, and correlationId", () => {
    const body = { error: "something went wrong" };
    const err = new EvnexHttpError("HTTP 404", {
      status: 404,
      path: "/api/test",
      body,
      correlationId: "req-123",
    });

    expect(err.status).toBe(404);
    expect(err.path).toBe("/api/test");
    expect(err.body).toBe(body);
    expect(err.correlationId).toBe("req-123");
  });

  it("extends EvnexError", () => {
    const err = new EvnexHttpError("HTTP error", {
      status: 500,
      path: "/api/test",
    });

    expect(err).toBeInstanceOf(EvnexError);
    expect(err).toBeInstanceOf(EvnexHttpError);
  });

  it("sets the name correctly", () => {
    const err = new EvnexHttpError("HTTP error", {
      status: 500,
      path: "/api/test",
    });

    expect(err.name).toBe("EvnexHttpError");
  });

  it("message is separate from body", () => {
    const message = "Request failed";
    const body = { code: "ERR_001", detail: "sensitive info" };
    const err = new EvnexHttpError(message, {
      status: 400,
      path: "/api/test",
      body,
    });

    expect(err.message).toBe(message);
    expect(err.body).toBe(body);
    // Body should not appear in message
    expect(err.message).not.toContain("sensitive");
  });

  it("body is optional", () => {
    const err = new EvnexHttpError("HTTP error", {
      status: 500,
      path: "/api/test",
    });

    expect(err.body).toBeUndefined();
  });

  it("correlationId is optional", () => {
    const err = new EvnexHttpError("HTTP error", {
      status: 500,
      path: "/api/test",
    });

    expect(err.correlationId).toBeUndefined();
  });

  it("supports cause via ErrorOptions", () => {
    const cause = new TypeError("network error");
    const err = new EvnexHttpError("HTTP error", {
      status: 500,
      path: "/api/test",
      cause,
    });

    expect(err.cause).toBe(cause);
  });

  // Note: readonly is a TypeScript compile-time check and cannot be enforced
  // at runtime. TypeScript will error if you try to assign to these fields.
  it("fields have readonly type signature (compile-time enforcement)", () => {
    const err = new EvnexHttpError("HTTP error", {
      status: 404,
      path: "/api/test",
    });

    // @ts-expect-error readonly field - TypeScript prevents this
    const _statusAssign = (err.status = 200);
    // @ts-expect-error readonly field - TypeScript prevents this
    const _pathAssign = (err.path = "/other");

    expect(_statusAssign).toBeDefined();
    expect(_pathAssign).toBeDefined();
  });

  it("can be thrown and caught", () => {
    const err = new EvnexHttpError("HTTP 404", {
      status: 404,
      path: "/api/test",
      body: { error: "not found" },
      correlationId: "req-456",
    });

    expect(() => {
      throw err;
    }).toThrow(EvnexHttpError);

    try {
      throw err;
    } catch (caught) {
      expect(caught).toBeInstanceOf(EvnexHttpError);
      if (caught instanceof EvnexHttpError) {
        expect(caught.status).toBe(404);
        expect(caught.path).toBe("/api/test");
        expect(caught.body).toEqual({ error: "not found" });
        expect(caught.correlationId).toBe("req-456");
      }
    }
  });

  it("various HTTP status codes work", () => {
    const codes = [400, 401, 403, 404, 500, 502, 503];
    codes.forEach((code) => {
      const err = new EvnexHttpError(`HTTP ${code}`, {
        status: code,
        path: "/api/test",
      });
      expect(err.status).toBe(code);
    });
  });
});

describe("EvnexTimeoutError", () => {
  it("stores path", () => {
    const err = new EvnexTimeoutError("Request timed out", {
      path: "/api/slow-endpoint",
    });

    expect(err.path).toBe("/api/slow-endpoint");
  });

  it("extends EvnexError", () => {
    const err = new EvnexTimeoutError("Request timed out", {
      path: "/api/test",
    });

    expect(err).toBeInstanceOf(EvnexError);
    expect(err).toBeInstanceOf(EvnexTimeoutError);
  });

  it("sets the name correctly", () => {
    const err = new EvnexTimeoutError("Request timed out", {
      path: "/api/test",
    });

    expect(err.name).toBe("EvnexTimeoutError");
  });

  it("preserves the message", () => {
    const message = "Request to /api/endpoint timed out after 30000ms";
    const err = new EvnexTimeoutError(message, {
      path: "/api/endpoint",
    });

    expect(err.message).toBe(message);
  });

  it("supports cause via ErrorOptions", () => {
    const cause = new Error("AbortError: The operation was aborted");
    const err = new EvnexTimeoutError("Request timed out", {
      path: "/api/test",
      cause,
    });

    expect(err.cause).toBe(cause);
  });

  // Note: readonly is a TypeScript compile-time check and cannot be enforced
  // at runtime. TypeScript will error if you try to assign to the field.
  it("path field has readonly type signature (compile-time enforcement)", () => {
    const err = new EvnexTimeoutError("Request timed out", {
      path: "/api/test",
    });

    // @ts-expect-error readonly field - TypeScript prevents this
    const _pathAssign = (err.path = "/other");
    expect(_pathAssign).toBeDefined();
  });

  it("can be thrown and caught", () => {
    const err = new EvnexTimeoutError("Timeout", {
      path: "/api/charge-point/status",
    });

    expect(() => {
      throw err;
    }).toThrow(EvnexTimeoutError);

    try {
      throw err;
    } catch (caught) {
      expect(caught).toBeInstanceOf(EvnexTimeoutError);
      if (caught instanceof EvnexTimeoutError) {
        expect(caught.path).toBe("/api/charge-point/status");
      }
    }
  });

  it("various paths work", () => {
    const paths = [
      "/v2/apps/user",
      "/charge-points/cp-123/commands/get-status",
      "/organisations/org-456/summary/insights",
    ];

    paths.forEach((path) => {
      const err = new EvnexTimeoutError("Timeout", { path });
      expect(err.path).toBe(path);
    });
  });
});

describe("HTTP errors interaction", () => {
  it("HttpError and TimeoutError are distinct", () => {
    const httpErr = new EvnexHttpError("HTTP error", {
      status: 500,
      path: "/api/test",
    });
    const timeoutErr = new EvnexTimeoutError("Timeout", {
      path: "/api/test",
    });

    expect(httpErr).toBeInstanceOf(EvnexHttpError);
    expect(timeoutErr).toBeInstanceOf(EvnexTimeoutError);
    expect(httpErr).not.toBeInstanceOf(EvnexTimeoutError);
    expect(timeoutErr).not.toBeInstanceOf(EvnexHttpError);
  });

  it("both are instances of EvnexError", () => {
    const errors: EvnexError[] = [
      new EvnexHttpError("HTTP error", {
        status: 500,
        path: "/api/test",
      }),
      new EvnexTimeoutError("Timeout", {
        path: "/api/test",
      }),
    ];

    errors.forEach((err) => {
      expect(err).toBeInstanceOf(EvnexError);
    });
  });
});
