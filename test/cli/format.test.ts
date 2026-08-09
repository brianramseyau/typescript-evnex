import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatDateTime, formatPeriod, kW, kWh, printTable } from "../../src/cli/format.js";

describe("kW", () => {
  it("formats watts as kW with two decimals", () => {
    expect(kW(1234)).toBe("1.23 kW");
  });

  it("does not treat 0 as missing", () => {
    expect(kW(0)).toBe("0.00 kW");
  });

  it("returns '-' for null", () => {
    expect(kW(null)).toBe("-");
  });

  it("returns '-' for undefined", () => {
    expect(kW(undefined)).toBe("-");
  });
});

describe("kWh", () => {
  it("formats watt-hours as kWh with two decimals", () => {
    expect(kWh(5678)).toBe("5.68 kWh");
  });

  it("does not treat 0 as missing", () => {
    expect(kWh(0)).toBe("0.00 kWh");
  });

  it("returns '-' for null", () => {
    expect(kWh(null)).toBe("-");
  });

  it("returns '-' for undefined", () => {
    expect(kWh(undefined)).toBe("-");
  });
});

describe("formatDateTime", () => {
  afterEach(() => {
    // vitest.setup.ts resets TZ after every test too; belt and suspenders
    // since these tests deliberately pin non-default zones.
    process.env["TZ"] = "UTC";
  });

  it("returns '-' for null", () => {
    expect(formatDateTime(null)).toBe("-");
  });

  it("returns '-' for undefined", () => {
    expect(formatDateTime(undefined)).toBe("-");
  });

  it("keeps midnight at hour 00, not 12 (the .format()/12-hour-default bug)", () => {
    process.env["TZ"] = "UTC";
    const value = new Date("2024-01-15T00:30:00Z");
    expect(formatDateTime(value)).toBe("2024-01-15T00:30:00+00:00");
  });

  it("formats a half-hour-offset zone (Australia/Adelaide, +09:30 in winter)", () => {
    process.env["TZ"] = "Australia/Adelaide";
    const value = new Date("2024-06-15T00:30:00Z");
    expect(formatDateTime(value)).toBe("2024-06-15T10:00:00+09:30");
  });

  it("formats a zone with DST (Australia/Adelaide, +10:30 in summer)", () => {
    process.env["TZ"] = "Australia/Adelaide";
    const value = new Date("2024-01-15T00:30:00Z");
    expect(formatDateTime(value)).toBe("2024-01-15T11:00:00+10:30");
  });

  it("uses the local calendar day, not the UTC one, when they differ (the .toISOString() bug)", () => {
    process.env["TZ"] = "Pacific/Kiritimati"; // fixed UTC+14, no DST
    const value = new Date("2024-01-01T20:00:00Z"); // UTC day: Jan 1
    // Local day is Jan 2 — .toISOString().slice(0, 10) would wrongly say "2024-01-01".
    expect(formatDateTime(value)).toBe("2024-01-02T10:00:00+14:00");
    expect(value.toISOString().slice(0, 10)).toBe("2024-01-01");
  });

  it("formats a negative-offset zone", () => {
    process.env["TZ"] = "America/Los_Angeles"; // fixed UTC-8 in January (no DST)
    const value = new Date("2024-01-15T09:15:30Z");
    expect(formatDateTime(value)).toBe("2024-01-15T01:15:30-08:00");
  });
});

describe("formatPeriod", () => {
  it("formats zero seconds as 00:00", () => {
    expect(formatPeriod(0)).toBe("00:00");
  });

  it("formats a mid-morning offset", () => {
    expect(formatPeriod(3661)).toBe("01:01");
  });

  it("truncates fractional seconds", () => {
    expect(formatPeriod(3659.9)).toBe("01:00");
  });

  it("does not wrap at 24 hours, matching Python's int(seconds) // 60", () => {
    expect(formatPeriod(90000)).toBe("25:00");
  });
});

describe("printTable", () => {
  let written: string;

  beforeEach(() => {
    written = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      written += typeof chunk === "string" ? chunk : String(chunk);
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("pads every column to its widest cell and joins with two spaces", () => {
    printTable(
      ["ID", "Name"],
      [
        ["1", "Alice"],
        ["22", "Bo"],
      ],
    );
    expect(written).toBe("ID  Name \n1   Alice\n22  Bo   \n");
  });

  it("handles a header wider than every cell in its column", () => {
    printTable(["Serial"], [["1"]]);
    expect(written).toBe("Serial\n1     \n");
  });

  it("handles zero rows", () => {
    printTable(["A", "B"], []);
    expect(written).toBe("A  B\n");
  });
});

describe("printTable with a row wider than its headers", () => {
  it("sizes the extra columns from the rows alone", () => {
    // A row can carry more cells than there are headers, in which case the
    // surplus columns have no header length to start from.
    const written: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    });

    printTable(["A"], [["a", "wide-cell"]]);

    vi.restoreAllMocks();
    expect(written).toEqual(["A\n", "a  wide-cell\n"]);
  });
});
