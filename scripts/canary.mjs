#!/usr/bin/env node
/**
 * Nightcrew's own canary: exercise every user-visible CLI command end-to-end
 * against the BUILT cli (dist/cli.js), the way an operator would, in a
 * disposable temp project with the fake provider. `--live` adds the paid
 * tier: a real `init --assist` pass (Codex structured outputs) plus a gh auth
 * probe. Run `npm run build` first; the repo's canary verify profile does.
 *
 * tests/canary-manifest.test.ts reconciles CANARY_COMMAND_COVERAGE against
 * the registered commander commands, so a new CLI command fails the test
 * suite until it is covered here.
 */
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const CANARY_COMMAND_COVERAGE = {
  init: "scaffolds .nightcrew/ in the demo repo (--root/--name)",
  doctor: "passes on the freshly scaffolded demo repo",
  run: "plan iteration, then execute iteration that lands on main",
  loop: "bounded loop (-n 1) finishes and reports",
  pause: "pauses the demo project (state.json paused=true)",
  resume: "resumes the demo project (state.json paused=false)",
  status: "prints project state",
  report: "morning digest parses as JSON (--json)",
  propose: "drafts a pending proposal via fake provider, then --ids lands it",
  console: "serves the board over HTTP and lists the demo project",
  gc: "cleans runtime artifacts",
  "plan add": "creates an active plan scaffold",
  "plan list": "lists the created plan",
  "plan show": "prints the created plan body",
  "crew start": "short-lived daemon run (--now) shuts down cleanly on SIGINT",
  "crew report": "aggregate digest parses as JSON (--json)",
  "crew status": "one-line status includes the demo project",
  "crew pause": "pauses by registered name",
  "crew resume": "resumes by registered name",
};

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = join(repoRoot, "dist", "cli.js");
const PLAN_ID = "2026-01-01-canary-hello";
const BACKLOG_ITEM = "Ship the hello feature";
const PROPOSAL_TITLE = "Canary follow-up item";

class CanaryFailure extends Error {}

function assert(condition, message, output) {
  if (!condition) {
    throw new CanaryFailure(output ? `${message}\n--- output ---\n${output}` : message);
  }
}

function git(cwd, ...args) {
  const result = spawnSync(
    "git",
    ["-c", "user.name=canary", "-c", "user.email=canary@nightcrew.local", ...args],
    { cwd, encoding: "utf8" },
  );
  assert(result.status === 0, `git ${args.join(" ")} failed`, result.stderr);
  return result.stdout;
}

