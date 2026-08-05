import { accessSync, constants, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import {
  AgentTracesDaemon, AgentTracesStore, LocalCollector, ParserRegistry, canonicalRepository,
  inspectGit, installIntegrations, isSourceName, removeIntegrations, runtimePaths,
  type SourceName, type Visibility,
} from "@agenttraces/core";

export interface CliIo { out(value: string): void; err(value: string): void }
export interface CliContext { stateHome?: string; userHome?: string; cwd?: string; io?: CliIo }

interface Parsed { command: string; subcommand?: string; positionals: string[]; options: Record<string, string | boolean> }

const HELP = `agenttraces <command> [options]

Capture:  up, status, pause, resume, daemon, doctor, uninstall
Trace:    sessions, search, show, current, privacy, share, links, usage, pr
Account:  login, logout, team, github, config
Reuse:    skill
Protocol: mcp

Use --json for stable machine-readable output. Local state is encrypted; a configured endpoint is canonical after durable upload acknowledgement.`;

function parseArgs(argv: string[]): Parsed {
  const positionals: string[] = []; const options: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (!arg.startsWith("--")) { positionals.push(arg); continue; }
    const [rawKey, inline] = arg.slice(2).split("=", 2); const key = rawKey!;
    if (inline !== undefined) options[key] = inline;
    else if (argv[index + 1] && !argv[index + 1]!.startsWith("--")) options[key] = argv[++index]!;
    else options[key] = true;
  }
  return { command: positionals.shift() ?? "help", subcommand: positionals[0], positionals, options };
}

function source(value: string | boolean | undefined): SourceName | undefined {
  if (!value) return undefined;
  if (typeof value !== "string" || !isSourceName(value)) throw new Error(`Unknown source: ${String(value)}`);
  return value;
}
function integer(value: string | boolean | undefined, fallback: number) {
  const parsed = typeof value === "string" ? Number(value) : fallback;
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error("Expected a positive integer");
  return parsed;
}
function required(value: string | boolean | undefined, label: string) {
  if (typeof value !== "string" || !value) throw new Error(`Missing ${label}`);
  return value;
}
function display(value: unknown, json: boolean) {
  if (json || typeof value !== "string") return JSON.stringify(value, null, json ? 2 : 2);
  return value;
}

export async function executeCli(argv: string[], context: CliContext = {}): Promise<{ code: number; value?: unknown }> {
  const parsed = parseArgs(argv); const asJson = parsed.options.json === true;
  const io = context.io ?? { out: console.log, err: console.error };
  const state = runtimePaths(context.stateHome ?? (typeof parsed.options.home === "string" ? parsed.options.home : undefined));
  const userHome = context.userHome ?? (typeof parsed.options["user-home"] === "string" ? parsed.options["user-home"] : homedir());
  let store: AgentTracesStore | undefined;
  try {
    if (["help", "--help", "-h"].includes(parsed.command)) { io.out(HELP); return { code: 0, value: HELP }; }
    if (parsed.command === "version") { io.out("0.1.0"); return { code: 0, value: "0.1.0" }; }
    store = new AgentTracesStore(state.database, state.home);
    const value = await command(parsed, store, userHome, context.cwd ?? process.cwd());
    io.out(display(value, asJson));
    return { code: 0, value };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.err(asJson ? JSON.stringify({ error: message }) : `Error: ${message}`);
    return { code: 1 };
  } finally { store?.close(); }
}

