import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { executeCli } from "../apps/cli/src/cli.js";
import { temporary, write } from "./helpers.js";

function capture() {
  const out: string[] = []; const err: string[] = [];
  return { out, err, io: { out: (value: string) => out.push(value), err: (value: string) => err.push(value) } };
}

test("CLI personal install, capture, claim, search, privacy, sharing, skills, teams, GitHub, and uninstall", async () => {
  const temp = temporary();
  try {
    const userHome = `${temp.path}/user`; const stateHome = `${temp.path}/state`;
    write(`${userHome}/.claude/projects/repo/session.jsonl`, `${JSON.stringify({ type: "user", session_id: "cli", message: { role: "user", content: "CLI sentinel" } })}\n`);
    const log = capture(); const context = { userHome, stateHome, cwd: process.cwd(), io: log.io };
    assert.equal((await executeCli(["up", "--history", "all", "--json"], context)).code, 0);
    assert.ok(existsSync(`${userHome}/.claude.json`)); assert.match(readFileSync(`${userHome}/.codex/config.toml`, "utf8"), /mcp_servers\.agenttraces/); assert.ok(existsSync(`${userHome}/.cursor/mcp.json`));
    const search = await executeCli(["search", "CLI sentinel", "--json"], context); assert.equal((search.value as { results: unknown[] }).results.length, 1);
    const sessions = await executeCli(["sessions", "--json"], context); const traceId = (sessions.value as { traces: Array<{ id: string }> }).traces[0]!.id;
    assert.equal((await executeCli(["show", traceId, "--view", "full_transcript", "--json"], context)).code, 0);
    assert.equal((await executeCli(["login", "--email", "developer@example.com", "--json"], context)).code, 0);
    assert.equal((await executeCli(["privacy", "default", "private", "--json"], context)).code, 0);
    assert.equal((await executeCli(["share", "create", traceId, "--content", "summary", "--json"], context)).code, 0);
    assert.equal(((await executeCli(["links", "--json"], context)).value as { shares: unknown[] }).shares.length, 1);
    assert.equal((await executeCli(["skill", "create", "--name", "cli-skill", "--traces", traceId, "--instructions", "Inspect|Verify", "--json"], context)).code, 0);
    const team = await executeCli(["team", "create", "cli-team", "--json"], context); const teamId = (team.value as { id: string }).id;
    assert.equal((await executeCli(["team", "policy", teamId, "--visibility", "team", "--json"], context)).code, 0);
    const setup = await executeCli(["team", "setup-link", "create", teamId, "--domain", "example.com", "--max-uses", "3", "--json"], context);
    assert.match((setup.value as { url: string }).url, /^\/join\//);
    assert.equal((await executeCli(["team", "repository", "add", teamId, "https://github.com/OximyHQ/agenttraces", "--json"], context)).code, 0);
    assert.equal(((await executeCli(["team", "devices", teamId, "--json"], context)).value as { devices: unknown[] }).devices.length, 1);
    const prepared = await executeCli(["summarize", "prepare", traceId, "--json"], context);
    assert.equal((prepared.value as { promptVersion: string }).promptVersion, "trace-summary-v1");
    assert.equal((await executeCli(["summarize", "save", traceId, "--title", "CLI trace", "--summary", "Captured and indexed the CLI session.", "--outcome", "completed", "--json"], context)).code, 0);
    assert.equal((await executeCli(["pr", "link", traceId, "--repository", "https://github.com/OximyHQ/agenttraces", "--number", "7", "--title", "CLI trace", "--json"], context)).code, 0);
    const pullRequest = await executeCli(["pr", "show", "--repository", "https://github.com/OximyHQ/agenttraces", "--number", "7", "--json"], context);
    assert.equal((pullRequest.value as { traces: unknown[] }).traces.length, 1);
    assert.equal((await executeCli(["github", "connect", "--installation", "123", "--json"], context)).code, 0);
    assert.equal((await executeCli(["doctor", "--json"], context)).code, 0);
    const uninstall = await executeCli(["uninstall", "--json"], context); assert.equal((uninstall.value as { localDataPreserved: boolean }).localDataPreserved, true);
    assert.doesNotMatch(readFileSync(`${userHome}/.codex/config.toml`, "utf8"), /mcp_servers\.agenttraces/);
  } finally { temp.cleanup(); }
});

test("CLI reports stable errors and does not mutate integrations when disabled", async () => {
  const temp = temporary();
  try {
    const log = capture(); const context = { userHome: `${temp.path}/user`, stateHome: `${temp.path}/state`, io: log.io };
    assert.equal((await executeCli(["up", "--no-integrations", "--json"], context)).code, 0); assert.equal(existsSync(`${temp.path}/user/.claude.json`), false);
    assert.equal((await executeCli(["search", "--json"], context)).code, 1); assert.match(log.err.at(-1) ?? "", /Missing query/);
    assert.equal((await executeCli(["unknown", "--json"], context)).code, 1);
  } finally { temp.cleanup(); }
});

test("CLI never prints secret configuration values", async () => {
  const temp = temporary();
  try {
    const context = { stateHome: `${temp.path}/state`, userHome: `${temp.path}/user`, io: { out() {}, err() {} } };
    const stored = await executeCli(["config", "set", "cloud.access_token", "sensitive-test-value", "--json"], context);
    assert.deepEqual(stored.value, { key: "cloud.access_token", value: "<redacted>" });
    const listed = await executeCli(["config", "list", "--json"], context);
    assert.equal((listed.value as Record<string, string>)["cloud.access_token"], "<redacted>");
    const read = await executeCli(["config", "get", "cloud.access_token", "--json"], context);
    assert.deepEqual(read.value, { key: "cloud.access_token", value: "<redacted>" });
  } finally { temp.cleanup(); }
});
