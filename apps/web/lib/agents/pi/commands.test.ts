import { describe, expect, it } from "vitest";
import {
  buildAgentPromptCommand,
  mergeAgentSlashCommands,
  mergePiSlashCommands,
  normalizeAgentSessionCommand,
  normalizePiSessionCommand,
  piSlashCommandQuery,
} from "./commands";

describe("Pi slash commands", () => {
  it("merges Overtchat built-ins ahead of discovered Pi commands", () => {
    expect(
      mergePiSlashCommands([
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
    expect(piSlashCommandQuery("/skill:docs")).toBe("skill:docs");
    expect(piSlashCommandQuery("/review:2")).toBe("review:2");
    expect(piSlashCommandQuery("/skill:docs extra")).toBeNull();
    expect(piSlashCommandQuery("/etc/hosts")).toBeNull();
  });

  it("queues ordinary prompts while preserving explicit steering", () => {
    expect(buildAgentPromptCommand("Next task", false)).toEqual({
      type: "prompt",
      message: "Next task",
    });
    expect(buildAgentPromptCommand("Next task", true)).toEqual({
      type: "prompt",
      message: "Next task",
      streamingBehavior: "followUp",
    });
    expect(
      buildAgentPromptCommand("Change direction", true, "steer"),
    ).toEqual({
      type: "prompt",
      message: "Change direction",
      streamingBehavior: "steer",
    });
  });

  it("routes Overtchat built-ins to native RPC commands", () => {
    expect(
      normalizePiSessionCommand(
        { type: "prompt", message: "/new" },
        {},
      ),
    ).toEqual({ type: "new_session" });
    expect(
      normalizePiSessionCommand(
        { type: "prompt", message: "/compact focus on tests" },
        {},
      ),
    ).toEqual({
      type: "compact",
      customInstructions: "focus on tests",
    });
    expect(
      normalizePiSessionCommand(
        { type: "prompt", message: "/name Release prep" },
        {},
      ),
    ).toEqual({
      type: "set_session_name",
      name: "Release prep",
    });
    expect(
      normalizePiSessionCommand(
        { type: "prompt", message: "/autocompact" },
        { autoCompactionEnabled: false },
      ),
    ).toEqual({
      type: "set_auto_compaction",
      enabled: true,
    });
    expect(
      normalizePiSessionCommand(
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
    expect(normalizePiSessionCommand(command, {})).toBe(command);
  });

  it("keeps OMP compact native while retaining OvertChat session controls", () => {
    const commands = mergeAgentSlashCommands("omp", [
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
    ]);

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
        "omp",
        { type: "prompt", message: "/compact focus on tests" },
        {},
      ),
    ).toEqual({
      type: "prompt",
      message: "/compact focus on tests",
    });
    expect(
      normalizeAgentSessionCommand(
        "omp",
        { type: "prompt", message: "/new" },
        {},
      ),
    ).toEqual({ type: "new_session" });
  });

  it("rejects malformed built-in invocations instead of prompting a model", () => {
    expect(() =>
      normalizePiSessionCommand({ type: "prompt", message: "/name" }, {}),
    ).toThrow("Usage: /name <name>");
    expect(() =>
      normalizePiSessionCommand(
        { type: "prompt", message: "/autocompact banana" },
        {},
      ),
    ).toThrow("Usage: /autocompact");
    expect(() =>
      normalizePiSessionCommand(
        { type: "prompt", message: "/new with arguments" },
        {},
      ),
    ).toThrow("Usage: /new");
  });
});
