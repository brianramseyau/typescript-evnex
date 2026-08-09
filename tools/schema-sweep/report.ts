/**
 * Renders `docs/schema-sweep.md` from a completed (or partial/aborted) walk.
 *
 * Always produces a complete document — every endpoint gets its own section
 * covering all four report items from PLAN.md's D5 sweep spec, even when an
 * item found nothing, so "no divergences" reads as a clearly stated result
 * rather than a silently empty document. `redactedBody` is the only place
 * response content appears at all, and it is already redacted by the time it
 * reaches this module — `report.ts` never sees, and therefore cannot leak,
 * an unredacted body.
 */

import type { EndpointCaptureRecord } from "./types.js";

export interface ReportMeta {
  mode: "live" | "dry-run";
  generatedAt: string;
  orgId?: string | undefined;
  chargePointId?: string | undefined;
  aborted: boolean;
  abortReason?: string | undefined;
}

const MAX_BODY_CHARS = 4000;

function renderList(items: readonly string[], emptyText: string): string {
  if (items.length === 0) return emptyText;
  return items.map((item) => `- \`${item}\``).join("\n");
}

function renderMismatches(
  mismatches: EndpointCaptureRecord["diff"]["typeMismatches"],
): string {
  if (mismatches.length === 0) return "None observed.";
  return mismatches.map((m) => `- \`${m.path}\` (${m.code}): ${m.message}`).join("\n");
}

function renderBody(body: unknown): string {
  if (body === undefined) return "_(empty response body)_";
  const text = typeof body === "string" ? body : JSON.stringify(body, null, 2);
  const truncated = text.length > MAX_BODY_CHARS;
  const shown = truncated ? `${text.slice(0, MAX_BODY_CHARS)}\n…(truncated)` : text;
  const lang = typeof body === "string" ? "text" : "json";
  return `\`\`\`${lang}\n${shown}\n\`\`\``;
}

function outcomeLabel(record: EndpointCaptureRecord): string {
  switch (record.outcome) {
    case "ok":
      return "✅ parsed cleanly";
    case "zod-error":
      return "❌ ZodError — missing/mismatched field(s) below";
    case "invalid-json":
      return "⚠️ response body did not parse as JSON";
    case "http-error":
      return `⚠️ HTTP error${record.httpStatus === undefined ? "" : ` (${record.httpStatus})`}`;
    case "timeout":
      return "⏱️ timed out (likely offline charge point)";
    case "exception":
      return "💥 unexpected exception";
    case "skipped-cached":
      return "⏭️ skipped (already captured)";
    case "skipped-dependency-missing":
      return "⏭️ skipped (dependency unresolved)";
    /* v8 ignore next 2 -- CaptureOutcome is a closed union; every member is handled above */
    default:
      return record.outcome;
  }
}

function endpointHasFindings(record: EndpointCaptureRecord): boolean {
  return (
    record.diff.extraFields.length > 0 ||
    record.diff.missingRequiredFields.length > 0 ||
    record.diff.typeMismatches.length > 0 ||
    record.outcome === "http-error" ||
    record.outcome === "invalid-json" ||
    record.outcome === "timeout" ||
    record.outcome === "exception"
  );
}

function renderSummaryTable(records: readonly EndpointCaptureRecord[]): string {
  const header =
    "| Endpoint | Method | Path | Outcome | Extra | Missing | Mismatches |\n" +
    "|---|---|---|---|---|---|---|";
  const rows = records.map((r) => {
    const dep = r.deprecated ? " *(deprecated)*" : "";
    return (
      `| \`${r.endpoint}\`${dep} | ${r.method} | \`${r.pathTemplate}\` | ${outcomeLabel(r)} | ` +
      `${r.diff.extraFields.length} | ${r.diff.missingRequiredFields.length} | ${r.diff.typeMismatches.length} |`
    );
  });
  return [header, ...rows].join("\n");
}