function main() {
  const live = process.argv.includes("--live");
  assert(existsSync(CLI), `missing ${CLI}; run \`npm run build\` first`);

  const base = mkdtempSync(join(tmpdir(), "nightcrew-canary-"));
  const home = join(base, "home");
  const demo = join(base, "repo");
  mkdirSync(home, { recursive: true });
  mkdirSync(demo, { recursive: true });

  const env = { ...process.env, NIGHTCREW_HOME: home, NO_COLOR: "1" };
  const passed = [];
  const warned = [];

  const runCli = (args, { cwd = demo, timeoutMs = 120_000 } = {}) => {
    const result = spawnSync("node", [CLI, ...args], {
      cwd,
      env,
      encoding: "utf8",
      timeout: timeoutMs,
    });
    return {
      status: result.status,
      out: `${result.stdout ?? ""}${result.stderr ?? ""}`,
      stdout: result.stdout ?? "",
    };
  };

  const step = (name, fn) => {
    const startedAt = Date.now();
    fn();
    passed.push(name);
    console.log(`PASS ${name} (${Date.now() - startedAt}ms)`);
  };

  const planContents = (ticked) =>
    [
      "---",
      `id: ${PLAN_ID}`,
      "title: Canary hello",
      "created: 2026-01-01",
      "parallel: false",
      `backlog: ${JSON.stringify(BACKLOG_ITEM)}`,
      "---",
      "",
      "## Goal",
      "Deliver the canary hello feature.",
      "",
      "## Acceptance",
      `- [${ticked ? "x" : " "}] hello file exists`,
      "",
    ].join("\n");

  const setup = () => {
    git(demo, "init", "-b", "main");
    writeFileSync(join(demo, "README.md"), "# canary demo\n");
    git(demo, "add", "-A");
    git(demo, "commit", "-m", "initial product commit");
  };

  const scriptFile = join(base, "fake-script.json");
  const configureFakeProvider = () => {
    writeFileSync(
      scriptFile,
      JSON.stringify(
        [
          {
            match: "operation = \\*\\*plan\\*\\*",
            actions: [
              {
                type: "write",
                path: `.nightcrew/plans/active/${PLAN_ID}.md`,
                content: planContents(false),
              },
            ],
            finalMessage: "authored plan",
          },
          {
            match: "operation = \\*\\*execute\\*\\*",
            actions: [
              { type: "write", path: "src/hello.txt", content: "hello from the canary\n" },
              {
                type: "write",
                path: `.nightcrew/plans/active/${PLAN_ID}.md`,
                content: planContents(true),
              },
            ],
            finalMessage: "done. PLAN COMPLETE",
          },
          {
            match: "balanced:",
            requireOutputSchema: true,
            structuredOutput: {
              candidates: [
                {
                  title: PROPOSAL_TITLE,
                  body: `- [ ] ${PROPOSAL_TITLE}.\n      Keep the hello output friendly.\n      Covered by the hello smoke assertion.`,
                  rationale: "canary proposal flow",
                },
              ],
            },
          },
        ],
        null,
        2,
      ),
    );
    writeFileSync(
      join(demo, ".nightcrew", "config.yaml"),
      [
        "version: 1",
        "project:",
        "  name: canary-demo",
        "  baseBranch: main",
        "provider:",
        "  default: fake",
        "  fake:",
        `    script: ${JSON.stringify(scriptFile)}`,
        "bootstrap:",
        "  - name: noop",
        "    run: 'true'",
        "verify:",
        "  profile: default",
        "  profiles:",
        "    default:",
        "      steps:",
        "        - name: smoke",
        "          run: 'true'",
        "review:",
        "  mode: off",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(demo, ".nightcrew", "crew.md"),
      `# Crew Directives\n\n## Rules\n\n- keep it honest\n\n## BACKLOG\n\n- [ ] ${BACKLOG_ITEM}\n`,
    );
    git(demo, "add", "-A");
    git(demo, "commit", "-m", "adopt nightcrew with fake provider");
  };

  const readDemoState = () =>
    JSON.parse(readFileSync(join(demo, ".nightcrew", "runtime", "state.json"), "utf8"));

  const waitFor = async (probe, timeoutMs, what) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await probe()) return;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new CanaryFailure(`timed out waiting for ${what}`);
  };

  const runConsoleStep = async () => {
    const port = 4712 + Math.floor(Math.random() * 500);
    const child = spawn("node", [CLI, "console", "--port", String(port)], { env });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    try {
      let projects = [];
      await waitFor(
        async () => {
          try {
            const response = await fetch(`http://127.0.0.1:${port}/api/projects`);
            if (!response.ok) return false;
            projects = await response.json();
            return true;
          } catch {
            return false;
          }
        },
        8_000,
        `console on :${port} (output so far: ${output})`,
      );
      assert(
        projects.some((project) => project.name === "canary-demo"),
        "console must list the demo project",
        JSON.stringify(projects),
      );
      const page = await fetch(`http://127.0.0.1:${port}/`);
      assert(page.ok, "console homepage must serve");
    } finally {
      child.kill("SIGINT");
      await new Promise((resolve) => child.once("exit", resolve));
    }
  };

  const runCrewStartStep = async () => {
    const child = spawn("node", [CLI, "crew", "start", "--now", "--poll", "200"], { env });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    child.kill("SIGINT");
    const code = await new Promise((resolve) => child.once("exit", resolve));
    assert(code === 0, "crew start must shut down cleanly on SIGINT", output);
    assert(output.includes("iterations"), "crew start must report per-project iterations", output);
  };

  const runLiveTier = () => {
    const clone = join(base, "assist-clone");
    git(repoRoot, "clone", "--quiet", repoRoot, clone);
    rmSync(join(clone, ".nightcrew"), { recursive: true, force: true });

    const assist = runCli(["init", "--assist", "--root", clone], {
      cwd: clone,
      timeoutMs: 600_000,
    });
    assert(assist.status === 0, "live init --assist must succeed", assist.out);
    assert(assist.out.includes("Assisted init draft"), "assist draft header missing", assist.out);
    assert(assist.out.includes("Initial crew rules"), "assist crew rules missing", assist.out);
    assert(
      !existsSync(join(clone, ".nightcrew", "config.yaml")),
      "non-TTY assist must not write files",
    );

    const gh = spawnSync("gh", ["auth", "status"], { encoding: "utf8" });
    if (gh.error) {
      warned.push("gh not installed — PR merge mode unavailable on this machine");
    } else if (gh.status !== 0) {
      warned.push("gh auth status failed — PR merge mode would fail until `gh auth login`");
    }
  };

  return (async () => {
    try {
      setup();

      step("init", () => {
        const result = runCli(["init", "--name", "canary-demo", "--root", demo]);
        assert(result.status === 0, "init must exit 0", result.out);
        for (const file of ["config.yaml", "crew.md", "questions.md", "qa.md"]) {
          assert(existsSync(join(demo, ".nightcrew", file)), `init must create ${file}`);
        }
      });

      configureFakeProvider();

      step("doctor", () => {
        const result = runCli(["doctor", "--root", demo]);
        assert(result.status === 0, "doctor must pass on a fresh scaffold", result.out);
      });

      step("run", () => {
        const plan = runCli(["run", "--root", demo]);
        assert(plan.status === 0, "plan iteration must succeed", plan.out);
        assert(plan.out.includes("plan"), "first run must resolve to plan", plan.out);

        const execute = runCli(["run", "--root", demo]);
        assert(execute.status === 0, "execute iteration must succeed", execute.out);
        assert(execute.out.includes("merged"), "execute must merge onto base", execute.out);
        assert(
          readFileSync(join(demo, "src", "hello.txt"), "utf8").includes("hello from the canary"),
          "merged feature file must exist on main",
        );
        assert(
          readFileSync(join(demo, ".nightcrew", "crew.md"), "utf8").includes(
            `- [x] ${BACKLOG_ITEM}`,
          ),
          "backlog auto-checkoff must tick the covered item",
        );
      });

      step("plan add", () => {
        const result = runCli(["plan", "add", "Canary scaffold plan", "--root", demo]);
        assert(result.status === 0, "plan add must exit 0", result.out);
        assert(result.out.includes("created"), "plan add must print the created path", result.out);
      });

      const scaffoldPlanId = readdirSync(join(demo, ".nightcrew", "plans", "active"))
        .filter((name) => name.endsWith(".md"))
        .map((name) => name.replace(/\.md$/, ""))[0];
      assert(scaffoldPlanId, "plan add must leave an active plan file");

      step("plan list", () => {
        const result = runCli(["plan", "list", "--root", demo]);
        assert(result.status === 0, "plan list must exit 0", result.out);
        assert(result.out.includes("Canary scaffold plan"), "plan list must show it", result.out);
      });

      step("plan show", () => {
        const result = runCli(["plan", "show", scaffoldPlanId, "--root", demo]);
        assert(result.status === 0, "plan show must exit 0", result.out);
        assert(result.out.includes("Goal"), "plan show must print the body", result.out);
      });
      rmSync(join(demo, ".nightcrew", "plans", "active", `${scaffoldPlanId}.md`));

      step("status", () => {
        const result = runCli(["status", "--root", demo]);
        assert(result.status === 0, "status must exit 0", result.out);
      });

      step("report", () => {
        const result = runCli(["report", "--json", "--root", demo]);
        assert(result.status === 0, "report must exit 0", result.out);
        JSON.parse(result.stdout);
      });

      step("propose", () => {
        const draft = runCli(["propose", "Improve the hello feature", "--root", demo]);
        assert(draft.status === 0, "propose must exit 0", draft.out);
        assert(draft.out.includes(PROPOSAL_TITLE), "propose must print the candidate", draft.out);

        const land = runCli(["propose", "--ids", "1", "--root", demo]);
        assert(land.status === 0, "propose --ids must exit 0", land.out);
        assert(
          readFileSync(join(demo, ".nightcrew", "crew.md"), "utf8").includes(PROPOSAL_TITLE),
          "landed candidate must appear in the BACKLOG",
        );
      });

      step("loop", () => {
        const result = runCli(["loop", "-n", "1", "--root", demo]);
        assert(result.status === 0, "loop must exit 0", result.out);
        assert(result.out.includes("loop finished"), "loop must report completion", result.out);
      });

      step("pause", () => {
        const result = runCli(["pause", "--reason", "canary", "--root", demo]);
        assert(result.status === 0, "pause must exit 0", result.out);
        assert(readDemoState().paused === true, "state.json must record paused=true");
      });

      step("resume", () => {
        const result = runCli(["resume", "--root", demo]);
        assert(result.status === 0, "resume must exit 0", result.out);
        assert(readDemoState().paused === false, "state.json must record paused=false");
      });

      step("gc", () => {
        const result = runCli(["gc", "--root", demo]);
        assert(result.status === 0, "gc must exit 0", result.out);
      });

      await runConsoleStep();
      passed.push("console");
      console.log("PASS console");

      step("crew status", () => {
        const result = runCli(["crew", "status"]);
        assert(result.status === 0, "crew status must exit 0", result.out);
        assert(result.out.includes("canary-demo"), "crew status must list the project", result.out);
      });

      step("crew report", () => {
        const result = runCli(["crew", "report", "--json"]);
        assert(result.status === 0, "crew report must exit 0", result.out);
        JSON.parse(result.stdout);
      });

      step("crew pause", () => {
        const result = runCli(["crew", "pause", "canary-demo", "--reason", "canary"]);
        assert(result.status === 0, "crew pause must exit 0", result.out);
        assert(readDemoState().paused === true, "crew pause must persist");
      });

      step("crew resume", () => {
        const result = runCli(["crew", "resume", "canary-demo"]);
        assert(result.status === 0, "crew resume must exit 0", result.out);
        assert(readDemoState().paused === false, "crew resume must persist");
      });

      await runCrewStartStep();
      passed.push("crew start");
      console.log("PASS crew start");

      if (live) {
        step("live: init --assist + gh", runLiveTier);
      }

      for (const warning of warned) console.log(`WARN ${warning}`);
      console.log(
        `canary passed: ${passed.length} steps${live ? " (live tier included)" : " (offline only; use --live for the paid tier)"}`,
      );
      return 0;
    } catch (error) {
      console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  })();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
