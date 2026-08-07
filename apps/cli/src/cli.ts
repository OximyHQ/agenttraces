import { accessSync, constants, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import {
  AgentTracesDaemon, AgentTracesStore, LocalCollector, ParserRegistry, canonicalRepository,
  inspectGit, installIntegrations, isSourceName, removeIntegrations, runMcpStdio, runRemoteMcpStdio, runtimePaths,
  type SourceName, type Visibility,
} from "@agenttraces/core";

export interface CliIo { out(value: string): void; err(value: string): void }
export interface CliContext { stateHome?: string; userHome?: string; cwd?: string; io?: CliIo }

interface Parsed { command: string; subcommand?: string; positionals: string[]; options: Record<string, string | boolean> }

const HELP = `agenttraces <command> [options]

Capture:  up, status, pause, resume, daemon, doctor, uninstall
Trace:    sessions, search, show, current, summarize, privacy, share, links, usage, pr
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
    if (parsed.command === "version") { io.out("0.2.0"); return { code: 0, value: "0.2.0" }; }
    store = new AgentTracesStore(state.database, state.home);
    const value = await command(parsed, store, userHome, context.cwd ?? process.cwd());
    if (parsed.command !== "mcp") io.out(display(value, asJson));
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
    if (!store.setting("capture.started_at")) store.setSetting("capture.started_at", new Date().toISOString());
    const collector = new LocalCollector(store, userHome);
    const detection = collector.detect();
    const endpoint = typeof options.endpoint === "string" ? options.endpoint : process.env.AGENTTRACES_ENDPOINT;
    if (endpoint) store.setSetting("endpoint", endpoint);
    store.setSetting("capture_enabled", "true");
    const integrations = options["no-integrations"] ? [] : installIntegrations(userHome, typeof options.command === "string" ? options.command : "npx");
    const history = options.history === "all";
    if (endpoint) {
      const daemon = new AgentTracesDaemon(store, userHome); await daemon.register(endpoint);
      const account = typeof options.email === "string" ? {
        local: store.claim(options.email, typeof options.name === "string" ? options.name : undefined),
        cloud: await cloudRequest(store, "/v1/claim", "POST", { email: options.email, name: typeof options.name === "string" ? options.name : undefined }),
      } : null;
      const team = typeof options["team-token"] === "string" ? await cloudRequest(store, "/v1/setup-links/redeem", "POST", { token: options["team-token"], email: typeof options.email === "string" ? options.email : undefined }) as { teamId?: string } : null;
      if (team?.teamId) store.setSetting("cloud.active_namespace_id", team.teamId);
      const upload = await daemon.upload(endpoint, { fromBeginning: history, maxEvents: integer(options.limit, 10_000) });
      return {
        status: "ready", disclosure: "New coding-agent sessions are captured automatically. Personal traces are private by default. Cloud capture advances local cursors only after durable upload acknowledgement.",
        identity: store.installation(), endpoint, cloud: "canonical", account, team, history: history ? "imported" : "new_sessions_only",
        detected: detection.filter((item) => item.detected).map((item) => item.source), integrations,
        capture: summarizeCapture(upload.results), receipt: upload.receipt,
      };
    }
    const capture = collector.scanAndEnqueue({ fromBeginning: history, maxEvents: integer(options.limit, 10_000) });
    const worker = store.processPending();
    return {
      status: "ready", disclosure: "New coding-agent sessions are captured automatically. Personal traces are private by default. A configured cloud endpoint becomes canonical only after durable acknowledgement.",
      identity: store.installation(), endpoint: null, cloud: "awaiting_deployment_configuration",
      history: history ? "imported" : "new_sessions_only", detected: detection.filter((item) => item.detected).map((item) => item.source),
      integrations, capture: summarizeCapture(capture.results), receipt: capture.receipt, worker,
    };
  }
  if (command === "status") return status(store, userHome);
  if (command === "pause") { store.setSetting("capture_enabled", "false"); return { captureEnabled: false }; }
  if (command === "resume") { store.setSetting("capture_enabled", "true"); return { captureEnabled: true }; }
  if (command === "login") {
    const email = required(options.email ?? positionals[0], "email"); const name = typeof options.name === "string" ? options.name : undefined;
    const local = store.claim(email, name); const cloud = await cloudRequest(store, "/v1/claim", "POST", { email, name }, false);
    return { ...local, cloud };
  }
  if (command === "logout") { store.setSetting("auth_session", "none"); return { loggedOut: true, deviceClaimPreserved: true }; }
  if (command === "sessions") return { traces: store.listTraces(store.actor(), { source: source(options.source), repository: typeof options.repository === "string" ? options.repository : undefined, limit: integer(options.limit, 50) }) };
  if (command === "search") {
    const request = { query: positionals.join(" ") || required(options.query, "query"), source: source(options.source), repository: typeof options.repository === "string" ? options.repository : undefined, scope: typeof options.scope === "string" ? options.scope as never : undefined, limit: integer(options.limit, 10) };
    const endpoint = store.setting("endpoint"); const accessToken = store.setting("cloud.access_token");
    if (endpoint && accessToken && options.local !== true) {
      const response = await fetch(`${endpoint.replace(/\/$/, "")}/v1/search`, { method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, body: JSON.stringify(request) });
      if (!response.ok) throw new Error(`Remote search failed: ${response.status} ${await response.text()}`);
      return response.json();
    }
    return { results: store.search(request) };
  }
  if (command === "show") return store.getTrace(required(positionals[0] ?? options.id, "trace ID"), store.actor(), (typeof options.view === "string" ? options.view : "summary") as never);
  if (command === "summarize") return summaryCommand(positionals, options, store);
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
    const action = positionals[0] ?? "show";
    const targetRepository = required(options.repository ?? repository, "repository");
    const number = Number(required(options.number ?? positionals[action === "show" ? 1 : 2], "pull request number"));
    if (!Number.isInteger(number) || number < 1) throw new Error("Invalid pull request number");
    if (action === "link") return store.linkTraceToPullRequest(required(positionals[1] ?? options.trace, "trace ID"), {
      repository: targetRepository, number, title: typeof options.title === "string" ? options.title : undefined,
      state: typeof options.state === "string" ? options.state : undefined, url: typeof options.url === "string" ? options.url : undefined,
      evidence: (typeof options.evidence === "string" ? options.evidence : "manual") as never,
      confidence: typeof options.confidence === "string" ? Number(options.confidence) : undefined, confirmed: options.confirmed !== "false",
    });
    if (action !== "show") throw new Error(`Unknown pr action: ${action}`);
    return { git: snapshot, ...store.getPullRequestTrace(targetRepository, number) };
  }
  if (command === "doctor") return doctor(store, userHome, cwd);
  if (command === "daemon") {
    if (store.setting("capture_enabled") === "false") return { status: "paused" };
    const daemon = new AgentTracesDaemon(store, userHome);
    if (positionals[0] === "upload") return daemon.upload(required(options.endpoint ?? store.setting("endpoint"), "endpoint"), { fromBeginning: options.history === "all", maxEvents: integer(options.limit, 10_000) });
    if (positionals[0] === "backfill") return daemon.backfill(required(options.endpoint ?? store.setting("endpoint"), "endpoint"), { maxEvents: integer(options.limit, 10_000), maxPages: integer(options.pages, 10_000) });
    if (positionals[0] === "run") {
      const controller = new AbortController(); const stop = () => controller.abort(); process.once("SIGINT", stop); process.once("SIGTERM", stop);
      try { return await daemon.runWatching({ endpoint: typeof options.endpoint === "string" ? options.endpoint : store.setting("endpoint"), signal: controller.signal, onCycle: (value) => process.stderr.write(`${JSON.stringify(value)}\n`) }); }
      finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
    }
    return daemon.runOnce({ fromBeginning: options.history === "all", maxEvents: integer(options.limit, 10_000) });
  }
  if (command === "uninstall") {
    store.setSetting("capture_enabled", "false");
    return { integrations: removeIntegrations(userHome), captureEnabled: false, localDataPreserved: true, note: "Delete the AgentTraces state directory manually only after export if permanent erasure is intended." };
  }
  if (command === "mcp") {
    const endpoint = store.setting("endpoint"); const token = store.setting("cloud.access_token");
    if (endpoint && token && options.local !== true) await runRemoteMcpStdio(endpoint, token); else await runMcpStdio(store);
    return { stopped: true };
  }
  throw new Error(`Unknown command: ${command}`);
}

function summarizeCapture(results: ReturnType<LocalCollector["scan"]>) {
  return results.map((item) => ({ source: item.source, detected: item.detected, files: item.files, databases: item.databases, envelopes: item.envelopes.length, skipped: item.skipped, errors: item.errors }));
}

function status(store: AgentTracesStore, userHome: string) {
  return { installation: store.installation(), endpoint: store.setting("endpoint") ?? null, spool: store.spoolStatus(), traces: store.listTraces().length, sources: new LocalCollector(store, userHome).detect(), teams: store.listTeams() };
}

async function shareCommand(positionals: string[], options: Record<string, string | boolean>, store: AgentTracesStore) {
  const action = positionals[0] ?? "list";
  if (action === "list") return { shares: store.listShares() };
  if (action === "revoke") {
    const shareId = required(positionals[1] ?? options.id, "share ID");
    return store.setting("endpoint") && store.setting("cloud.access_token")
      ? cloudRequest(store, `/v1/shares/${encodeURIComponent(shareId)}/revoke`, "POST", {})
      : store.revokeShare(shareId);
  }
  const traceId = action === "create" ? required(positionals[1] ?? options.trace, "trace ID") : action;
  const spec = { traceId, content: (typeof options.content === "string" ? options.content : "overview") as never, audience: (typeof options.audience === "string" ? options.audience : "anyone_with_link") as never, emails: typeof options.emails === "string" ? options.emails.split(",") : undefined, teamId: typeof options.team === "string" ? options.team : undefined, agentRetrieve: options["agent-retrieve"] !== "false", allowContext: options["allow-context"] === true, allowSkillCreation: options["allow-skill"] === true, live: options.live === true, selectedEventIds: typeof options.events === "string" ? options.events.split(",") : undefined, expiresAt: typeof options.expires === "string" ? options.expires : undefined, maxViews: typeof options["max-views"] === "string" ? Number(options["max-views"]) : undefined };
  return store.setting("endpoint") && store.setting("cloud.access_token")
    ? cloudRequest(store, `/v1/traces/${encodeURIComponent(traceId)}/shares`, "POST", spec)
    : store.createShare(spec);
}

function summaryCommand(positionals: string[], options: Record<string, string | boolean>, store: AgentTracesStore) {
  const action = positionals[0] ?? "prepare";
  const traceId = required(positionals[1] ?? options.trace, "trace ID");
  if (action === "prepare") return store.prepareTraceEnrichment(traceId);
  if (action === "show") return store.getTraceEnrichment(traceId);
  if (action === "save") return store.cacheTraceEnrichment({
    traceId,
    title: required(options.title, "title"),
    summary: required(options.summary, "summary"),
    stages: typeof options.stages === "string" ? JSON.parse(options.stages) as never : [],
    outcome: (typeof options.outcome === "string" ? options.outcome : "unknown") as never,
    provider: "local_subscription",
    model: typeof options.model === "string" ? options.model : undefined,
    promptVersion: typeof options["prompt-version"] === "string" ? options["prompt-version"] : "trace-summary-v1",
  });
  throw new Error(`Unknown summarize action: ${action}`);
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

async function teamCommand(positionals: string[], options: Record<string, string | boolean>, store: AgentTracesStore) {
  const action = positionals[0] ?? "list";
  if (action === "list") return { teams: store.listTeams(), activeTeamId: store.setting("active_team_id") || null };
  if (action === "create") {
    const slug = required(positionals[1] ?? options.slug, "team slug"); const local = store.createTeam(slug);
    const defaultVisibility = (typeof options.visibility === "string" ? options.visibility : "private") as "private" | "team";
    const cloud = await cloudRequest(store, "/v1/teams", "POST", { slug, defaultVisibility }, false) as { id?: string } | null;
    if (cloud?.id) { store.setSetting(`cloud.team.map.${local.id}`, cloud.id); store.setSetting("cloud.active_namespace_id", cloud.id); }
    return { ...local, defaultVisibility, cloud };
  }
  if (action === "join") {
    const token = typeof options.token === "string" ? options.token : undefined;
    if (token && store.setting("endpoint") && store.setting("cloud.access_token")) {
      const joined = await cloudRequest(store, "/v1/setup-links/redeem", "POST", { token, email: typeof options.email === "string" ? options.email : undefined }) as { teamId?: string };
      if (joined.teamId) store.setSetting("cloud.active_namespace_id", joined.teamId); return joined;
    }
    return token ? store.redeemSetupLink(token, typeof options.email === "string" ? options.email : undefined) : store.joinTeam(required(positionals[1] ?? options.id, "team ID"), (typeof options.role === "string" ? options.role : "member") as never);
  }
  if (action === "use") {
    const localId = positionals[1] ?? (typeof options.id === "string" ? options.id : undefined); const local = store.useNamespace(localId);
    const cloudId = local.kind === "personal" ? store.setting("cloud.namespace_id") : store.setting(`cloud.team.map.${localId}`);
    if (cloudId) store.setSetting("cloud.active_namespace_id", cloudId); return { ...local, cloudNamespaceId: cloudId ?? null };
  }
  if (action === "policy") {
    const localId = required(positionals[1] ?? options.id, "team ID"); const visibility = required(options.visibility, "visibility") as "private" | "team";
    const local = store.setTeamPolicy(localId, visibility); const cloudId = store.setting(`cloud.team.map.${localId}`);
    const cloud = cloudId ? await cloudRequest(store, `/v1/teams/${encodeURIComponent(cloudId)}/policy`, "PATCH", { defaultVisibility: visibility }, false) : null;
    return { ...local, cloud };
  }
  if (action === "setup-link") {
    const subaction = positionals[1] ?? "list";
    const localTeamId = subaction === "revoke" ? undefined : required(positionals[2] ?? options.team, "team ID");
    const cloudTeamId = localTeamId ? store.setting(`cloud.team.map.${localTeamId}`) : undefined;
    const setupOptions = {
      email: typeof options.email === "string" ? options.email : undefined,
      domain: typeof options.domain === "string" ? options.domain : undefined,
      maxUses: typeof options["max-uses"] === "string" ? Number(options["max-uses"]) : undefined,
      expiresAt: typeof options.expires === "string" ? options.expires : undefined,
    };
    if (subaction === "create") return cloudTeamId ? cloudRequest(store, `/v1/teams/${encodeURIComponent(cloudTeamId)}/setup-links`, "POST", setupOptions) : store.createSetupLink(localTeamId!, setupOptions);
    if (subaction === "list") return cloudTeamId ? cloudRequest(store, `/v1/teams/${encodeURIComponent(cloudTeamId)}/setup-links`, "GET") : { setupLinks: store.listSetupLinks(localTeamId!) };
    if (subaction === "revoke") return store.setting("endpoint") && store.setting("cloud.access_token")
      ? cloudRequest(store, `/v1/setup-links/${encodeURIComponent(required(positionals[2] ?? options.id, "setup link ID"))}/revoke`, "POST", {})
      : store.revokeSetupLink(required(positionals[2] ?? options.id, "setup link ID"));
    throw new Error(`Unknown setup-link action: ${subaction}`);
  }
  if (action === "repository") {
    const subaction = positionals[1] ?? "list";
    const teamId = required(options.team ?? positionals[2], "team ID");
    const cloudTeamId = store.setting(`cloud.team.map.${teamId}`);
    if (subaction === "add") {
      const repository = required(options.repository ?? positionals[3], "repository");
      return cloudTeamId ? cloudRequest(store, `/v1/teams/${encodeURIComponent(cloudTeamId)}/repositories`, "POST", { repository }) : store.addTeamRepository(teamId, repository);
    }
    if (subaction === "list") return cloudTeamId ? cloudRequest(store, `/v1/teams/${encodeURIComponent(cloudTeamId)}/repositories`, "GET") : { repositories: store.listTeamRepositories(teamId) };
    throw new Error(`Unknown repository action: ${subaction}`);
  }
  if (action === "devices") {
    const teamId = required(positionals[1] ?? options.team, "team ID"); const cloudTeamId = store.setting(`cloud.team.map.${teamId}`);
    return cloudTeamId ? cloudRequest(store, `/v1/teams/${encodeURIComponent(cloudTeamId)}/devices`, "GET") : { devices: store.listTeamDevices(teamId) };
  }
  throw new Error(`Unknown team action: ${action}`);
}

async function cloudRequest(store: AgentTracesStore, path: string, method: string, payload?: unknown, requiredCloud = true) {
  const endpoint = store.setting("endpoint"); const token = store.setting("cloud.access_token");
  if (!endpoint || !token) { if (requiredCloud) throw new Error("Cloud endpoint and device access token are required"); return null; }
  const response = await fetch(`${endpoint.replace(/\/$/, "")}${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: method === "GET" || payload === undefined ? undefined : JSON.stringify(payload) });
  if (!response.ok) throw new Error(`Cloud request failed: ${response.status} ${await response.text()}`); return response.json();
}