async function command(parsed: Parsed, store: AgentTracesStore, userHome: string, cwd: string): Promise<unknown> {
  const { command, options, positionals } = parsed;
  if (command === "up") {
    const collector = new LocalCollector(store, userHome);
    const detection = collector.detect();
    const endpoint = typeof options.endpoint === "string" ? options.endpoint : process.env.AGENTTRACES_ENDPOINT;
    if (endpoint) store.setSetting("endpoint", endpoint);
    store.setSetting("capture_enabled", "true");
    const integrations = options["no-integrations"] ? [] : installIntegrations(userHome, typeof options.command === "string" ? options.command : "agenttraces");
    const history = options.history === "all";
    const capture = collector.scanAndEnqueue({ fromBeginning: history, maxEvents: integer(options.limit, 10_000) });
    const worker = store.processPending();
    return {
      status: "ready", disclosure: "New coding-agent sessions are captured automatically. Personal traces are private by default. A configured cloud endpoint becomes canonical only after durable acknowledgement.",
      identity: store.installation(), endpoint: endpoint ?? null, cloud: endpoint ? "configured" : "awaiting_deployment_configuration",
      history: history ? "imported" : "new_sessions_only", detected: detection.filter((item) => item.detected).map((item) => item.source),
      integrations, capture: summarizeCapture(capture.results), receipt: capture.receipt, worker,
    };
  }
  if (command === "status") return status(store, userHome);
  if (command === "pause") { store.setSetting("capture_enabled", "false"); return { captureEnabled: false }; }
  if (command === "resume") { store.setSetting("capture_enabled", "true"); return { captureEnabled: true }; }
  if (command === "login") return store.claim(required(options.email ?? positionals[0], "email"), typeof options.name === "string" ? options.name : undefined);
  if (command === "logout") { store.setSetting("auth_session", "none"); return { loggedOut: true, deviceClaimPreserved: true }; }
  if (command === "sessions") return { traces: store.listTraces(store.actor(), { source: source(options.source), repository: typeof options.repository === "string" ? options.repository : undefined, limit: integer(options.limit, 50) }) };
  if (command === "search") return { results: store.search({ query: positionals.join(" ") || required(options.query, "query"), source: source(options.source), repository: typeof options.repository === "string" ? options.repository : undefined, scope: typeof options.scope === "string" ? options.scope as never : undefined, limit: integer(options.limit, 10) }) };
  if (command === "show") return store.getTrace(required(positionals[0] ?? options.id, "trace ID"), store.actor(), (typeof options.view === "string" ? options.view : "summary") as never);
  if (command === "current") return store.current();
  if (command === "usage") return store.usage(store.actor(), { source: source(options.source), repository: typeof options.repository === "string" ? options.repository : undefined });
  if (command === "links") return shareCommand(["list"], options, store);
  if (command === "share") return shareCommand(positionals, options, store);
  if (command === "privacy") return privacyCommand(positionals, options, store);
  if (command === "skill") return skillCommand(positionals, options, store);
  if (command === "team") return teamCommand(positionals, options, store);
  if (command === "github") return githubCommand(positionals, options, store);
  if (command === "config") return configCommand(positionals, options, store);
  if (command === "pr") {
    const snapshot = inspectGit(cwd); const repository = canonicalRepository(snapshot?.remote);
    const number = typeof options.number === "string" ? Number(options.number) : undefined;
    return { git: snapshot, traces: store.listTraces().filter((trace) => (!repository || trace.repository === repository) && (!number || trace.pullRequest === number)) };
  }
  if (command === "doctor") return doctor(store, userHome, cwd);
  if (command === "daemon") {
    if (store.setting("capture_enabled") === "false") return { status: "paused" };
    const daemon = new AgentTracesDaemon(store, userHome);
    if (positionals[0] === "upload") return daemon.upload(required(options.endpoint ?? store.setting("endpoint"), "endpoint"), { fromBeginning: options.history === "all", maxEvents: integer(options.limit, 10_000) });
    return daemon.runOnce({ fromBeginning: options.history === "all", maxEvents: integer(options.limit, 10_000) });
  }
  if (command === "uninstall") {
    store.setSetting("capture_enabled", "false");
    return { integrations: removeIntegrations(userHome), captureEnabled: false, localDataPreserved: true, note: "Delete the AgentTraces state directory manually only after export if permanent erasure is intended." };
  }
  if (command === "mcp") return { command: "Use the dedicated @agenttraces/mcp stdio entrypoint", stateHome: store.stateDirectory };
  throw new Error(`Unknown command: ${command}`);
}

function summarizeCapture(results: ReturnType<LocalCollector["scan"]>) {
  return results.map((item) => ({ source: item.source, detected: item.detected, files: item.files, databases: item.databases, envelopes: item.envelopes.length, skipped: item.skipped, errors: item.errors }));
}

function status(store: AgentTracesStore, userHome: string) {
  return { installation: store.installation(), endpoint: store.setting("endpoint") ?? null, spool: store.spoolStatus(), traces: store.listTraces().length, sources: new LocalCollector(store, userHome).detect(), teams: store.listTeams() };
}

function shareCommand(positionals: string[], options: Record<string, string | boolean>, store: AgentTracesStore) {
  const action = positionals[0] ?? "list";
  if (action === "list") return { shares: store.listShares() };
  if (action === "revoke") return store.revokeShare(required(positionals[1] ?? options.id, "share ID"));
  const traceId = action === "create" ? required(positionals[1] ?? options.trace, "trace ID") : action;
  return store.createShare({ traceId, content: (typeof options.content === "string" ? options.content : "summary") as never, audience: (typeof options.audience === "string" ? options.audience : "anyone_with_link") as never, emails: typeof options.emails === "string" ? options.emails.split(",") : undefined, teamId: typeof options.team === "string" ? options.team : undefined, agentRetrieve: options["agent-retrieve"] !== "false", allowContext: options["allow-context"] === true, allowSkillCreation: options["allow-skill"] === true, expiresAt: typeof options.expires === "string" ? options.expires : undefined, maxViews: typeof options["max-views"] === "string" ? Number(options["max-views"]) : undefined });
}

