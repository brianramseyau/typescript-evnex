/**
 * Schema diffing — report items 1-3 (PLAN.md's D5 schema sweep subsection):
 * fields the wire sent that our schema doesn't declare, fields our schema
 * requires that the wire omitted, and type/shape mismatches.
 *
 * Two independent techniques, because zod's own `safeParse` only tells half
 * the story:
 *
 *  - **Missing / mismatched fields** come straight from `z.ZodError.issues`
 *    (report items 2 and 3). An `invalid_type` issue whose actual value at
 *    that path is `undefined` is a missing field (item 2); everything else
 *    zod flags is a type/shape mismatch (item 3, "a number arriving as a
 *    string, a date that does not coerce, an envelope wrapped where we
 *    expected it bare").
 *  - **Extra fields** (item 1) never produce a zod issue at all — this
 *    codebase deliberately never uses `.strict()` (PLAN.md §2.2), so an
 *    unmodelled key silently parses away. Detecting it requires walking the
 *    schema's own declared shape next to the raw value by hand, unwrapping
 *    `optional`/`nullable`/`default`/`readonly`/the pre-transform side of a
 *    `.transform()` pipe at every level.
 */

import { z } from "zod";
import type { SchemaDiff, TypeMismatch } from "./types.js";
import { emptySchemaDiff } from "./types.js";

// -- Missing / mismatched fields, from ZodError issues -----------------------

function pathToDotted(path: readonly PropertyKey[]): string {
  if (path.length === 0) return "(root)";
  let out = "";
  for (const segment of path) {
    if (typeof segment === "number") {
      out += `[${segment}]`;
    } else {
      out += out.length === 0 ? String(segment) : `.${String(segment)}`;
    }
  }
  return out;
}

function getAtPath(value: unknown, path: readonly PropertyKey[]): unknown {
  let cursor = value;
  for (const segment of path) {
    if (cursor === null || cursor === undefined || typeof cursor !== "object") {
      return undefined;
    }
    cursor = (cursor as Record<PropertyKey, unknown>)[segment as never];
  }
  return cursor;
}

/**
 * A zod `invalid_type` issue where the actual value is `undefined` means the
 * key is absent from the wire body entirely — report item 2. Every other
 * issue (wrong type with a value present, an unrecognised union branch, a
 * bad literal, ...) is item 3.
 */
function classifyIssuesFrom(
  error: z.ZodError,
  rawJson: unknown,
): { missingRequiredFields: string[]; typeMismatches: TypeMismatch[] } {
  const missingRequiredFields: string[] = [];
  const typeMismatches: TypeMismatch[] = [];
  const seenMissing = new Set<string>();
  const seenMismatch = new Set<string>();

  for (const issue of error.issues) {
    const dotted = pathToDotted(issue.path);
    const actual = getAtPath(rawJson, issue.path);
    if (issue.code === "invalid_type" && actual === undefined) {
      if (!seenMissing.has(dotted)) {
        seenMissing.add(dotted);
        missingRequiredFields.push(dotted);
      }
      continue;
    }
    const key = `${dotted}:${issue.code}:${issue.message}`;
    if (!seenMismatch.has(key)) {
      seenMismatch.add(key);
      typeMismatches.push({ path: dotted, code: issue.code, message: issue.message });
    }
  }

  return { missingRequiredFields, typeMismatches };
}

// -- Extra fields, from a hand-walked schema/value comparison ----------------

interface ObjectShape {
  kind: "object";
  shape: Record<string, z.ZodTypeAny>;
}
interface ArrayShape {
  kind: "array";
  element: z.ZodTypeAny;
}
interface RecordShape {
  kind: "record";
  valueType: z.ZodTypeAny;
}
interface UnionShape {
  kind: "union";
  options: readonly z.ZodTypeAny[];
}
interface OpaqueShape {
  kind: "opaque";
}
type EffectiveShape = ObjectShape | ArrayShape | RecordShape | UnionShape | OpaqueShape;

/**
 * Unwrap `optional`/`nullable`/`default`/`readonly`/`catch` and the
 * pre-transform side of a `.transform()` pipe, repeatedly, until a shape
 * that extra-field detection can actually walk is reached (or bottoms out at
 * something opaque — a leaf type, `z.unknown()`, `z.record()`'s value type
 * is handled separately, etc).
 */
