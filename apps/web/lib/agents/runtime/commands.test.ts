import { describe, expect, it } from "vitest";
import {
  agentSlashCommandQuery,
  buildAgentPromptCommand,
  mergeAgentSlashCommands,
  normalizeAgentSessionCommand,
} from "./commands";

const BUILTIN_COMMANDS = [
  {
    name: "new",
    description: "Start a new session",
    source: "builtin" as const,
  },
  {
    name: "compact",
    description: "Compact conversation context",
    source: "builtin" as const,
  },
  {
    name: "autocompact",
    description: "Toggle automatic context compaction",
    source: "builtin" as const,
  },
  {
    name: "name",
    description: "Set the session name",
    source: "builtin" as const,
  },
];

describe("agent slash commands", () => {
  it("merges adapter built-ins ahead of discovered commands", () => {
    expect(
      mergeAgentSlashCommands(BUILTIN_COMMANDS, [
        {
          name: "review",
          description: "Review changes",
          source: "prompt",
        },
        {
          name: "skill:docs",
          description: "Read the docs",
          source: "skill",
        },
        {
          name: "compact",
          description: "Conflicting extension",
          source: "extension",
        },
      ]),
    ).toEqual([
      expect.objectContaining({ name: "new", source: "builtin" }),
      expect.objectContaining({ name: "compact", source: "builtin" }),
      expect.objectContaining({ name: "autocompact", source: "builtin" }),
      expect.objectContaining({ name: "name", source: "builtin" }),
      expect.objectContaining({ name: "review", source: "prompt" }),
      expect.objectContaining({ name: "skill:docs", source: "skill" }),
    ]);
  });

  it("recognizes skill and duplicate-extension command names", () => {
    expect(agentSlashCommandQuery("/skill:docs")).toBe("skill:docs");
    expect(agentSlashCommandQuery("/review:2")).toBe("review:2");
    expect(agentSlashCommandQuery("/skill:docs extra")).toBeNull();
    expect(agentSlashCommandQuery("/etc/hosts")).toBeNull();
  });

  it("builds ordinary prompts without provider queue behavior", () => {
    expect(buildAgentPromptCommand("Next task")).toEqual({
      type: "prompt",
      message: "Next task",
    });
  });

  it("keeps attached images on the ordinary prompt path", () => {
    const image = {
      uploadId: "11111111-1111-4111-8111-111111111111",
      filename: "screen.png",
      mediaType: "image/png" as const,
    };
    const command = buildAgentPromptCommand("/new", [image]);

    expect(command).toEqual({
      type: "prompt",
      message: "/new",
      images: [image],
    });
    expect(normalizeAgentSessionCommand(command, {})).toBe(command);
  });

  it("routes Overtchat built-ins to native RPC commands", () => {
    expect(
      normalizeAgentSessionCommand({ type: "prompt", message: "/new" }, {}),
    ).toEqual({ type: "new_session" });
    expect(
      normalizeAgentSessionCommand(
        { type: "prompt", message: "/compact focus on tests" },
        {},
      ),
    ).toEqual({
      type: "compact",
      customInstructions: "focus on tests",
    });
    expect(
      normalizeAgentSessionCommand(
        { type: "prompt", message: "/name Release prep" },
        {},
      ),
    ).toEqual({
      type: "set_session_name",
      name: "Release prep",
    });
    expect(
      normalizeAgentSessionCommand(
        { type: "prompt", message: "/autocompact" },
        { autoCompactionEnabled: false },
      ),
    ).toEqual({
      type: "set_auto_compaction",
      enabled: true,
    });
    expect(
      normalizeAgentSessionCommand(
        { type: "prompt", message: "/autocompact off" },
        { autoCompactionEnabled: true },
      ),
    ).toEqual({
      type: "set_auto_compaction",
      enabled: false,
    });
  });

  it("leaves Pi-discovered commands on the prompt path", () => {
    const command = {
      type: "prompt" as const,
      message: "/skill:docs explain caching",
    };
    expect(normalizeAgentSessionCommand(command, {})).toBe(command);
  });

  it("preserves adapter-discovered commands", () => {
    const commands = mergeAgentSlashCommands(
      BUILTIN_COMMANDS.filter((command) => command.name !== "compact"),
      [
      {
        name: "compact",
        description: "Run OMP compaction",
        source: "builtin",
      },
      {
        name: "model",
        description: "Show the active model",
        source: "builtin",
      },
      ],
    );

    expect(commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "new" }),
        expect.objectContaining({ name: "autocompact" }),
        expect.objectContaining({
          name: "compact",
          description: "Run OMP compaction",
        }),
        expect.objectContaining({ name: "model" }),
      ]),
    );
    expect(
      normalizeAgentSessionCommand(
        { type: "prompt", message: "/compact focus on tests" },
        {},
      ),
    ).toEqual({
      type: "compact",
      customInstructions: "focus on tests",
    });
    expect(
      normalizeAgentSessionCommand(
        { type: "prompt", message: "/new" },
        {},
      ),
    ).toEqual({ type: "new_session" });
  });

  it("rejects malformed built-in invocations instead of prompting a model", () => {
    expect(() =>
      normalizeAgentSessionCommand(
        { type: "prompt", message: "/name" },
        {},
      ),
    ).toThrow("Usage: /name <name>");
    expect(() =>
      normalizeAgentSessionCommand(
        { type: "prompt", message: "/autocompact banana" },
        {},
      ),
    ).toThrow("Usage: /autocompact");
    expect(() =>
      normalizeAgentSessionCommand(
        { type: "prompt", message: "/new with arguments" },
        {},
      ),
    ).toThrow("Usage: /new");
  });
});
