import { existsSync } from "node:fs";
import { MCP_TOOLS, ParserRegistry, SOURCE_DEFINITIONS } from "../packages/core/src/index.js";

const required = [
  "apps/cli/src/main.ts", "apps/mcp/src/main.ts", "apps/api/src/main.ts", "apps/daemon/src/main.ts", "apps/worker/src/main.ts",
  "packages/core/src/collector.ts", "packages/core/src/store.ts", "packages/core/src/api.ts", "packages/core/src/mcp.ts",
  "docs/architecture.md", "docs/test-matrix.md", ".github/workflows/ci.yml",
];
const missing = required.filter((path) => !existsSync(path));
const inventory = new ParserRegistry().inventory();
const configuredFileTypes = new Set(SOURCE_DEFINITIONS.flatMap((source) => [...source.globs.map((glob) => `${source.name}:${glob.fileType}`), ...source.sqlite.flatMap((database) => database.queries.map((query) => `${source.name}:${query.fileType}`))])).size;
const report = {
  ready: missing.length === 0 && inventory.length === 7 && MCP_TOOLS.length === 10,
  components: required.length, missing, sources: inventory.length, configuredFileTypes, mcpTools: MCP_TOOLS.length,
  deferredByDecision: ["npm publication", "Railway deployment", "production domain/provider/region", "final website/dashboard visual design"],
};
console.log(JSON.stringify(report, null, 2)); if (!report.ready) process.exitCode = 1;
