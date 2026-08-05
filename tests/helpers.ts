import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { NativeEnvelope, SourceName } from "../packages/core/src/index.js";

export function temporary(prefix = "agenttraces-test-") {
  const path = mkdtempSync(join(tmpdir(), prefix));
  return { path, cleanup: () => rmSync(path, { recursive: true, force: true }) };
}

export function write(path: string, content: string | Buffer) {
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content);
}

export function envelope(source: SourceName, fileType: string, raw: Record<string, unknown>, overrides: Partial<NativeEnvelope> = {}): NativeEnvelope {
  return {
    schema_version: 1, event_id: `native_${source}_${fileType}_${Math.random().toString(36).slice(2)}`,
    timestamp: "2026-08-04T12:00:00.000Z", type: "local_session", device_id: "dev_test",
    source, source_file: `~/.fixtures/${source}/${fileType}`, is_backtracked: false,
    file_type: fileType, session_id: `session_${source}`, raw, ...overrides,
  };
}

export function rawFor(source: SourceName, fileType: string): Record<string, unknown> {
  if (source === "claude_code") return fileType === "session_transcript" || fileType === "subagent_transcript"
    ? { type: "user", message: { role: "user", content: [{ type: "text", text: "fix the cache" }] } }
    : fileType === "prompt_history" ? { type: "user", prompt: "fix the cache" } : { content: "fixture" };
  if (source === "cursor") {
    if (fileType === "sqlite_code_tracking") return { filePath: "src/cache.ts", createdAt: 1 };
    if (fileType === "sqlite_daily_stats") return { key: "aiCodeTracking.dailyStats.2026-08-04", value: JSON.stringify({ tabSuggestedLines: 4 }) };
    return { value: JSON.stringify({ messages: [{ role: "user", text: "fix the cache" }, { role: "assistant", text: "done" }] }) };
  }
  if (source === "codex") return fileType === "config" ? { text: "model = 'gpt-5'" } : { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "fix the cache" }] } };
  if (source === "openclaw") return fileType === "memory" ? { text: "Remember the cache" } : { type: "message", message: { role: "user", content: "fix the cache" } };
  if (source === "conductor") return fileType.endsWith("sessions") ? { id: "s1", title: "Cache work", model: "gpt-5" } : { session_id: "s1", role: "assistant", content: JSON.stringify({ text: "done" }) };
  if (source === "antigravity") return fileType === "conversation" ? { base64: "ZW5jcnlwdGVk" } : fileType === "brain_metadata" ? { title: "Cache plan" } : { text: "Cache evidence" };
  if (fileType === "copilot_compact_transcript") return { type: "assistant.message", content: "done", toolRequests: [{ toolName: "edit", id: "t1" }] };
  if (["copilot_session_events", "copilot_session_snapshot", "copilot_workspace_session_events"].includes(fileType)) return { requests: [{ message: "fix the cache", response: "done" }] };
  return { key: "fixture", value: "metadata" };
}
