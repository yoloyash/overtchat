import { beforeEach, describe, expect, it, vi } from "vitest";


const mocks = vi.hoisted(() => ({
  executeOnHost: vi.fn(),
}));

vi.mock("@overtchat/agent-runtime/runtime/process", () => ({
  executeOnHost: mocks.executeOnHost,
}));

import {
  expandCodexCustomPrompt,
  listCodexCustomPrompts,
  parseCodexSkills,
  parseCodexSlashInvocation,
  skillInput,
} from "./commands";

describe("Codex commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps enabled app-server skills and ignores duplicates and disabled skills", () => {
    expect(
      parseCodexSkills({
        data: [
          {
            cwd: "/workspace",
            skills: [
              {
                name: "release-notes",
                path: "/workspace/.codex/skills/release-notes/SKILL.md",
                description: "Draft release notes",
                enabled: true,
              },
              {
                name: "disabled",
                path: "/tmp/disabled/SKILL.md",
                enabled: false,
              },
            ],
          },
          {
            cwd: "/workspace/subdir",
            skills: [
              {
                name: "release-notes",
                path: "/other/SKILL.md",
                enabled: true,
              },
            ],
          },
        ],
      }),
    ).toEqual([
      {
        name: "release-notes",
        path: "/workspace/.codex/skills/release-notes/SKILL.md",
        description: "Draft release notes",
        source: "skill",
      },
    ]);
  });

  it("loads and parses custom prompts on the configured host target", async () => {
    const record = (filePath: string, markdown: string) =>
      [
        "OVERTCHAT_PROMPT_PATH",
        Buffer.from(filePath).toString("hex"),
        "OVERTCHAT_PROMPT_BODY",
        Buffer.from(markdown).toString("hex"),
        "OVERTCHAT_PROMPT_END",
      ].join("\n");
    mocks.executeOnHost.mockResolvedValue({
      stdout: [
        record(
          "/home/yash/.codex/prompts/review.md",
          [
          "---",
          "description: Review this change",
          "argument-hint: <path>",
          "---",
          "Review $1 carefully.",
          ].join("\n"),
        ),
        record(
          "/home/yash/.codex/prompts/plain.md",
          "Summarize $ARGUMENTS.",
        ),
      ].join("\n"),
      stderr: "",
    });
    const target = {
      connectorId: "connector",
      transport: "ssh" as const,
      alias: "macbook",
    };

    await expect(listCodexCustomPrompts(target)).resolves.toEqual([
      {
        name: "prompts:plain",
        description: "Custom prompt",
        source: "prompt",
        template: "Summarize $ARGUMENTS.",
      },
      {
        name: "prompts:review",
        description: "Review this change",
        source: "prompt",
        argumentHint: "<path>",
        template: "Review $1 carefully.",
      },
    ]);
    expect(mocks.executeOnHost).toHaveBeenCalledWith(
      target,
      expect.objectContaining({
        command: "sh",
      }),
      {
        timeoutMs: 15_000,
        stdin: expect.stringContaining("CODEX_HOME"),
      },
    );
    const stdin = mocks.executeOnHost.mock.calls[0]?.[2]?.stdin;
    expect(stdin).toContain("OVERTCHAT_PROMPT_PATH");
    expect(stdin).toContain('od -An -tx1 -v "$file"');
  });

  it("parses invocations and expands Codex prompt arguments", () => {
    expect(parseCodexSlashInvocation("/prompts:review \"src/a b.ts\" mode=deep"))
      .toEqual({
        name: "prompts:review",
        arguments: '"src/a b.ts" mode=deep',
      });
    expect(
      expandCodexCustomPrompt(
        "File=$1 Mode=$mode All=$ARGUMENTS Dollar=$$",
        '"src/a b.ts" mode=deep',
      ),
    ).toBe(
      'File=src/a b.ts Mode=deep All="src/a b.ts" mode=deep Dollar=$',
    );
  });

  it("builds native structured skill input", () => {
    expect(
      skillInput(
        {
          name: "release-notes",
          description: "Draft release notes",
          source: "skill",
          path: "/skills/release-notes/SKILL.md",
        },
        "v1.2.3",
      ),
    ).toEqual([
      {
        type: "skill",
        name: "release-notes",
        path: "/skills/release-notes/SKILL.md",
      },
      {
        type: "text",
        text: "$release-notes v1.2.3",
        text_elements: [],
      },
    ]);
  });
});
