import { homedir } from "node:os";
import { resolve } from "node:path";

export interface RuntimePaths { home: string; database: string }

export function runtimePaths(override?: string): RuntimePaths {
  const home = resolve(override ?? process.env.AGENTTRACES_HOME ?? `${homedir()}/.agenttraces`);
  return { home, database: `${home}/agenttraces.db` };
}
