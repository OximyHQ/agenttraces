#!/usr/bin/env node
import { cloudConfig, CloudRuntime } from "@agenttraces/cloud";
import { AgentTracesStore, runtimePaths } from "@agenttraces/core";

if (!process.env.DATABASE_URL) {
  const paths = runtimePaths(); const store = new AgentTracesStore(paths.database, paths.home);
  console.log(JSON.stringify({ service: "agenttraces-worker", ...store.processPending(Number(process.env.AGENTTRACES_WORKER_BATCH_SIZE ?? 500)) }));
  store.close();
} else {
  const runtime = new CloudRuntime(cloudConfig());
  await runtime.migrate();
  const worker = runtime.createWorker();
  worker.on("ready", () => console.log(JSON.stringify({ service: "agenttraces-worker", status: "ready" })));
  worker.on("completed", (job, result) => console.log(JSON.stringify({ jobId: job.id, status: "completed", result })));
  worker.on("failed", (job, error) => console.error(JSON.stringify({ jobId: job?.id, status: "failed", error: error.message })));
  const close = async () => { await worker.close(); await runtime.close(); process.exit(0); };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}
