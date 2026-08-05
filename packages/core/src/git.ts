import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

function git(cwd: string, args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

export interface GitSnapshot {
  repositoryRoot: string;
  remote?: string;
  branch?: string;
  head: string;
  dirtyPaths: string[];
  commits: string[];
}

export function inspectGit(cwd = process.cwd()): GitSnapshot | null {
  if (!existsSync(resolve(cwd))) return null;
  try {
    const repositoryRoot = git(cwd, ["rev-parse", "--show-toplevel"]);
    const remote = git(repositoryRoot, ["remote", "get-url", "origin"]) || undefined;
    const branch = git(repositoryRoot, ["branch", "--show-current"]) || undefined;
    const head = git(repositoryRoot, ["rev-parse", "HEAD"]);
    const dirtyPaths = git(repositoryRoot, ["status", "--porcelain=v1"]).split("\n").filter(Boolean).map((line) => line.slice(3));
    const commits = git(repositoryRoot, ["log", "-5", "--format=%H"]).split("\n").filter(Boolean);
    return { repositoryRoot, remote, branch, head, dirtyPaths, commits };
  } catch {
    return null;
  }
}

export function canonicalRepository(remote?: string) {
  if (!remote) return undefined;
  return remote.replace(/^git@github\.com:/, "https://github.com/").replace(/\.git$/, "");
}