function privacyCommand(positionals: string[], options: Record<string, string | boolean>, store: AgentTracesStore) {
  const action = positionals[0] ?? "show";
  if (action === "show") return { default: store.setting("privacy.default") ?? "private", captureEnabled: store.setting("capture_enabled") !== "false", exclusions: JSON.parse(store.setting("privacy.exclusions") ?? "[]") };
  if (action === "default") { const visibility = required(positionals[1] ?? options.visibility, "visibility") as Visibility; if (!visibilityValues.includes(visibility)) throw new Error("Invalid visibility"); store.setSetting("privacy.default", visibility); return { default: visibility }; }
  if (action === "trace") return store.setTraceVisibility(required(positionals[1], "trace ID"), required(positionals[2] ?? options.visibility, "visibility") as Visibility);
  if (action === "exclude") { const values = JSON.parse(store.setting("privacy.exclusions") ?? "[]") as string[]; const repository = required(positionals[1] ?? options.repository, "repository"); if (!values.includes(repository)) values.push(repository); store.setSetting("privacy.exclusions", JSON.stringify(values)); return { exclusions: values }; }
  throw new Error(`Unknown privacy action: ${action}`);
}
const visibilityValues: Visibility[] = ["private", "team", "direct_link", "public"];

function skillCommand(positionals: string[], options: Record<string, string | boolean>, store: AgentTracesStore) {
  const action = positionals[0] ?? "list";
  if (action === "list") return { skills: store.listSkills(store.actor(), typeof options.query === "string" ? options.query : "") };
  if (action === "show") return store.getSkill(required(positionals[1] ?? options.id, "skill ID"));
  if (action === "archive") return store.archiveSkill(required(positionals[1] ?? options.id, "skill ID"));
  if (action === "create") return store.createSkill({ name: required(options.name ?? positionals[1], "name"), description: typeof options.description === "string" ? options.description : "", instructions: typeof options.instructions === "string" ? options.instructions.split("|") : [], validation: typeof options.validation === "string" ? options.validation.split("|") : [], traceIds: required(options.traces, "trace IDs").split(","), visibility: typeof options.visibility === "string" ? options.visibility as Visibility : "private" });
  throw new Error(`Unknown skill action: ${action}`);
}

function teamCommand(positionals: string[], options: Record<string, string | boolean>, store: AgentTracesStore) {
  const action = positionals[0] ?? "list";
  if (action === "list") return { teams: store.listTeams(), activeTeamId: store.setting("active_team_id") || null };
  if (action === "create") return store.createTeam(required(positionals[1] ?? options.slug, "team slug"));
  if (action === "join") return store.joinTeam(required(positionals[1] ?? options.id, "team ID"), (typeof options.role === "string" ? options.role : "member") as never);
  if (action === "use") return store.useNamespace(positionals[1] ?? (typeof options.id === "string" ? options.id : undefined));
  if (action === "policy") return store.setTeamPolicy(required(positionals[1] ?? options.id, "team ID"), required(options.visibility, "visibility") as "private" | "team");
  throw new Error(`Unknown team action: ${action}`);
}

function githubCommand(positionals: string[], options: Record<string, string | boolean>, store: AgentTracesStore) {
  const action = positionals[0] ?? "status";
  if (action === "status") return { connected: Boolean(store.setting("github.installation_id")), installationId: store.setting("github.installation_id") ?? null };
  if (action === "connect") { const installationId = required(options.installation ?? positionals[1], "GitHub installation ID"); store.setSetting("github.installation_id", installationId); return { connected: true, installationId }; }
  if (action === "disconnect") { store.setSetting("github.installation_id", ""); return { connected: false }; }
  throw new Error(`Unknown GitHub action: ${action}`);
}

function configCommand(positionals: string[], options: Record<string, string | boolean>, store: AgentTracesStore) {
  const action = positionals[0] ?? "list";
  if (action === "list") return store.settings();
  if (action === "get") return { key: required(positionals[1], "key"), value: store.setting(required(positionals[1], "key")) ?? null };
  if (action === "set") { const key = required(positionals[1], "key"); const value = required(positionals[2] ?? options.value, "value"); store.setSetting(key, value); return { key, value }; }
  throw new Error(`Unknown config action: ${action}`);
}

function doctor(store: AgentTracesStore, userHome: string, cwd: string) {
  const checks: Array<{ name: string; ok: boolean; detail: unknown }> = [];
  checks.push({ name: "database", ok: existsSync(store.databasePath), detail: store.databasePath });
  checks.push({ name: "parsers", ok: new ParserRegistry().inventory().length === 7, detail: new ParserRegistry().inventory() });
  checks.push({ name: "sources", ok: true, detail: new LocalCollector(store, userHome).detect() });
  checks.push({ name: "git", ok: inspectGit(cwd) !== null, detail: inspectGit(cwd) });
  for (const path of [`${store.stateDirectory}/device-private.pem`, `${store.stateDirectory}/encryption.key`]) {
    let secure = false; try { accessSync(path, constants.R_OK); secure = (statSync(path).mode & 0o077) === 0; } catch {}
    checks.push({ name: `permissions:${path.split("/").at(-1)}`, ok: secure, detail: secure ? "0600" : "not private" });
  }
  return { ok: checks.every((check) => check.ok), checks };
}
