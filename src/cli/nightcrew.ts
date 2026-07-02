#!/usr/bin/env node
import { runCli } from "./program";

await runCli(process.argv.slice(2));
