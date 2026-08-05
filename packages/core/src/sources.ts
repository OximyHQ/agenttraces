import type { SourceDefinition, SourceName } from "./contracts.js";

const home = "{home}";
const appData = "{appdata}";

export const SOURCE_DEFINITIONS: SourceDefinition[] = [
  {
    name: "claude_code",
    displayName: "Claude Code",
    detectPaths: [`${home}/.claude/projects`],
    globs: [
      { pattern: `${home}/.claude/projects/*/*.jsonl`, fileType: "session_transcript", readMode: "incremental" },
      { pattern: `${home}/.claude/projects/*/*/subagents/agent-*.jsonl`, fileType: "subagent_transcript", readMode: "incremental" },
      { pattern: `${home}/.claude/projects/*/sessions-index.json`, fileType: "session_index", readMode: "full" },
      { pattern: `${home}/.claude/history.jsonl`, fileType: "prompt_history", readMode: "incremental" },
      { pattern: `${home}/.claude/stats-cache.json`, fileType: "stats", readMode: "full" },
    ],
    sqlite: [],
  },
  {
    name: "cursor",
    displayName: "Cursor",
    detectPaths: [`${home}/.cursor`, `${appData}/Cursor/User`],
    globs: [
      { pattern: `${home}/.cursor/projects/*/agent-transcripts/*.json`, fileType: "agent_transcript", readMode: "full" },
      { pattern: `${home}/.cursor/projects/*/agent-transcripts/**/*.jsonl`, fileType: "agent_transcript", readMode: "incremental" },
    ],
    sqlite: [
      {
        path: `${appData}/Cursor/User/globalStorage/state.vscdb`,
        queries: [
          { fileType: "sqlite_composer", sql: "SELECT key, value, json_extract(value, '$.createdAt') AS _ts FROM cursorDiskKV WHERE key LIKE 'composerData:%' ORDER BY _ts", incrementalField: "_ts" },
          { fileType: "sqlite_bubble", sql: "SELECT rowid, key, value FROM cursorDiskKV WHERE key LIKE 'bubbleId:%' ORDER BY rowid", incrementalField: "rowid", dependsOn: "sqlite_composer" },
          { fileType: "sqlite_daily_stats", sql: "SELECT rowid, key, value FROM ItemTable WHERE key LIKE 'aiCodeTracking.dailyStats.%' ORDER BY rowid", incrementalField: "rowid" },
        ],
      },
      {
        path: `${appData}/Cursor/User/workspaceStorage/*/state.vscdb`,
        queries: [
          { fileType: "sqlite_composer", sql: "SELECT key, value, json_extract(value, '$.createdAt') AS _ts FROM cursorDiskKV WHERE key LIKE 'composerData:%' ORDER BY _ts", incrementalField: "_ts" },
          { fileType: "sqlite_bubble", sql: "SELECT rowid, key, value FROM cursorDiskKV WHERE key LIKE 'bubbleId:%' ORDER BY rowid", incrementalField: "rowid", dependsOn: "sqlite_composer" },
        ],
      },
      {
        path: `${home}/.cursor/ai-tracking/ai-code-tracking.db`,
        queries: [
          { fileType: "sqlite_code_tracking", sql: "SELECT * FROM ai_code_hashes ORDER BY createdAt", incrementalField: "createdAt" },
        ],
      },
    ],
  },
  {
    name: "codex",
    displayName: "Codex",
    detectPaths: [`${home}/.codex/sessions`],
    globs: [
      { pattern: `${home}/.codex/sessions/**/*.jsonl`, fileType: "session_transcript", readMode: "incremental" },
      { pattern: `${home}/.codex/history.jsonl`, fileType: "prompt_history", readMode: "incremental" },
      { pattern: `${home}/.codex/config.toml`, fileType: "config", readMode: "full", contentType: "text" },
    ],
    sqlite: [],
  },
  {
    name: "openclaw",
    displayName: "OpenClaw",
    detectPaths: [`${home}/.openclaw/agents`],
    globs: [
      { pattern: `${home}/.openclaw/agents/main/sessions/*.jsonl`, fileType: "session_transcript", readMode: "incremental", skipPatterns: ["*.deleted.*"] },
      { pattern: `${home}/.openclaw/agents/main/sessions/sessions.json`, fileType: "session_index", readMode: "full" },
      { pattern: `${home}/.openclaw/cron/runs/*.jsonl`, fileType: "cron_run", readMode: "incremental" },
      { pattern: `${home}/.openclaw/workspace/MEMORY.md`, fileType: "memory", readMode: "full", contentType: "text" },
    ],
    sqlite: [],
  },
  {
    name: "conductor",
    displayName: "Conductor",
    detectPaths: [`${appData}/com.conductor.app/conductor.db`],
    globs: [],
    sqlite: [
      {
        path: `${appData}/com.conductor.app/conductor.db`,
        queries: [
          { fileType: "sqlite_conductor_sessions", sql: "SELECT id, status, agent_type, title, model, workspace_id, created_at, updated_at FROM sessions ORDER BY updated_at", incrementalField: "updated_at" },
          { fileType: "sqlite_conductor_messages", sql: "SELECT id, session_id, role, content, model, turn_id, sent_at, created_at FROM session_messages ORDER BY created_at", incrementalField: "created_at", dependsOn: "sqlite_conductor_sessions" },
        ],
      },
    ],
  },
  {
    name: "antigravity",
    displayName: "Antigravity",
    detectPaths: [`${home}/.gemini/antigravity`],
    globs: [
      { pattern: `${home}/.gemini/antigravity/conversations/*.pb`, fileType: "conversation", readMode: "full", contentType: "binary" },
      { pattern: `${home}/.gemini/antigravity/**/brain/**/*.md`, fileType: "brain_artifact", readMode: "full", contentType: "text" },
      { pattern: `${home}/.gemini/antigravity/**/brain/**/*.metadata.json`, fileType: "brain_metadata", readMode: "full" },
      { pattern: `${home}/.gemini/antigravity/annotations/*.pbtxt`, fileType: "annotation", readMode: "full", contentType: "text" },
    ],
    sqlite: [],
  },
  {
    name: "copilot",
    displayName: "GitHub Copilot",
    detectPaths: [`${appData}/Code/User`],
    globs: [
      { pattern: `${appData}/Code/User/globalStorage/emptyWindowChatSessions/*.jsonl`, fileType: "copilot_session_events", readMode: "fold" },
      { pattern: `${appData}/Code/User/globalStorage/emptyWindowChatSessions/*.json`, fileType: "copilot_session_snapshot", readMode: "full" },
      { pattern: `${appData}/Code/User/workspaceStorage/*/workspace.json`, fileType: "copilot_workspace_folder", readMode: "full" },
      { pattern: `${appData}/Code/User/workspaceStorage/*/chatSessions/*.jsonl`, fileType: "copilot_workspace_session_events", readMode: "fold" },
      { pattern: `${appData}/Code/User/workspaceStorage/*/GitHub.copilot-chat/transcripts/*.jsonl`, fileType: "copilot_compact_transcript", readMode: "incremental" },
      { pattern: `${appData}/Code/User/workspaceStorage/*/GitHub.copilot-chat/debug-logs/*/main.jsonl`, fileType: "copilot_debug_log", readMode: "incremental" },
    ],
    sqlite: [
      { path: `${appData}/Code/User/globalStorage/state.vscdb`, queries: [{ fileType: "copilot_session_index", sql: "SELECT key, value FROM ItemTable WHERE key = 'chat.ChatSessionStore.index'" }] },
      { path: `${appData}/Code/User/workspaceStorage/*/state.vscdb`, queries: [{ fileType: "copilot_workspace_agent_cache", sql: "SELECT key, value FROM ItemTable WHERE key IN ('agentSessions.state.cache', 'agentSessions.model.cache', 'memento/interactive-session')" }] },
    ],
  },
];

export function sourceDefinition(name: SourceName): SourceDefinition {
  const definition = SOURCE_DEFINITIONS.find((item) => item.name === name);
  if (!definition) throw new Error(`Unknown source: ${name}`);
  return definition;
}

export function resolveSourcePath(template: string, userHome: string, platform = process.platform): string {
  const appDataPath = platform === "win32"
    ? `${userHome}/AppData/Roaming`
    : platform === "darwin" ? `${userHome}/Library/Application Support` : `${userHome}/.config`;
  return template.replaceAll("{home}", userHome).replaceAll("{appdata}", appDataPath);
}
