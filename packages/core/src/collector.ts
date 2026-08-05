import { createHash } from "node:crypto";
import { existsSync, lstatSync, openSync, closeSync, readFileSync, readSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { NativeEnvelope, SourceDefinition, SourceName } from "./contracts.js";
import { SOURCE_DEFINITIONS, resolveSourcePath } from "./sources.js";
import { stableId, text } from "./parsers/base.js";
import { scrubText } from "./redaction.js";
import type { AgentTracesStore } from "./store.js";
import { canonicalRepository, inspectGit } from "./git.js";

export interface ScanOptions {
  sources?: SourceName[];
  fromBeginning?: boolean;
  maxEvents?: number;
  redactPatterns?: RegExp[];
  maxEventBytes?: number;
  maxReadBytes?: number;
  dryRun?: boolean;
  gitCwd?: string;
  gitSnapshot?: NativeEnvelope["git"];
}

export interface SourceScanResult {
  source: SourceName;
  detected: boolean;
  files: number;
  databases: number;
  envelopes: NativeEnvelope[];
  skipped: number;
  errors: string[];
}

function hash(value: string | Buffer) { return createHash("sha256").update(value).digest("hex"); }
function now() { return new Date().toISOString(); }

function globRegex(pattern: string) {
  let result = "^";
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index]!;
    if (char === "*") {
      if (pattern[index + 1] === "*") { result += ".*"; index++; }
      else result += "[^/]*";
    } else if (char === "?") result += "[^/]";
    else result += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`${result}$`, process.platform === "win32" ? "i" : "");
}

function walk(root: string, maxFiles = 100_000): string[] {
  if (!existsSync(root)) return [];
  const output: string[] = [];
  const stack = [root];
  while (stack.length && output.length < maxFiles) {
    const current = stack.pop()!;
    let entries;
    try { entries = readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const path = `${current}/${entry.name}`;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) stack.push(path);
      else if (entry.isFile()) output.push(path);
    }
  }
  return output;
}

function wildcardRoot(pattern: string) {
  const index = pattern.search(/[?*]/);
  if (index < 0) return dirname(pattern);
  const prefix = pattern.slice(0, index);
  return prefix.endsWith("/") ? prefix.slice(0, -1) : dirname(prefix);
}

function matchFiles(pattern: string) {
  const matcher = globRegex(pattern);
  return walk(wildcardRoot(pattern)).filter((path) => matcher.test(path));
}

function safePath(path: string, userHome: string) {
  const real = realpathSync(path);
  const root = realpathSync(userHome);
  if (real !== root && !real.startsWith(`${root}/`)) throw new Error("Refusing to read outside the user home");
  if (lstatSync(path).isSymbolicLink()) throw new Error("Refusing to read symbolic link");
  return real;
}

function normalizeSourceFile(path: string, userHome: string) {
  return path.startsWith(`${userHome}/`) ? `~/${path.slice(userHome.length + 1)}` : basename(path);
}

function sessionId(source: SourceName, path: string, raw: Record<string, unknown>) {
  const payload = raw.payload && typeof raw.payload === "object" ? raw.payload as Record<string, unknown> : {};
  const explicit = text(raw.session_id ?? raw.sessionId ?? raw.conversation_id ?? raw.conversationId ?? raw.id ?? payload.id ?? payload.session_id);
  if (explicit) return explicit;
  const stem = basename(path, extname(path));
  if (source === "copilot" && path.includes("debug-logs/")) return path.split("debug-logs/")[1]?.split("/")[0] ?? stem;
  return stem;
}

function timestamp(raw: Record<string, unknown>, path: string) {
  const candidate = text(raw.timestamp ?? raw.ts ?? raw.created_at ?? raw.createdAt ?? raw.time);
  if (candidate) {
    const numeric = Number(candidate);
    const parsed = Number.isFinite(numeric) ? new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000) : new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return statSync(path).mtime.toISOString();
}

function plainRow(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === "bigint" ? value.toString() : value]));
}

export class LocalCollector {
  constructor(readonly store: AgentTracesStore, readonly userHome: string) {}

  detect() {
    return SOURCE_DEFINITIONS.map((source) => ({
      source: source.name,
      displayName: source.displayName,
      detected: source.detectPaths.some((path) => existsSync(resolveSourcePath(path, this.userHome))),
      paths: source.detectPaths.map((path) => resolveSourcePath(path, this.userHome)),
    }));
  }

