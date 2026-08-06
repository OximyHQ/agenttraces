#!/usr/bin/env node
import { AgentTracesStore, runMcpStdio, runtimePaths } from "@agenttraces/core";

const paths = runtimePaths();
const store = new AgentTracesStore(paths.database, paths.home);
await runMcpStdio(store);
store.close();
