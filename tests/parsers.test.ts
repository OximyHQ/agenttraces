import assert from "node:assert/strict";
import test from "node:test";
import { ParserRegistry, SOURCE_DEFINITIONS, SOURCE_NAMES } from "../packages/core/src/index.js";
import { envelope, rawFor } from "./helpers.js";

test("registry contains all seven Oximy local parsers", () => {
  const registry = new ParserRegistry();
  assert.deepEqual(registry.inventory().map((item) => item.source), [...SOURCE_NAMES]);
});

test("every configured collector file type has a parser and fixture", () => {
  const registry = new ParserRegistry();
  const inventory = new Map(registry.inventory().map((item) => [item.source, new Set(item.fileTypes)]));
  let fixtureCount = 0;
  for (const definition of SOURCE_DEFINITIONS) {
    const configured = new Set([...definition.globs.map((glob) => glob.fileType), ...definition.sqlite.flatMap((database) => database.queries.map((query) => query.fileType))]);
    assert.deepEqual(configured, inventory.get(definition.name), `${definition.name} collector/parser drift`);
    for (const fileType of configured) {
      const result = registry.parse(envelope(definition.name, fileType, rawFor(definition.name, fileType)));
      assert.equal(result.success, true, `${definition.name}/${fileType}: ${result.error}`);
      assert.ok(result.records.length >= 1, `${definition.name}/${fileType} produced no normalized evidence`);
      for (const record of result.records) {
        assert.equal(record.source, definition.name); assert.ok(record.traceId.startsWith("tr_")); assert.ok(record.parserVersion);
      }
      fixtureCount++;
    }
  }
  assert.equal(fixtureCount, 31);
});

test("Claude, Codex, Cursor, Copilot tools and usage normalize to explicit kinds", () => {
  const registry = new ParserRegistry();
  const claude = registry.parse(envelope("claude_code", "session_transcript", { type: "assistant", message: { role: "assistant", content: [{ type: "thinking", thinking: "plan" }, { type: "tool_use", id: "1", name: "Edit", input: { path: "a.ts" } }, { type: "tool_result", tool_use_id: "1", content: "ok" }] } }));
  assert.deepEqual(claude.records.map((record) => record.kind), ["reasoning", "tool_call", "tool_result"]);
  const codex = registry.parse(envelope("codex", "session_transcript", { type: "event_msg", payload: { type: "token_usage", usage: { input_tokens: 10, output_tokens: 4 } } }));
  assert.equal(codex.records[0]?.kind, "usage"); assert.equal(codex.records[0]?.inputTokens, 10);
  const cursor = registry.parse(envelope("cursor", "agent_transcript", { value: [{ role: "assistant", text: "done", toolName: "edit" }] }));
  assert.equal(cursor.records[0]?.kind, "tool_call");
  const copilot = registry.parse(envelope("copilot", "copilot_compact_transcript", { type: "tool.execution_complete", toolCallId: "1", output: "done" }));
  assert.equal(copilot.records[0]?.kind, "tool_result");
});
