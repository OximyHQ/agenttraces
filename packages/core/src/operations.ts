import type { OperationKind } from "./contracts.js";

const normalized = (value?: string) => (value ?? "").trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, "_");

export function inferOperationKind(toolName?: string, command?: string): OperationKind {
  const name = normalized(toolName);
  if (["read", "read_file", "view_file", "view_image"].includes(name)) return "file_read";
  if (["write", "write_file", "create_file"].includes(name)) return "file_write";
  if (["edit", "edit_file", "apply_patch", "multi_edit"].includes(name)) return "file_edit";
  if (["grep", "glob", "search_files", "code_search", "rg"].includes(name)) return "repository_search";
  if (["bash", "shell", "terminal", "run_command", "exec_command", "write_stdin"].some((candidate) => name === candidate || name.endsWith(`_${candidate}`))) {
    return /(^|\s)(pnpm|npm|yarn|bun|pytest|cargo|go)\s+(run\s+)?test|\b(test|vitest|jest)\b/i.test(command ?? "") ? "test_run" : "command_run";
  }
  if (name.includes("test")) return "test_run";
  if (["web_search", "search_query", "image_query"].some((candidate) => name === candidate || name.endsWith(`_${candidate}`))) return "web_search";
  if (["web_fetch", "open", "click", "find", "screenshot", "browser"].includes(name)) return "web_fetch";
  if (name.includes("mcp") || name.startsWith("mcp__")) return "mcp_call";
  if (["agent", "spawn_agent", "task", "delegate"].some((candidate) => name === candidate || name.endsWith(`_${candidate}`))) return "agent_spawn";
  if (["send_message", "followup_task"].some((candidate) => name === candidate || name.endsWith(`_${candidate}`))) return "agent_message";
  if (["wait_agent", "join_agent", "agent_result"].some((candidate) => name === candidate || name.endsWith(`_${candidate}`))) return "agent_complete";
  if (["git_status", "status"].includes(name)) return "git_status";
  if (["git_commit", "commit"].includes(name)) return "git_commit";
  if (["git_push", "push"].includes(name)) return "git_push";
  return "generic_tool";
}

export function operationLabel(kind: OperationKind, purpose?: string, toolName?: string): string {
  if (purpose?.trim()) return purpose.trim();
  const object = toolName?.trim() || "tool";
  const verbs: Record<OperationKind, string> = {
    file_read: "Read",
    file_write: "Wrote",
    file_edit: "Edited",
    repository_search: "Searched",
    command_run: "Ran",
    test_run: "Tested",
    web_search: "Searched the web",
    web_fetch: "Opened",
    mcp_call: "Called",
    agent_spawn: "Started sub-agent",
    agent_message: "Messaged sub-agent",
    agent_complete: "Completed sub-agent",
    git_status: "Checked Git status",
    git_commit: "Committed",
    git_push: "Pushed",
    generic_tool: "Used",
  };
  return `${verbs[kind]} ${object}`;
}
