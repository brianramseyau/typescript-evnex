import { describe, expect, it } from "vitest";
import { createStubFetch } from "./stubFetch.js";

const BASE = "https://client-api.evnex.io";

describe("createStubFetch", () => {
  it("returns the registered static JSON response with a default 200 status", async () => {
    const stub = createStubFetch([
      { method: "GET", path: "/v2/apps/user", json: { data: { id: "u-1" } } },
    ]);

    const response = await stub.fetch(`${BASE}/v2/apps/user`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    await expect(response.json()).resolves.toEqual({ data: { id: "u-1" } });
  });

  it("returns a bodyless response when no json is given", async () => {
    const stub = createStubFetch([{ method: "GET", path: "/ping", status: 204 }]);

    const response = await stub.fetch(`${BASE}/ping`);

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  it("records method, path, query, headers, and parsed JSON body", async () => {
    const stub = createStubFetch([
      { method: "POST", path: "/charge-points/cp-1/commands/set-override", json: {} },
    ]);

    await stub.fetch(`${BASE}/charge-points/cp-1/commands/set-override?foo=bar`, {
      method: "POST",
      headers: { Authorization: "access-0", "content-type": "application/json" },
      body: JSON.stringify({ connectorId: 1, chargeNow: true }),
    });

    expect(stub.calls).toHaveLength(1);
    const call = stub.calls[0]!;
    expect(call.method).toBe("POST");
    expect(call.path).toBe("/charge-points/cp-1/commands/set-override");
    expect(call.query.get("foo")).toBe("bar");
    expect(call.headers.get("Authorization")).toBe("access-0");
    expect(call.json).toEqual({ connectorId: 1, chargeNow: true });
  });

  it("leaves json undefined for a non-JSON or bodyless request", async () => {
    const stub = createStubFetch([{ method: "GET", path: "/v2/apps/user", json: {} }]);

    await stub.fetch(`${BASE}/v2/apps/user`);

    expect(stub.calls[0]!.json).toBeUndefined();
  });

  it("supports a dynamic handler — e.g. the first call gets 401, the retry gets 200", async () => {
    const stub = createStubFetch([
      {
        method: "GET",
        path: "/v2/apps/user",
        handler: (call) =>
          call.headers.get("Authorization") === "access-0"
            ? { status: 401 }
            : { status: 200, json: { data: { id: "u-1" } } },
      },
    ]);

    const first = await stub.fetch(`${BASE}/v2/apps/user`, {
      headers: { Authorization: "access-0" },
    });
    const second = await stub.fetch(`${BASE}/v2/apps/user`, {
      headers: { Authorization: "access-1" },
    });

    expect(first.status).toBe(401);
    expect(second.status).toBe(200);
  });

  it("a handler may return a raw Response directly", async () => {
    const stub = createStubFetch([
      {
        method: "GET",
        path: "/v2/apps/user",
        handler: () => new Response("not json", { status: 500 }),
      },
    ]);

    const response = await stub.fetch(`${BASE}/v2/apps/user`);

    expect(response.status).toBe(500);
    expect(await response.text()).toBe("not json");
  });

  it("throws a clear error for an unregistered route", async () => {
    const stub = createStubFetch([{ method: "GET", path: "/v2/apps/user", json: {} }]);

    await expect(stub.fetch(`${BASE}/nonexistent`)).rejects.toThrow(
      /no route for GET \/nonexistent/,
    );
  });

  it("callsFor filters recorded calls by method + path", async () => {
    const stub = createStubFetch([
      { method: "GET", path: "/a", json: {} },
      { method: "GET", path: "/b", json: {} },
    ]);

    await stub.fetch(`${BASE}/a`);
    await stub.fetch(`${BASE}/b`);
    await stub.fetch(`${BASE}/a`);

    expect(stub.callsFor("GET", "/a")).toHaveLength(2);
    expect(stub.callsFor("GET", "/b")).toHaveLength(1);
    expect(stub.callsFor("POST", "/a")).toHaveLength(0);
  });

  it("addRoute registers new routes and can override an existing one", async () => {
    const stub = createStubFetch();
    stub.addRoute({ method: "GET", path: "/v2/apps/user", json: { data: { id: "first" } } });
    await expect((await stub.fetch(`${BASE}/v2/apps/user`)).json()).resolves.toEqual({
      data: { id: "first" },
    });

    stub.addRoute({ method: "GET", path: "/v2/apps/user", json: { data: { id: "second" } } });
    await expect((await stub.fetch(`${BASE}/v2/apps/user`)).json()).resolves.toEqual({
      data: { id: "second" },
    });
  });

  it("reset clears recorded calls without touching the route table", async () => {
    const stub = createStubFetch([{ method: "GET", path: "/v2/apps/user", json: {} }]);
    await stub.fetch(`${BASE}/v2/apps/user`);
    expect(stub.calls).toHaveLength(1);

    stub.reset();

    expect(stub.calls).toHaveLength(0);
    await stub.fetch(`${BASE}/v2/apps/user`);
    expect(stub.calls).toHaveLength(1);
  });

  it("method matching is case-insensitive", async () => {
    const stub = createStubFetch([{ method: "get", path: "/v2/apps/user", json: {} }]);

    const response = await stub.fetch(`${BASE}/v2/apps/user`, { method: "GET" });

    expect(response.status).toBe(200);
  });
});
