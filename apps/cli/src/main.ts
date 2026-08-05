#!/usr/bin/env node
import { executeCli } from "./cli.js";

const result = await executeCli(process.argv.slice(2));
process.exitCode = result.code;
