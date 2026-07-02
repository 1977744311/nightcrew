#!/usr/bin/env node
import { runCli } from "./program";

await runCli(["crew", ...process.argv.slice(2)]);
