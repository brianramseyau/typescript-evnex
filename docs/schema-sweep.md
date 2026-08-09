# Schema sweep report — not yet run

This file is a stub. It is filled in by running the live sweep against a
real EVNEX account:

```shell
npm run sweep
# or: npx tsx tools/schema-sweep/cli.ts
```

See `docs/downstream-validation.md` for the full operator's guide — what
credentials to set, what the sweep does, roughly how long it takes, what it
writes, and the explicit warning to review every redacted payload by eye
before committing this file (or any capture files alongside it).

Running `npm run sweep --out <dir>` (live mode) writes this report to this
exact path by default. Do not hand-edit this stub to look like a completed
report — it should stay exactly this, until a real sweep has actually run
and produced it.

**Do not confuse this with a dry run.** `npm run sweep:dry-run` exercises
the same pipeline against recorded fixtures with no live account, and
writes its own report to `schema-sweep-output/dry-run-report.md` by
default — the CLI refuses outright to write a `--dry-run` report to this
path, specifically so this file is never mistaken for real findings.
