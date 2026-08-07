import { existsSync } from "node:fs";
import { MCP_TOOLS, ParserRegistry, SOURCE_DEFINITIONS } from "../packages/core/src/index.js";

const required = [
  "apps/cli/src/main.ts", "apps/mcp/src/main.ts", "apps/api/src/main.ts", "apps/daemon/src/main.ts", "apps/worker/src/main.ts",
  "packages/core/src/collector.ts", "packages/core/src/store.ts", "packages/core/src/api.ts", "packages/core/src/mcp.ts",
  "packages/cloud/src/runtime.ts", "packages/cloud/src/schema.ts", "apps/web/app/page.tsx", "apps/web/app/dashboard/page.tsx",
  "apps/web/app/docs/page.tsx", "apps/web/app/api/auth/[...all]/route.ts", "LICENSE", "SECURITY.md", "CONTEXT.md",
  "docs/architecture.md", "docs/test-matrix.md", ".github/workflows/ci.yml",
];
const missing = required.filter((path) => !existsSync(path));
const inventory = new ParserRegistry().inventory();
const configuredFileTypes = new Set(SOURCE_DEFINITIONS.flatMap((source) => [...source.globs.map((glob) => `${source.name}:${glob.fileType}`), ...source.sqlite.flatMap((database) => database.queries.map((query) => `${source.name}:${query.fileType}`))])).size;
const report = {
  ready: missing.length === 0 && inventory.length === 7 && MCP_TOOLS.length === 12,
  components: required.length, missing, sources: inventory.length, configuredFileTypes, mcpTools: MCP_TOOLS.length,
  operationalInputs: ["npm publication", "cloud resource deployment", "production domain and region", "GitHub App registration", "OAuth credentials and secrets"],
};
console.log(JSON.stringify(report, null, 2)); if (!report.ready) process.exitCode = 1;
