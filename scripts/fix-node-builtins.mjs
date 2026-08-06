import { readFile, writeFile } from "node:fs/promises";

const path = process.argv[2];
if (!path) throw new Error("usage: fix-node-builtins.mjs <bundle>");
const source = await readFile(path, "utf8");
await writeFile(path, source.replaceAll('from "sqlite"', 'from "node:sqlite"'), "utf8");