  scan(options: ScanOptions = {}) {
    const inspected = options.gitSnapshot ? null : inspectGit(options.gitCwd ?? process.cwd());
    const gitSnapshot = options.gitSnapshot ?? (inspected ? { ...inspected, repository: canonicalRepository(inspected.remote) } : undefined);
    const enriched = { ...options, gitSnapshot };
    const selected = SOURCE_DEFINITIONS.filter((source) => !options.sources || options.sources.includes(source.name));
    return selected.map((source) => this.scanSource(source, enriched));
  }

  scanAndEnqueue(options: ScanOptions = {}) {
    const results = this.scan(options);
    const envelopes = results.flatMap((result) => result.envelopes);
    if (options.dryRun || !envelopes.length) return { results, receipt: null };
    const batchId = `batch_${stableId(envelopes[0]?.event_id, envelopes.at(-1)?.event_id, envelopes.length)}`;
    return { results, receipt: this.store.enqueue(batchId, envelopes) };
  }

  private scanSource(source: SourceDefinition, options: ScanOptions): SourceScanResult {
    const result: SourceScanResult = { source: source.name, detected: false, files: 0, databases: 0, envelopes: [], skipped: 0, errors: [] };
    result.detected = source.detectPaths.some((path) => existsSync(resolveSourcePath(path, this.userHome)));
    const maxEvents = options.maxEvents ?? 10_000;
    for (const glob of source.globs) {
      const pattern = resolveSourcePath(glob.pattern, this.userHome);
      const skips = (glob.skipPatterns ?? []).map(globRegex);
      for (const path of matchFiles(pattern).sort()) {
        if (result.envelopes.length >= maxEvents) break;
        if (skips.some((matcher) => matcher.test(basename(path)))) { result.skipped++; continue; }
        try {
          safePath(path, this.userHome); result.files++;
          const envelopes = glob.readMode === "full"
            ? this.readFull(source.name, path, glob.fileType, glob.contentType ?? "json", options)
            : this.readIncremental(source.name, path, glob.fileType, options);
          result.envelopes.push(...envelopes.slice(0, maxEvents - result.envelopes.length));
        } catch (error) { result.errors.push(`${normalizeSourceFile(path, this.userHome)}: ${error instanceof Error ? error.message : String(error)}`); }
      }
    }
    for (const sqlite of source.sqlite) {
      const pattern = resolveSourcePath(sqlite.path, this.userHome);
      const paths = /[?*]/.test(pattern) ? matchFiles(pattern) : existsSync(pattern) ? [pattern] : [];
      for (const path of paths.sort()) {
        if (result.envelopes.length >= maxEvents) break;
        try {
          safePath(path, this.userHome); result.databases++;
          result.envelopes.push(...this.readSqlite(source.name, path, sqlite.queries, options).slice(0, maxEvents - result.envelopes.length));
        } catch (error) { result.errors.push(`${normalizeSourceFile(path, this.userHome)}: ${error instanceof Error ? error.message : String(error)}`); }
      }
    }
    return result;
  }

  private readIncremental(source: SourceName, path: string, fileType: string, options: ScanOptions) {
    const size = statSync(path).size;
    const key = normalizeSourceFile(path, this.userHome);
    const savedCursor = this.store.cursor(source, key);
    const stored = options.fromBeginning ? 0 : Number(savedCursor ?? size);
    const offset = size < stored ? 0 : stored;
    if (offset === size) {
      if (!options.dryRun && savedCursor === undefined) this.store.setCursor(source, key, String(size));
      return [];
    }
    const readLength = Math.min(size - offset, options.maxReadBytes ?? 16 * 1024 * 1024);
    const fd = openSync(path, "r"); const buffer = Buffer.alloc(readLength);
    try { readSync(fd, buffer, 0, buffer.length, offset); } finally { closeSync(fd); }
    const raw = buffer.toString("utf8");
    const lines = raw.split("\n");
    lines.pop();
    let consumed = 0; const envelopes: NativeEnvelope[] = [];
    for (const [index, line] of lines.entries()) {
      consumed += Buffer.byteLength(line) + 1;
      if (!line.trim()) continue;
      const envelope = this.lineEnvelope(source, path, fileType, line, index + 1, options);
      if (envelope) envelopes.push(envelope);
    }
    if (!options.dryRun) this.store.setCursor(source, key, String(offset + consumed));
    return envelopes;
  }

