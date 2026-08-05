#!/usr/bin/env node
import { AgentTracesStore, createAgentTracesApi, listen, runtimePaths } from "@agenttraces/core";

const paths = runtimePaths(); const store = new AgentTracesStore(paths.database, paths.home); const server = createAgentTracesApi(store, { queryToken: process.env.AGENTTRACES_QUERY_TOKEN, workerToken: process.env.AGENTTRACES_WORKER_TOKEN });
const address = await listen(server, Number(process.env.PORT ?? 4318), process.env.HOST ?? "127.0.0.1");
console.log(JSON.stringify({ service: "agenttraces-api", ...address }));
const close = () => server.close(() => { store.close(); process.exit(0); });
process.once("SIGINT", close); process.once("SIGTERM", close);