function effectiveShape(schema: z.ZodTypeAny): EffectiveShape {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- zod v4's internal `_def` is not fully typed for generic introspection; this is the one place this module reaches past the public API, and every access below is guarded by a `type` check first.
  let current: any = schema;
  // Bounded, not `while (true)`: a defensive cap against an unexpected zod
  // internal shape change producing a wrapper cycle — every schema in this
  // codebase unwraps in well under 10 steps.
  for (let i = 0; i < 20; i += 1) {
    const type = current?._def?.type as string | undefined;
    switch (type) {
      case "optional":
      case "nullable":
      case "default":
      case "readonly":
      case "catch":
      case "prefault":
        current = current._def.innerType;
        continue;
      case "pipe":
        // A `.transform()` result: `_def.in` is the schema the *wire value*
        // must match before the transform runs — the shape extra-field
        // detection actually wants. `_def.out` (the transform itself) has
        // no declared shape at all.
        current = current._def.in;
        continue;
      case "object":
        return { kind: "object", shape: current.shape as Record<string, z.ZodTypeAny> };
      case "array":
        return { kind: "array", element: current._def.element as z.ZodTypeAny };
      case "record":
        return { kind: "record", valueType: current._def.valueType as z.ZodTypeAny };
      case "union":
        return {
          kind: "union",
          options: current._def.options as readonly z.ZodTypeAny[],
        };
      default:
        return { kind: "opaque" };
    }
  }
  return { kind: "opaque" };
}

function joinPath(prefix: string, key: string): string {
  return prefix.length === 0 ? key : `${prefix}.${key}`;
}

/** Walk `schema` against `value`, appending every wire key it does not declare to `out`. */
function collectExtraFields(
  schema: z.ZodTypeAny,
  value: unknown,
  prefix: string,
  out: string[],
): void {
  if (value === null || value === undefined) return;

  const shape = effectiveShape(schema);

  if (shape.kind === "object") {
    if (typeof value !== "object" || Array.isArray(value)) return;
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const fieldSchema = shape.shape[key];
      const path = joinPath(prefix, key);
      if (fieldSchema === undefined) {
        out.push(path);
        continue;
      }
      collectExtraFields(fieldSchema, record[key], path, out);
    }
    return;
  }

  if (shape.kind === "array") {
    if (!Array.isArray(value)) return;
    value.forEach((item, index) => {
      collectExtraFields(shape.element, item, `${prefix}[${index}]`, out);
    });
    return;
  }

  if (shape.kind === "record") {
    // Every key is declared by definition (an open map) — no extra-field
    // finding at this node, but still recurse into each value in case its
    // type is itself an object with its own declared shape.
    if (typeof value !== "object" || Array.isArray(value)) return;
    const record = value as Record<string, unknown>;
    for (const [key, child] of Object.entries(record)) {
      collectExtraFields(shape.valueType, child, joinPath(prefix, key), out);
    }
    return;
  }

  if (shape.kind === "union") {
    // Use whichever branch actually accepts this value — the branch
    // narrowing zod itself would apply — so extra-field detection reasons
    // about the shape the wire value actually matched, not just the first
    // declared option.
    for (const option of shape.options) {
      if (option.safeParse(value).success) {
        collectExtraFields(option, value, prefix, out);
        return;
      }
    }
    return;
  }

  // "opaque": a leaf (string/number/boolean/date/enum/literal/uuid) or an
  // open type (`z.unknown()`/`z.any()`) — nothing further to walk.
}

/**
 * Compute the three structural findings for one endpoint: what our schema
 * declares that the wire didn't send that we don't recognise, what our
 * schema requires that the wire omitted, and every other type/shape
 * mismatch. Never throws — a schema this permissive-by-design (PLAN.md
 * §2.2's no-`.strict()` rule) can still legitimately fail `safeParse`, and
 * that failure is itself the finding, not a bug in this function.
 */
export function computeSchemaDiff(schema: z.ZodTypeAny, rawJson: unknown): SchemaDiff {
  const diff = emptySchemaDiff();

  const result = schema.safeParse(rawJson);
  if (!result.success) {
    const { missingRequiredFields, typeMismatches } = classifyIssuesFrom(
      result.error,
      rawJson,
    );
    diff.missingRequiredFields.push(...missingRequiredFields);
    diff.typeMismatches.push(...typeMismatches);
  }

  const extra: string[] = [];
  collectExtraFields(schema, rawJson, "", extra);
  diff.extraFields.push(...extra);

  return diff;
}
