#!/usr/bin/env node
import { homedir } from "node:os";
import { AgentTracesDaemon, AgentTracesStore, runtimePaths } from "@agenttraces/core";

const paths = runtimePaths(); const store = new AgentTracesStore(paths.database, paths.home); const daemon = new AgentTracesDaemon(store, homedir());
const endpoint = process.env.AGENTTRACES_ENDPOINT;
if (process.argv.includes("--once") || process.env.AGENTTRACES_ONCE === "true") {
  const result = endpoint ? await daemon.upload(endpoint) : daemon.runOnce(); console.log(JSON.stringify(result)); store.close();
} else {
  const controller = new AbortController();
  const stop = () => { daemon.stop(); controller.abort(); };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  await daemon.runLoop({ endpoint, signal: controller.signal, intervalMs: Number(process.env.AGENTTRACES_INTERVAL_MS ?? 5_000), onCycle: (result) => console.log(JSON.stringify(result)) });
  store.close();
}
