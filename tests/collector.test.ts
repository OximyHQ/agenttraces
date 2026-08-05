import assert from "node:assert/strict";
import { appendFileSync, mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { AgentTracesStore, LocalCollector, collectorInternals, resolveSourcePath } from "../packages/core/src/index.js";
import { temporary, write } from "./helpers.js";

test("incremental JSONL handles first-run boundary, partial records, truncation, dedupe, and redaction", () => {
  const temp = temporary();
  try {
    const userHome = `${temp.path}/user`; const state = `${temp.path}/state`; mkdirSync(userHome, { recursive: true });
    const path = `${userHome}/.claude/projects/project/session.jsonl`;
    write(path, `${JSON.stringify({ type: "user", message: { role: "user", content: "existing" }, session_id: "s1" })}\n`);
    const store = new AgentTracesStore(`${state}/db.sqlite`, state); const collector = new LocalCollector(store, userHome);
    assert.equal(collector.scan({ sources: ["claude_code"] })[0]?.envelopes.length, 0, "existing history must not upload by default");
    appendFileSync(path, `${JSON.stringify({ type: "user", message: { role: "user", content: "token sk-1234567890abcdefghijkl" }, session_id: "s1" })}\n{"type":"assistant"`);
    const second = collector.scanAndEnqueue({ sources: ["claude_code"] });
    assert.equal(second.results[0]?.envelopes.length, 1); assert.doesNotMatch(JSON.stringify(second.results), /sk-1234567890/); assert.match(JSON.stringify(second.results), /REDACTED/);
    appendFileSync(path, `,"session_id":"s1","message":{"role":"assistant","content":"done"}}\n`);
    const third = collector.scanAndEnqueue({ sources: ["claude_code"] }); assert.equal(third.results[0]?.envelopes.length, 1);
    store.processPending(); assert.equal(store.listTraces()[0]?.eventCount, 2);
    write(path, `${JSON.stringify({ type: "user", message: { role: "user", content: "replacement" }, session_id: "s2" })}\n`);
    const truncated = collector.scanAndEnqueue({ sources: ["claude_code"] }); assert.equal(truncated.results[0]?.envelopes.length, 1);
    store.processPending(); assert.equal(store.listTraces().length, 2);
    const replay = collector.scanAndEnqueue({ sources: ["claude_code"], fromBeginning: true }); store.processPending();
    assert.equal(replay.receipt?.duplicates, 1); assert.equal(store.listTraces().find((trace) => trace.sessionId === "s2")?.eventCount, 1);
    store.close();
  } finally { temp.cleanup(); }
});

test("full-file digests, bounded reads, globs, custom redaction, and oversize safety", () => {
  const temp = temporary();
  try {
    const userHome = `${temp.path}/user`; mkdirSync(userHome, { recursive: true }); const state = `${temp.path}/state`;
    write(`${userHome}/.codex/config.toml`, `api_key = "my-secret"\n`);
    write(`${userHome}/.codex/sessions/2026/08/04/s.jsonl`, `${JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: "hello" } })}\n`);
    const store = new AgentTracesStore(`${state}/db.sqlite`, state); const collector = new LocalCollector(store, userHome);
    const first = collector.scan({ sources: ["codex"], fromBeginning: true, maxReadBytes: 1024, redactPatterns: [/my-secret/g] })[0]!;
    assert.ok(first.envelopes.length >= 1); assert.doesNotMatch(JSON.stringify(first.envelopes), /my-secret/);
    assert.equal(collector.scan({ sources: ["codex"] })[0]?.envelopes.length, 0);
    write(`${userHome}/.codex/config.toml`, "x".repeat(2048));
    const oversized = collector.scan({ sources: ["codex"], maxEventBytes: 64 })[0]!; assert.ok(oversized.errors.some((error) => error.includes("max event size")));
    assert.equal(collectorInternals.globRegex("/a/**/*.jsonl").test("/a/b/c.jsonl"), true);
    assert.equal(resolveSourcePath("{appdata}/Code", "/home/u", "linux"), "/home/u/.config/Code");
    store.close();
  } finally { temp.cleanup(); }
});

test("SQLite capture establishes a high-water mark then incrementally reads new rows", () => {
  const temp = temporary();
  try {
    const userHome = `${temp.path}/user`; const state = `${temp.path}/state`;
    const path = `${userHome}/Library/Application Support/Cursor/User/globalStorage/state.vscdb`; mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    const database = new DatabaseSync(path); database.exec("CREATE TABLE cursorDiskKV(key TEXT,value TEXT); CREATE TABLE ItemTable(key TEXT,value TEXT)");
    database.prepare("INSERT INTO cursorDiskKV VALUES (?,?)").run("composerData:old", JSON.stringify({ createdAt: 1, messages: [{ role: "user", text: "old" }] })); database.close();
    const store = new AgentTracesStore(`${state}/db.sqlite`, state); const collector = new LocalCollector(store, userHome);
    assert.equal(collector.scan({ sources: ["cursor"] })[0]?.envelopes.length, 0);
    const update = new DatabaseSync(path); update.prepare("INSERT INTO cursorDiskKV VALUES (?,?)").run("composerData:new", JSON.stringify({ createdAt: 2, messages: [{ role: "user", text: "new" }] })); update.close();
    const result = collector.scan({ sources: ["cursor"], maxEvents: 5 })[0]!;
    assert.ok(result.envelopes.some((item) => item.raw.key === "composerData:new")); assert.ok(result.envelopes.length <= 5);
    store.close();
  } finally { temp.cleanup(); }
});
