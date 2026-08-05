#!/usr/bin/env node
import { AgentTracesStore, runtimePaths } from "@agenttraces/core";

const paths = runtimePaths(); const store = new AgentTracesStore(paths.database, paths.home);
const result = store.processPending(Number(process.env.AGENTTRACES_WORKER_BATCH_SIZE ?? 500));
console.log(JSON.stringify({ service: "agenttraces-worker", ...result }));
store.close();