async function githubCommand(positionals: string[], options: Record<string, string | boolean>, store: AgentTracesStore) {
  const action = positionals[0] ?? "status";
  if (action === "status") return { connected: Boolean(store.setting("github.installation_id")), installationId: store.setting("github.installation_id") ?? null };
  if (action === "connect") {
    const installationId = required(options.installation ?? positionals[1], "GitHub installation ID"); store.setSetting("github.installation_id", installationId);
    const localTeamId = typeof options.team === "string" ? options.team : undefined; const cloudTeamId = localTeamId ? store.setting(`cloud.team.map.${localTeamId}`) : undefined;
    const cloud = cloudTeamId ? await cloudRequest(store, `/v1/teams/${encodeURIComponent(cloudTeamId)}/github/installations`, "POST", { installationId, accountLogin: required(options.account, "GitHub account login"), permissions: { contents: "read", pull_requests: "read", metadata: "read" } }) : null;
    return { connected: true, installationId, cloud };
  }
  if (action === "disconnect") { store.setSetting("github.installation_id", ""); return { connected: false }; }
  throw new Error(`Unknown GitHub action: ${action}`);
}

function configCommand(positionals: string[], options: Record<string, string | boolean>, store: AgentTracesStore) {
  const action = positionals[0] ?? "list";
  const redact = (key: string, value: string | null | undefined) => value == null ? null : /token|secret|password|private[_-]?key/i.test(key) ? "<redacted>" : value;
  if (action === "list") return Object.fromEntries(Object.entries(store.settings()).map(([key, value]) => [key, redact(key, value == null ? null : String(value))]));
  if (action === "get") { const key = required(positionals[1], "key"); return { key, value: redact(key, store.setting(key)) }; }
  if (action === "set") { const key = required(positionals[1], "key"); const value = required(positionals[2] ?? options.value, "value"); store.setSetting(key, value); return { key, value: redact(key, value) }; }
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
