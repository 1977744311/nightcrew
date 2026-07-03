import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { configSchema } from "../src/config/schema.ts";

const outputUrl = new URL("../schema/config.schema.json", import.meta.url);
const outputPath = fileURLToPath(outputUrl);
const rootPath = fileURLToPath(new URL("../", import.meta.url));
const biomeBin = fileURLToPath(
  new URL(
    `../node_modules/.bin/biome${process.platform === "win32" ? ".cmd" : ""}`,
    import.meta.url,
  ),
);
const checkOnly = process.argv.includes("--check");

function generateConfigSchemaText() {
  const schema = z.toJSONSchema(configSchema, { target: "draft-07", io: "input" });
  return `${JSON.stringify(schema, null, 2)}\n`;
}

function formatJsonFile(file) {
  execFileSync(biomeBin, ["format", "--write", file], { cwd: rootPath, stdio: "pipe" });
}

const next = generateConfigSchemaText();
mkdirSync(dirname(outputPath), { recursive: true });

if (checkOnly) {
  const tempPath = fileURLToPath(
    new URL("../schema/.config.schema.generated.json", import.meta.url),
  );
  try {
    writeFileSync(tempPath, next, "utf8");
    formatJsonFile(tempPath);
    const current = readFileSync(outputPath, "utf8");
    const formattedNext = readFileSync(tempPath, "utf8");
    if (current !== formattedNext) {
      console.error("schema/config.schema.json is out of sync. Run `npm run schema`.");
      process.exit(1);
    }
  } finally {
    rmSync(tempPath, { force: true });
  }
  process.exit(0);
}

writeFileSync(outputPath, next, "utf8");
formatJsonFile(outputPath);
console.log("wrote schema/config.schema.json");