  private readFull(source: SourceName, path: string, fileType: string, contentType: string, options: ScanOptions) {
    const bytes = readFileSync(path);
    if (bytes.byteLength > (options.maxEventBytes ?? 1_048_576)) throw new Error(`File exceeds max event size (${bytes.byteLength} bytes)`);
    const key = `${normalizeSourceFile(path, this.userHome)}#full`;
    const digest = hash(bytes);
    if (!options.fromBeginning && this.store.cursor(source, key) === digest) return [];
    const rawLine = contentType === "binary" ? JSON.stringify({ base64: bytes.toString("base64") })
      : contentType === "text" ? JSON.stringify({ text: bytes.toString("utf8") }) : bytes.toString("utf8");
    const envelope = this.lineEnvelope(source, path, fileType, rawLine, 1, options);
    if (!options.dryRun) this.store.setCursor(source, key, digest);
    return envelope ? [envelope] : [];
  }

  private readSqlite(source: SourceName, path: string, queries: SourceDefinition["sqlite"][number]["queries"], options: ScanOptions) {
    const database = new DatabaseSync(path, { readOnly: true });
    const envelopes: NativeEnvelope[] = [];
    try {
      for (const query of queries) {
        if (envelopes.length >= (options.maxEvents ?? 10_000)) break;
        const key = `${normalizeSourceFile(path, this.userHome)}#${query.fileType}`;
        const cursor = this.store.cursor(source, key);
        const baseSql = query.sql.trim().replace(/;$/, "");
        if (!options.fromBeginning && cursor === undefined && query.incrementalField) {
          const maximumRow = database.prepare(`SELECT MAX("${query.incrementalField}") AS maximum FROM (${baseSql}) AS source_rows`).get() as Record<string, unknown> | undefined;
          if (!options.dryRun && maximumRow?.maximum !== null && maximumRow?.maximum !== undefined) this.store.setCursor(source, key, String(maximumRow.maximum));
          continue;
        }
        const remaining = Math.max(1, (options.maxEvents ?? 10_000) - envelopes.length);
        const boundedSql = cursor !== undefined && !options.fromBeginning && query.incrementalField
          ? `SELECT * FROM (${baseSql}) AS source_rows WHERE "${query.incrementalField}" > ? LIMIT ?`
          : `SELECT * FROM (${baseSql}) AS source_rows LIMIT ?`;
        const cursorValue = cursor !== undefined && /^-?\d+(?:\.\d+)?$/.test(cursor) ? Number(cursor) : cursor;
        const rows = (cursor !== undefined && !options.fromBeginning && query.incrementalField
          ? database.prepare(boundedSql).all(cursorValue!, remaining)
          : database.prepare(boundedSql).all(remaining)) as Record<string, unknown>[];
        let maximum = cursor;
        for (const rowValue of rows) {
          const row = plainRow(rowValue);
          const incremental = query.incrementalField ? text(row[query.incrementalField]) : undefined;
          if (!options.fromBeginning && cursor !== undefined && incremental !== undefined && incremental <= cursor) continue;
          const serialized = JSON.stringify(row);
          const envelope = this.lineEnvelope(source, path, query.fileType, serialized, envelopes.length + 1, options);
          if (envelope) envelopes.push(envelope);
          if (incremental !== undefined && (maximum === undefined || incremental > maximum)) maximum = incremental;
          if (envelopes.length >= (options.maxEvents ?? 10_000)) break;
        }
        if (!options.dryRun && maximum !== undefined) this.store.setCursor(source, key, maximum);
      }
    } finally { database.close(); }
    return envelopes;
  }

  private lineEnvelope(source: SourceName, path: string, fileType: string, line: string, lineNumber: number, options: ScanOptions): NativeEnvelope | null {
    if (Buffer.byteLength(line) > (options.maxEventBytes ?? 1_048_576)) return null;
    const redacted = scrubText(line, options.redactPatterns ?? []);
    let raw: Record<string, unknown>;
    try { const parsed = JSON.parse(redacted); raw = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : { value: parsed }; }
    catch { raw = { text: redacted }; }
    const normalizedPath = normalizeSourceFile(path, this.userHome);
    const session = sessionId(source, path, raw);
    const eventId = `native_${stableId(source, normalizedPath, lineNumber, hash(redacted))}`;
    return {
      schema_version: 1, event_id: eventId, timestamp: timestamp(raw, path), type: "local_session",
      device_id: this.store.installation().deviceId, source, source_file: normalizedPath,
      is_backtracked: Boolean(options.fromBeginning), file_type: fileType, session_id: session,
      project_key: text(raw.cwd ?? raw.project_path ?? raw.workspace), line_number: lineNumber, raw,
      git: options.gitSnapshot,
    };
  }
}

export const collectorInternals = { globRegex, redact: scrubText, matchFiles };
