import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { selectProposal } from "../src/cli/propose";
import type { NotifyPayload } from "../src/notify/webhook";
import { notifyWebhook } from "../src/notify/webhook";
import { writeProposalArtifact } from "../src/proposals/proposals";
import type { Reviewer } from "../src/review/types";
import { readState } from "../src/state/state";
import { makeTempProject, planFileContents, type TestProject } from "./helpers";

let project: TestProject | undefined;

afterEach(() => {
  vi.restoreAllMocks();
  project?.cleanup();
  project = undefined;
});

function captureFetch(): { posts: NotifyPayload[] } {
  const posts: NotifyPayload[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    posts.push(JSON.parse(String(init?.body)) as NotifyPayload);
    return { ok: true, status: 204 } as Response;
  });
  return { posts };
}

function planEntry(id: string, title: string) {
  return {
    match: "operation = \\*\\*plan\\*\\*",
    actions: [
      {
        type: "write" as const,
        path: `.nightcrew/plans/active/${id}.md`,
        content: planFileContents(id, title),
      },
    ],
  };
}

function proposalItem(title: string) {
  return {
    title,
    body: [
      `- [ ] ${title}.`,
      "      Keep the approval path deterministic.",
      "      Tests included.",
    ].join("\n"),
    rationale: "operator-approved candidate",
    lens: "balanced" as const,
  };
}

describe("notify webhooks", () => {
  it("posts a compact loop stop payload with project counts and console hint", async () => {
    project = await makeTempProject({
      notify: {
        webhook: "https://hooks.example.test/nightcrew",
        events: ["loop_stopped"],
      },
    });
    const { posts } = captureFetch();

    const result = await project.loop({ maxIterations: 0 });

    expect(result.stop?.reason).toBe("max_iterations");
    expect(posts).toEqual([
      {
        event: "loop_stopped",
        project: "demo",
        counts: {
          landed: 0,
          failed: 0,
          openQuestions: 0,
          pendingProposals: 0,
        },
        consoleUrl: "http://127.0.0.1:4711",
        reason: "max_iterations",
        detail: "0 iterations",
      },
    ]);
  });

  it("posts when a review escalation appends a new open question", async () => {
    project = await makeTempProject({
      notify: {
        webhook: "https://hooks.example.test/nightcrew",
        events: ["open_question"],
      },
    });
    project.setCrew(["Escalate plan review"]);
    project.setScript([planEntry("2026-07-03-escalate", "Escalate")]);
    const reviewer: Reviewer = {
      mode: "gate",
      reviewPlan: async () => ({
        point: "plan",
        verdict: "escalate",
        notes: "operator decision required",
        round: 1,
        mode: "gate",
      }),
      reviewMerge: async () => ({
        point: "merge",
        verdict: "approve",
        notes: "",
        round: 1,
        mode: "gate",
      }),
    };
    const { posts } = captureFetch();

    const record = await project.run({ operation: "plan", reviewer });

    expect(record.status).toBe("failed");
    expect(readState(project.ctx().paths).stop?.reason).toBe("review_escalated");
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      event: "open_question",
      project: "demo",
      question: 'plan review escalated for "Escalate": operator decision required',
      counts: {
        landed: 0,
        failed: 0,
        openQuestions: 1,
        pendingProposals: 0,
      },
      consoleUrl: "http://127.0.0.1:4711",
    });
  });

  it("posts after a pending proposal, including qa-sourced drafts, lands through selection", async () => {
    project = await makeTempProject({
      notify: {
        webhook: "https://hooks.example.test/nightcrew",
        events: ["proposal_landed"],
      },
    });
    const ctx = project.ctx();
    const artifact = writeProposalArtifact(ctx.paths, {
      goal: "approve a notification candidate",
      routingTier: "light",
      items: [proposalItem("Notify on proposal approval")],
      passes: [],
      source: "qa",
    });
    const { posts } = captureFetch();
    vi.spyOn(console, "log").mockImplementation(() => {});

    await selectProposal(ctx, "1", artifact.file);

    expect(existsSync(artifact.file)).toBe(false);
    expect(existsSync(join(ctx.paths.archivedProposalsDir, `${artifact.proposal.id}.json`))).toBe(
      true,
    );
    expect(posts).toEqual([
      {
        event: "proposal_landed",
        project: "demo",
        counts: {
          landed: 0,
          failed: 0,
          openQuestions: 0,
          pendingProposals: 0,
        },
        consoleUrl: "http://127.0.0.1:4711",
        proposalId: artifact.proposal.id,
        selectedItems: 1,
      },
    ]);
  });

  it("honors notify event filters", async () => {
    project = await makeTempProject({
      notify: {
        webhook: "https://hooks.example.test/nightcrew",
        events: ["open_question"],
      },
    });
    const post = vi.fn();

    const payload = await notifyWebhook(
      project.ctx(),
      { event: "proposal_landed", proposalId: "proposal-1", selectedItems: 1 },
      { post },
    );

    expect(payload).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  it("logs a warning without throwing when webhook delivery fails", async () => {
    project = await makeTempProject({
      notify: {
        webhook: "https://hooks.example.test/nightcrew",
        events: ["loop_stopped"],
      },
    });
    const warnings: string[] = [];

    await expect(
      notifyWebhook(
        project.ctx(),
        { event: "loop_stopped", reason: "operator", detail: "aborted" },
        {
          post: async () => {
            throw new Error("network down");
          },
          warn: (message) => warnings.push(message),
        },
      ),
    ).resolves.toBeNull();
    expect(warnings).toEqual(["demo: notify webhook loop_stopped failed: network down"]);
  });
});
