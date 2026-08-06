import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { temporary } from "./helpers.js";

function run(entry: string, args: string[], home: string, input?: string) {
  return spawnSync(process.execPath, ["--import", "tsx", entry, ...args], { cwd: process.cwd(), env: { ...process.env, AGENTTRACES_HOME: home }, input, encoding: "utf8", timeout: 10_000 });
}

test("CLI executable prints help and exits cleanly", () => {
  const temp = temporary();
  try { const result = run("apps/cli/src/main.ts", ["help"], temp.path); assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /agenttraces <command>/); }
  finally { temp.cleanup(); }
});

test("MCP stdio executable handles initialize and tools/list lines", () => {
  const temp = temporary();
  try {
    const input = `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" })}\n${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`;
    const result = run("apps/mcp/src/main.ts", [], temp.path, input); assert.equal(result.status, 0, result.stderr);
    const messages = result.stdout.trim().split("\n").map((line) => JSON.parse(line) as { id: number; result: Record<string, unknown> });
    assert.equal(messages[0]?.id, 1); assert.equal((messages[1]?.result.tools as unknown[]).length, 12);
  } finally { temp.cleanup(); }
});

test("the packaged CLI MCP command emits protocol messages only", () => {
  const temp = temporary();
  try {
    const input = `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" })}\n`;
    const result = run("apps/cli/src/main.ts", ["mcp"], temp.path, input); assert.equal(result.status, 0, result.stderr);
    const lines = result.stdout.trim().split("\n"); assert.equal(lines.length, 1); assert.equal(JSON.parse(lines[0]!).id, 1);
  } finally { temp.cleanup(); }
});

test("worker executable drains an empty queue with stable JSON", () => {
  const temp = temporary();
  try { const result = run("apps/worker/src/main.ts", [], temp.path); assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout), { service: "agenttraces-worker", processed: 0, failed: 0, produced: 0, remaining: 0 }); }
  finally { temp.cleanup(); }
});
