#!/usr/bin/env node
import { createInterface } from "node:readline";
import { AgentTracesMcp, AgentTracesStore, handleMcpMessage, runtimePaths, type JsonRpcRequest } from "@agenttraces/core";

const paths = runtimePaths(); const store = new AgentTracesStore(paths.database, paths.home); const server = new AgentTracesMcp(store);
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  try {
    const response = handleMcpMessage(server, JSON.parse(line) as JsonRpcRequest);
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: error instanceof Error ? error.message : String(error) } })}\n`);
  }
});
const close = () => { store.close(); process.exit(0); };
process.once("SIGINT", close); process.once("SIGTERM", close);
