import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const START = "# >>> agenttraces managed >>>";
const END = "# <<< agenttraces managed <<<";

function ensureParent(path: string) { mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); }
function readJson(path: string) {
  if (!existsSync(path)) return {} as Record<string, unknown>;
  try { return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>; } catch { throw new Error(`Cannot safely update invalid JSON: ${path}`); }
}
function writeJson(path: string, value: unknown) { ensureParent(path); writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); }

export interface IntegrationReceipt { host: "claude_code" | "codex" | "cursor"; configPath: string; skillPath: string }

export function installIntegrations(userHome: string, command = "agenttraces") {
  const receipts: IntegrationReceipt[] = [];
  const server = { command, args: ["mcp"] };

  const claudeConfigPath = `${userHome}/.claude.json`;
  const claudeConfig = readJson(claudeConfigPath);
  claudeConfig.mcpServers = { ...(claudeConfig.mcpServers as Record<string, unknown> ?? {}), agenttraces: server };
  writeJson(claudeConfigPath, claudeConfig);
  const claudeSkill = `${userHome}/.claude/skills/agenttraces/SKILL.md`;
  writeSkill(claudeSkill);
  receipts.push({ host: "claude_code", configPath: claudeConfigPath, skillPath: claudeSkill });

  const codexConfigPath = `${userHome}/.codex/config.toml`;
  const existing = existsSync(codexConfigPath) ? readFileSync(codexConfigPath, "utf8") : "";
  const cleaned = existing.replace(new RegExp(`${escape(START)}[\\s\\S]*?${escape(END)}\\n?`, "g"), "").trimEnd();
  const managed = `${START}\n[mcp_servers.agenttraces]\ncommand = ${JSON.stringify(command)}\nargs = [\"mcp\"]\n${END}\n`;
  ensureParent(codexConfigPath); writeFileSync(codexConfigPath, `${cleaned}${cleaned ? "\n\n" : ""}${managed}`, { mode: 0o600 });
  const codexSkill = `${userHome}/.codex/skills/agenttraces/SKILL.md`;
  writeSkill(codexSkill);
  receipts.push({ host: "codex", configPath: codexConfigPath, skillPath: codexSkill });

  const cursorConfigPath = `${userHome}/.cursor/mcp.json`;
  const cursorConfig = readJson(cursorConfigPath);
  cursorConfig.mcpServers = { ...(cursorConfig.mcpServers as Record<string, unknown> ?? {}), agenttraces: server };
  writeJson(cursorConfigPath, cursorConfig);
  const cursorSkill = `${userHome}/.cursor/rules/agenttraces.mdc`;
  ensureParent(cursorSkill); writeFileSync(cursorSkill, skillBody(), { mode: 0o600 });
  receipts.push({ host: "cursor", configPath: cursorConfigPath, skillPath: cursorSkill });

  return receipts;
}

function escape(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function skillBody() {
  return `---\nname: agenttraces\ndescription: Retrieve permissioned evidence from prior coding-agent work and connect current work to pull requests.\n---\n\nUse AgentTraces when prior implementation evidence could prevent repeated work, when the user asks what happened in an earlier session, or when a pull request needs its agent history. Start with search_traces or get_pr_trace, retrieve the smallest useful view, and preserve trace IDs as provenance.\n\nWhen an opened trace has no cached enrichment, call prepare_trace_enrichment, write a concise title, summary, stages, and outcome with the model subscription already running this session, then call save_trace_enrichment. Do not send trace content to another model unless the user explicitly configured one.\n\nNever confirm a share or reusable-skill mutation without the human's explicit approval. Default external shares to an immutable overview; only create a live or full-trace share when requested.\n`;
}
function writeSkill(path: string) { ensureParent(path); writeFileSync(path, skillBody(), { mode: 0o600 }); }

export function removeIntegrations(userHome: string) {
  const changed: string[] = [];
  for (const path of [`${userHome}/.claude.json`, `${userHome}/.cursor/mcp.json`]) {
    if (!existsSync(path)) continue;
    const config = readJson(path); const servers = { ...(config.mcpServers as Record<string, unknown> ?? {}) };
    if ("agenttraces" in servers) { delete servers.agenttraces; config.mcpServers = servers; writeJson(path, config); changed.push(path); }
  }
  const codex = `${userHome}/.codex/config.toml`;
  if (existsSync(codex)) {
    const content = readFileSync(codex, "utf8");
    const cleaned = content.replace(new RegExp(`${escape(START)}[\\s\\S]*?${escape(END)}\\n?`, "g"), "");
    if (cleaned !== content) { writeFileSync(codex, cleaned, { mode: 0o600 }); changed.push(codex); }
  }
  return { changed, preservedUserConfiguration: true };
}
