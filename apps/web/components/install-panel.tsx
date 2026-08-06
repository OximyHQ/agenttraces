"use client";

import { useRef, useState } from "react";
import { tabKeyIndex } from "@/lib/tabs";

const choices = {
  prompt: { label: "Ask your agent", command: "Install AgentTraces for this machine, run its doctor checks, and tell me exactly what will be captured before enabling it." },
  terminal: { label: "Run in terminal", command: "npx agenttraces up" },
  mcp: { label: "MCP only", command: "npx agenttraces mcp" },
} as const;

export function InstallPanel() {
  const [choice, setChoice] = useState<keyof typeof choices>("prompt"); const [copied, setCopied] = useState(false);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]); const keys = Object.keys(choices) as Array<keyof typeof choices>;
  async function copy() { await navigator.clipboard.writeText(choices[choice].command); setCopied(true); window.setTimeout(() => setCopied(false), 1300); }
  function select(next: number) { const key = keys[next]!; setChoice(key); setCopied(false); tabs.current[next]?.focus(); }
  return <div className="install-panel"><div className="setup-tabs" role="tablist" aria-label="Installation method">{Object.entries(choices).map(([key, item], index) => <button id={`install-tab-${key}`} aria-controls={`install-panel-${key}`} tabIndex={choice === key ? 0 : -1} ref={(node) => { tabs.current[index] = node; }} key={key} role="tab" aria-selected={choice === key} onKeyDown={(event) => { const next = tabKeyIndex(index, keys.length, event.key); if (next != null) { event.preventDefault(); select(next); } }} onClick={() => { setChoice(key as keyof typeof choices); setCopied(false); }}>{item.label}</button>)}</div><div className="setup-panel" id={`install-panel-${choice}`} role="tabpanel" aria-labelledby={`install-tab-${choice}`}><div className="command-row"><code>{choices[choice].command}</code><button onClick={copy} type="button">{copied ? "Copied" : "Copy"}</button></div><p>{choice === "prompt" ? "Best for agent-first setup. Your agent can inspect the install, explain disclosure, and run verification." : choice === "terminal" ? "Detect supported local agents, install their MCP configuration, and begin capturing new sessions." : "Run the stdio server directly when collection is already configured."}</p></div></div>;
}
