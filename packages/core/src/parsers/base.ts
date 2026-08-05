import { createHash } from "node:crypto";
import type { EventKind, NativeEnvelope, NormalizedEvent, ParseResult, SourceName } from "../contracts.js";

export const PARSER_VERSION = "1.0.0";

export interface LocalParser {
  readonly name: SourceName;
  readonly supportedFileTypes: readonly string[];
  parse(envelope: NativeEnvelope): ParseResult;
}

export function stableId(...parts: Array<string | number | undefined>): string {
  return createHash("sha256").update(parts.map((part) => String(part ?? "")).join("\u001f")).digest("hex").slice(0, 24);
}

export function traceIdFor(envelope: NativeEnvelope): string {
  const session = envelope.session_id ?? envelope.project_key ?? envelope.source_file;
  return `tr_${stableId(envelope.device_id, envelope.source, session)}`;
}

export function text(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts = value.map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const item = part as Record<string, unknown>;
      return text(item.text ?? item.content ?? item.output ?? item.message);
    }).filter(Boolean);
    return parts.length ? parts.join("\n") : undefined;
  }
  if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    return text(item.text ?? item.content ?? item.message ?? item.output ?? item.value);
  }
  return undefined;
}

export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}

export function numberValue(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function event(
  envelope: NativeEnvelope,
  index: number,
  kind: EventKind,
  fields: Partial<NormalizedEvent> = {},
): NormalizedEvent {
  const rawTimestamp = fields.timestamp ?? text(envelope.raw.timestamp ?? envelope.raw.ts ?? envelope.raw.created_at);
  return {
    id: `evt_${stableId(envelope.event_id, index, kind, fields.toolCallId)}`,
    traceId: traceIdFor(envelope),
    source: envelope.source,
    sourceEventId: envelope.event_id,
    sourceFile: envelope.source_file,
    fileType: envelope.file_type,
    parserVersion: PARSER_VERSION,
    timestamp: rawTimestamp && !Number.isNaN(Date.parse(rawTimestamp)) ? rawTimestamp : envelope.timestamp,
    kind,
    repository: envelope.git?.repository,
    branch: envelope.git?.branch,
    metadata: {},
    ...fields,
  };
}

export function success(records: NormalizedEvent[]): ParseResult {
  return { success: true, records };
}

export function failure(error: unknown): ParseResult {
  return { success: false, records: [], error: error instanceof Error ? error.message : String(error) };
}

export function parseJsonString(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}

export function metadataFallback(envelope: NativeEnvelope, content?: string): ParseResult {
  return success([event(envelope, 0, "metadata", { content, metadata: envelope.raw })]);
}
