import { describe, expect, it } from "vitest";
import { runCli } from "./cli.js";
import type { CliEntryPoint } from "./cli.js";

describe("runCli", () => {
  it("captures stdout and stderr separately, and defaults exitCode to 0", async () => {
    const entry: CliEntryPoint = async () => {
      process.stdout.write("out line 1\n");
      process.stderr.write("err line 1\n");
      process.stdout.write("out line 2\n");
    };

    const result = await runCli(entry, ["status"]);

    expect(result.stdout).toBe("out line 1\nout line 2\n");
    expect(result.stderr).toBe("err line 1\n");
    expect(result.exitCode).toBe(0);
  });

  it("reports process.exitCode when entry sets it and returns normally", async () => {
    const entry: CliEntryPoint = async () => {
      process.stderr.write("boom\n");
      process.exitCode = 1;
    };

    const result = await runCli(entry);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("boom\n");
  });

  it("reports the code passed to process.exit() without killing the test worker", async () => {
    const entry: CliEntryPoint = async () => {
      process.stdout.write("usage: evnex ...\n");
      process.exit(2);
    };

    const result = await runCli(entry);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("usage: evnex ...\n");
  });

  it("process.exit() with no argument reports exit code 0", async () => {
    const entry: CliEntryPoint = async () => {
      process.exit();
    };

    const result = await runCli(entry);

    expect(result.exitCode).toBe(0);
  });

  it("passes argv through to entry", async () => {
    let received: readonly string[] = [];
    const entry: CliEntryPoint = async (argv) => {
      received = argv;
    };

    await runCli(entry, ["auth", "login", "--json"]);

    expect(received).toEqual(["auth", "login", "--json"]);
  });

  it("restores process.stdout.write, process.stderr.write, process.exit, and process.exitCode afterwards", async () => {
    const originalWrite = process.stdout.write;
    const originalExit = process.exit;
    process.exitCode = 7;

    await runCli(async () => {
      process.stdout.write("captured\n");
    });

    expect(process.stdout.write).toBe(originalWrite);
    expect(process.exit).toBe(originalExit);
    expect(process.exitCode).toBe(7);
    process.exitCode = undefined;
  });

  it("propagates an error entry throws that is not a process.exit call, and still restores the streams", async () => {
    const originalWrite = process.stdout.write;

    await expect(
      runCli(async () => {
        process.stdout.write("partial\n");
        throw new Error("unexpected failure");
      }),
    ).rejects.toThrow("unexpected failure");

    expect(process.stdout.write).toBe(originalWrite);
  });

  it("two runs do not leak captured output into each other", async () => {
    const first = await runCli(async () => {
      process.stdout.write("first\n");
    });
    const second = await runCli(async () => {
      process.stdout.write("second\n");
    });

    expect(first.stdout).toBe("first\n");
    expect(second.stdout).toBe("second\n");
  });
});
