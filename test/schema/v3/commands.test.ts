import { describe, expect, it } from "vitest";
import { EvnexCommandResponse } from "../../../src/schema/v3/commands.js";

describe("EvnexCommandResponse", () => {
  it("parses status with a message", () => {
    expect(EvnexCommandResponse.parse({ status: "Accepted", message: "ok" })).toEqual({
      status: "Accepted",
      message: "ok",
    });
  });

  it("tolerates an absent message (nullish)", () => {
    expect(EvnexCommandResponse.parse({ status: "Accepted" })).toEqual({
      status: "Accepted",
    });
  });
});
