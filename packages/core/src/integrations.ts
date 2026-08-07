import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";

const START = "# >>> agenttraces managed >>>";
const END = "# <<< agenttraces managed <<<";

function ensureParent(path: string) { mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); }
function readJson(path: string) {
  if (!existsSync(path)) return {} as Record<string, unknown>;
  try { return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>; } catch { throw new Error(`Cannot safely update invalid JSON: ${path}`); }
}
function writeJson(path: string, value: unknown) { ensureParent(path); writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); }

export interface IntegrationReceipt { host: "claude_code" | "codex" | "cursor" | "background_daemon"; configPath: string; skillPath?: string; active?: boolean }

export function installIntegrations(userHome: string, command = "npx") {
  const receipts: IntegrationReceipt[] = [];
  const args = command === "npx" ? ["-y", "agenttraces", "mcp"] : ["mcp"];
  const server = { command, args };

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
  const managed = `${START}\n[mcp_servers.agenttraces]\ncommand = ${JSON.stringify(command)}\nargs = ${JSON.stringify(args)}\n${END}\n`;
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

  receipts.push(installBackgroundDaemon(userHome, command));

  return receipts;
}

function commandPath(command: string) {
  if (command.includes("/")) return command;
  for (const directory of (process.env.PATH ?? "").split(":")) {
    const candidate = `${directory}/${command}`; if (existsSync(candidate)) return candidate;
  }
  return command;
}

function xml(value: string) { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); }

function installBackgroundDaemon(userHome: string, command: string): IntegrationReceipt {
  const args = command === "npx" ? ["-y", "agenttraces", "daemon", "run"] : ["daemon", "run"];
  const executable = commandPath(command);
  const active = userHome === homedir();
  if (process.platform === "darwin") {
    const configPath = `${userHome}/Library/LaunchAgents/com.agenttraces.daemon.plist`;
    const argumentsXml = [executable, ...args].map((value) => `      <string>${xml(value)}</string>`).join("\n");
    const path = [dirname(executable), dirname(process.execPath), `${userHome}/.local/bin`, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].filter(Boolean).join(":");
    const plist = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n  <key>Label</key><string>com.agenttraces.daemon</string>\n  <key>ProgramArguments</key>\n  <array>\n${argumentsXml}\n  </array>\n  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(path)}</string></dict>\n  <key>RunAtLoad</key><true/>\n  <key>KeepAlive</key><true/>\n  <key>ThrottleInterval</key><integer>10</integer>\n  <key>StandardOutPath</key><string>${xml(`${userHome}/.agenttraces/daemon.stdout.log`)}</string>\n  <key>StandardErrorPath</key><string>${xml(`${userHome}/.agenttraces/daemon.stderr.log`)}</string>\n</dict>\n</plist>\n`;
    ensureParent(configPath); writeFileSync(configPath, plist, { mode: 0o600 });
    if (active) {
      const domain = `gui/${process.getuid?.() ?? 0}`;
      try { execFileSync("/bin/launchctl", ["bootout", `${domain}/com.agenttraces.daemon`], { stdio: "ignore" }); } catch {}
      for (let attempt = 0; attempt < 5; attempt++) {
        try { execFileSync("/bin/launchctl", ["bootstrap", domain, configPath], { stdio: "ignore" }); break; }
        catch (error) { if (attempt === 4) throw error; execFileSync("/bin/sleep", ["1"]); }
      }
      execFileSync("/bin/launchctl", ["kickstart", "-k", `${domain}/com.agenttraces.daemon`], { stdio: "ignore" });
    }
    return { host: "background_daemon", configPath, active };
  }
  const configPath = `${userHome}/.config/systemd/user/agenttraces.service`;
  const execStart = [executable, ...args].map((value) => JSON.stringify(value)).join(" ");
  ensureParent(configPath); writeFileSync(configPath, `[Unit]\nDescription=AgentTraces local capture\n\n[Service]\nType=simple\nExecStart=${execStart}\nRestart=always\nRestartSec=10\n\n[Install]\nWantedBy=default.target\n`, { mode: 0o600 });
  if (active && process.platform === "linux") {
    execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
    execFileSync("systemctl", ["--user", "enable", "--now", "agenttraces.service"], { stdio: "ignore" });
  }
  return { host: "background_daemon", configPath, active: active && process.platform === "linux" };
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
  if (process.platform === "darwin") {
    const plist = `${userHome}/Library/LaunchAgents/com.agenttraces.daemon.plist`;
    if (userHome === homedir()) { try { execFileSync("/bin/launchctl", ["bootout", `gui/${process.getuid?.() ?? 0}/com.agenttraces.daemon`], { stdio: "ignore" }); } catch {} }
    if (existsSync(plist)) { unlinkSync(plist); changed.push(plist); }
  } else {
    const unit = `${userHome}/.config/systemd/user/agenttraces.service`;
    if (userHome === homedir() && process.platform === "linux") { try { execFileSync("systemctl", ["--user", "disable", "--now", "agenttraces.service"], { stdio: "ignore" }); } catch {} }
    if (existsSync(unit)) { unlinkSync(unit); changed.push(unit); }
  }
  return { changed, preservedUserConfiguration: true };
}
