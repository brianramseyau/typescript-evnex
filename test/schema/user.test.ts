/**
 * User schema tests — ports `tests/test_schema.py::test_user_without_name_validates`
 * (PLAN.md §5 A3, §6.2).
 */

import { describe, expect, it } from "vitest";
import { EvnexGetUserResponse } from "../../src/schema/user.js";
import { USER_PAYLOAD_NO_NAME } from "../support/fixtures.js";

describe("test_user_without_name_validates", () => {
  it("a user payload with no `name` validates", () => {
    // The API omits the name field entirely for accounts that never set one.
    const user = EvnexGetUserResponse.parse(USER_PAYLOAD_NO_NAME).data;
    expect(user.name).toBeUndefined();
    expect(user.email).toBe("user@example.com");
  });
});