function renderEndpointSection(record: EndpointCaptureRecord): string {
  const lines: string[] = [];
  lines.push(
    `### \`${record.endpoint}\` — ${record.title}${record.deprecated ? " (deprecated)" : ""}`,
  );
  lines.push("");
  lines.push(`- **Method / path template:** \`${record.method} ${record.pathTemplate}\``);
  lines.push(`- **Outcome:** ${outcomeLabel(record)}`);
  if (record.httpStatus !== undefined)
    lines.push(`- **HTTP status:** ${record.httpStatus}`);
  if (record.note !== undefined) lines.push(`- **Note:** ${record.note}`);
  if (record.synthetic) {
    lines.push(
      record.fixtureIsUpstream
        ? "- **Fixture provenance:** real payload inherited from `test/support/fixtures.ts` (upstream/python-evnex test suite) — this run's pipeline exercise, not new live evidence."
        : "- **Fixture provenance:** synthetic — authored for this sweep's dry-run pipeline because no captured fixture exists in either project. Proves the tool works end-to-end; proves nothing about the real API's actual schema.",
    );
  }
  lines.push("");

  lines.push("**1. Fields the wire returned that our schema does not declare:**");
  lines.push(renderList(record.diff.extraFields, "None observed."));
  lines.push("");

  lines.push("**2. Fields our schema requires that the wire omitted:**");
  if (record.diff.missingRequiredFields.length === 0) {
    lines.push(
      "None observed this run. Per PLAN.md: this does not prove any field is " +
        "mandatory — only that every field happened to be present in this one " +
        "sample. Absence of evidence for optionality is not evidence of requiredness.",
    );
  } else {
    lines.push(renderList(record.diff.missingRequiredFields, "None observed."));
    lines.push(
      "",
      "Each of the above is a candidate §10.1-class defect: our schema currently " +
        "requires it with no `.nullish()`/default, and this response omitted it. " +
        "File a defect against the owning schema module; prefer loosening to " +
        "`.nullish()` over tightening the wire.",
    );
  }
  lines.push("");

  lines.push("**3. Type and shape mismatches:**");
  lines.push(renderMismatches(record.diff.typeMismatches));
  lines.push("");

  lines.push("**4. Divergence from the Python model:**");
  if (record.pythonNotes.length === 0) {
    lines.push("No notes recorded for this endpoint.");
  } else {
    lines.push(record.pythonNotes.map((note) => `- ${note}`).join("\n"));
  }
  lines.push("");

  lines.push("<details><summary>Redacted response body</summary>\n");
  lines.push(renderBody(record.redactedBody));
  lines.push("\n</details>");

  return lines.join("\n");
}

/** Total findings across every endpoint — extra + missing + mismatches, plus any hard failures. */
function totalFindingCount(records: readonly EndpointCaptureRecord[]): number {
  return records.reduce((sum, r) => {
    const hardFailure =
      r.outcome === "http-error" ||
      r.outcome === "invalid-json" ||
      r.outcome === "timeout" ||
      r.outcome === "exception"
        ? 1
        : 0;
    return (
      sum +
      r.diff.extraFields.length +
      r.diff.missingRequiredFields.length +
      r.diff.typeMismatches.length +
      hardFailure
    );
  }, 0);
}

export function generateReport(
  records: readonly EndpointCaptureRecord[],
  meta: ReportMeta,
): string {
  const lines: string[] = [];

  if (meta.mode === "dry-run") {
    lines.push(
      "> ## ⚠️ DRY RUN — THIS IS NOT LIVE API EVIDENCE ⚠️",
      ">",
      "> Every capture below came from **recorded fixtures** (see each section's " +
        '"Fixture provenance" line), not a real EVNEX account. This document ' +
        "proves the sweep tool's pipeline runs end-to-end; it proves **nothing** " +
        "about whether the real API's schema matches what this package expects. " +
        "Do not cite this document as live-API findings. Run " +
        "`npx tsx tools/schema-sweep/cli.ts` against a real account (see " +
        "`docs/downstream-validation.md`) to produce the real report.",
      "",
    );
  }

  lines.push("# Schema sweep report", "");
  lines.push(`- **Mode:** ${meta.mode}`);
  lines.push(`- **Generated:** ${meta.generatedAt}`);
  if (meta.orgId !== undefined) lines.push(`- **Org id:** \`${meta.orgId}\``);
  if (meta.chargePointId !== undefined) {
    lines.push(`- **Charge point id:** \`${meta.chargePointId}\``);
  }
  lines.push(`- **Endpoints captured:** ${records.length}`);
  lines.push("");

  if (meta.aborted) {
    lines.push(
      "> ## Sweep stopped early",
      ">",
      `> ${meta.abortReason ?? "Reason not recorded."}`,
      "> The endpoints below are everything captured before the stop. Re-running " +
        "the sweep will skip these (already on disk) and continue with the rest.",
      "",
    );
  }

  const total = totalFindingCount(records);
  if (total === 0 && !meta.aborted) {
    lines.push(
      `**No divergences were found in this sweep across all ${records.length} endpoints.** ` +
        "Every response that parsed did so cleanly against its declared schema, with no " +
        "additional fields, no missing required fields, and no type/shape mismatches. " +
        "See each endpoint's section below for the full detail (including the standing " +
        "Python-model comparison notes, which apply regardless of this run's findings) " +
        "and remember: a clean sample proves fields *can* be optional, never that they " +
        "are *required* — PLAN.md's D5 spec is explicit that this sweep can only ever " +
        "prove optionality.",
      "",
    );
  }

  lines.push("## Summary", "");
  lines.push(renderSummaryTable(records));
  lines.push("");

  const withFindings = records.filter(endpointHasFindings);
  const clean = records.filter((r) => !endpointHasFindings(r));

  lines.push("## Endpoint detail", "");
  if (withFindings.length > 0) {
    lines.push(...withFindings.map((r) => renderEndpointSection(r)), "");
  }
  if (clean.length > 0) {
    lines.push(
      withFindings.length > 0 ? "### Endpoints with no findings" : "",
      "",
      ...clean.map((r) => renderEndpointSection(r)),
      "",
    );
  }

  lines.push(
    "---",
    "",
    "**Before committing this document (or any redacted capture files alongside it):** " +
      "review every redacted body above by eye. Automated redaction (`tools/schema-sweep/redact.ts`) " +
      "is a safety net, not a guarantee — see `docs/downstream-validation.md`.",
  );

  return lines.join("\n");
}
