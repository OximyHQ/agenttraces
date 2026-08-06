#!/usr/bin/env node
import { cloudConfig, CloudRuntime, createCloudApi } from "@agenttraces/cloud";

const runtime = new CloudRuntime(cloudConfig());
await runtime.migrate();
const server = createCloudApi(runtime);
const port = Number(process.env.PORT ?? 4318);
server.listen(port, process.env.HOST ?? "0.0.0.0", () => console.log(JSON.stringify({ service: "agenttraces-api", port })));
const close = () => server.close(async () => { await runtime.close(); process.exit(0); });
process.once("SIGINT", close);
process.once("SIGTERM", close);
