import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    cli: "src/cli/nightcrew.ts",
    crew: "src/cli/crew.ts",
    index: "src/index.ts",
  },
  format: ["esm"],
  platform: "node",
  target: "node22",
  dts: { entry: { index: "src/index.ts" } },
  sourcemap: true,
  clean: true,
  splitting: true,
});
