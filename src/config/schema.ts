import { z } from "zod";

/**
 * Schema for `.nightcrew/config.yaml`. Strict objects everywhere: a typo in an
 * operator's config must fail loudly at load time, not silently no-op at 3am.
 */

const TIME_WINDOW_RE = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;

export const commandStepSchema = z.strictObject({
  name: z.string().min(1),
  run: z.string().min(1),
  timeoutMs: z.number().int().positive().default(600_000),
});
export type CommandStep = z.infer<typeof commandStepSchema>;

export const verifyProfileSchema = z.strictObject({
  steps: z.array(commandStepSchema).default([]),
});
export type VerifyProfile = z.infer<typeof verifyProfileSchema>;

const tierSchema = z.enum(["light", "heavy"]);

export const configSchema = z.strictObject({
  version: z.literal(1).default(1),
  project: z.strictObject({
    name: z.string().min(1),
    /** Defaults to the branch checked out when the loop starts. */
    baseBranch: z.string().min(1).optional(),
  }),
  provider: z
    .strictObject({
      default: z.enum(["codex", "fake"]).default("codex"),
      codex: z
        .strictObject({
          /** Model per tier. Unset tiers fall through to the Codex default model. */
          tiers: z
            .strictObject({
              light: z.string().optional(),
              heavy: z.string().optional(),
            })
            .default({}),
          sandbox: z
            .enum(["read-only", "workspace-write", "danger-full-access"])
            .default("workspace-write"),
          /** Whether the agent itself may reach the network (bootstrap steps always can). */
          networkAccess: z.boolean().default(false),
        })
        .default({ tiers: {}, sandbox: "workspace-write", networkAccess: false }),
      /** Test-only adapter. `script` points to a JSON script file. */
      fake: z.strictObject({ script: z.string().min(1) }).optional(),
    })
    .default({
      default: "codex",
      codex: { tiers: {}, sandbox: "workspace-write", networkAccess: false },
    }),
  routing: z
    .strictObject({
      plan: tierSchema.default("light"),
      execute: tierSchema.default("heavy"),
      repair: tierSchema.default("heavy"),
      garden: tierSchema.default("light"),
      review: tierSchema.default("light"),
      propose: tierSchema.default("light"),
    })
    .default({
      plan: "light",
      execute: "heavy",
      repair: "heavy",
      garden: "light",
      review: "light",
      propose: "light",
    }),
  /** Run once when a plan worktree is created (e.g. install dependencies). */
  bootstrap: z.array(commandStepSchema).default([]),
  verify: z
    .strictObject({
      profile: z.string().default("default"),
      profiles: z.record(z.string(), verifyProfileSchema).default({ default: { steps: [] } }),
    })
    .default({ profile: "default", profiles: { default: { steps: [] } } }),
  loop: z
    .strictObject({
      maxIterations: z.number().int().positive().default(20),
      maxFailureStreak: z.number().int().positive().default(3),
      maxNoCommitStreak: z.number().int().positive().default(3),
      maxControlOnlyStreak: z.number().int().positive().default(3),
      /** Force a garden pass every N iterations. */
      gardenEvery: z.number().int().positive().default(8),
      backoffMs: z.array(z.number().int().nonnegative()).default([5_000, 30_000, 120_000]),
      iterationTimeoutMs: z.number().int().positive().default(3_600_000),
      /** Abort when the provider emits no events for this long. */
      idleTimeoutMs: z.number().int().positive().default(600_000),
      /** Concurrent worktrees for plans marked `parallel: true`. */
      maxParallelPlans: z.number().int().positive().default(2),
    })
    .default({
      maxIterations: 20,
      maxFailureStreak: 3,
      maxNoCommitStreak: 3,
      maxControlOnlyStreak: 3,
      gardenEvery: 8,
      backoffMs: [5_000, 30_000, 120_000],
      iterationTimeoutMs: 3_600_000,
      idleTimeoutMs: 600_000,
      maxParallelPlans: 2,
    }),
  review: z
    .strictObject({
      mode: z.enum(["off", "advisory", "gate"]).default("advisory"),
      planReview: z.boolean().default(true),
      mergeReview: z.boolean().default(true),
      maxReviewRounds: z.number().int().positive().default(2),
    })
    .default({ mode: "advisory", planReview: true, mergeReview: true, maxReviewRounds: 2 }),
  budget: z
    .strictObject({
      /** Provider quota window; quota_exhausted schedules resume on this cadence. */
      quotaWindowHours: z.number().positive().default(5),
      maxTokensPerIteration: z.number().int().positive().optional(),
    })
    .default({ quotaWindowHours: 5 }),
  merge: z
    .strictObject({
      /** auto: merge into base when gates are green. branch: leave the branch. */
      policy: z.enum(["auto", "branch"]).default("auto"),
    })
    .default({ policy: "auto" }),
  /** Paths (repo-relative) the agent must never modify. `.git` is always protected. */
  protectedPaths: z
    .array(z.string().min(1))
    .default([".nightcrew/config.yaml", ".nightcrew/crew.md"]),
  schedule: z
    .strictObject({
      /** "HH:MM-HH:MM" local-time windows; may wrap midnight. Empty = always on. */
      windows: z.array(z.string().regex(TIME_WINDOW_RE)).default([]),
      /** Days of week (0 = Sunday) the windows apply to. Unset = every day. */
      days: z.array(z.number().int().min(0).max(6)).optional(),
      /** How long the daemon naps after an idle stop before re-checking the BACKLOG. */
      idleCooldownMs: z.number().int().positive().default(300_000),
    })
    .default({ windows: [], idleCooldownMs: 300_000 }),
});

export type NightcrewConfig = z.infer<typeof configSchema>;
export type NightcrewConfigInput = z.input<typeof configSchema>;
