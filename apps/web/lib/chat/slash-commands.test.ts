import { describe, expect, it } from "vitest";
import {
  filterSlashCommandModels,
  filterSlashCommands,
  groupSlashCommands,
  isSlashCommandAvailable,
  parseSlashCommandQuery,
  replaceSlashCommandSpan,
  resolveSlashCommand,
  type SlashCommand,
} from "@/lib/chat/slash-commands";

const Icon = () => null;

function command(
  name: string,
  overrides: Partial<SlashCommand> = {},
): SlashCommand {
  return {
    name,
    title: `/${name}`,
    description: "",
    group: "actions",
    icon: Icon,
    ...overrides,
  };
}

const COMMANDS: SlashCommand[] = [
  command("search", { keywords: ["web"] }),
  command("attach", { keywords: ["file", "upload"] }),
  command("dictate", { keywords: ["voice"] }),
  command("temporary", { keywords: ["incognito"] }),
  command("model", { submenu: "model" }),
  command("new", { group: "navigate" }),
  command("chats", { group: "navigate" }),
  command("settings", { group: "navigate" }),
];

describe("parseSlashCommandQuery", () => {
  it("parses a bare slash as an empty query", () => {
    expect(parseSlashCommandQuery("/")).toEqual({
      name: "",
      argument: "",
      hasArgument: false,
      start: 0,
      end: 1,
      inline: false,
    });
  });

  it("parses a partial command name", () => {
    expect(parseSlashCommandQuery("/sea")).toMatchObject({
      name: "sea",
      argument: "",
      hasArgument: false,
      inline: false,
    });
  });

  it("lowercases the command name so matching is case-insensitive", () => {
    expect(parseSlashCommandQuery("/Model")?.name).toBe("model");
  });

  it("splits an argument off the command name", () => {
    expect(parseSlashCommandQuery("/model gpt-5")).toEqual({
      name: "model",
      argument: "gpt-5",
      hasArgument: true,
      start: 0,
      end: 12,
      inline: false,
    });
  });

  it("preserves argument case and inner spacing", () => {
    expect(parseSlashCommandQuery("/model  GPT 5 Pro")?.argument).toBe(
      "GPT 5 Pro",
    );
  });

  it("reports a trailing space as an empty argument", () => {
    expect(parseSlashCommandQuery("/model ")).toMatchObject({
      name: "model",
      argument: "",
      hasArgument: true,
    });
  });

  it("tolerates leading whitespace from a paste", () => {
    expect(parseSlashCommandQuery("  /search")).toMatchObject({
      name: "search",
      start: 2,
      end: 9,
    });
  });

  it("returns null for prose that merely contains a slash", () => {
    expect(parseSlashCommandQuery("what lives in /etc/hosts?")).toBeNull();
    expect(parseSlashCommandQuery("Read /etc/hosts")).toBeNull();
  });

  it("returns null once the draft is no longer a command", () => {
    // A path is a single token but has a slash inside the name.
    expect(parseSlashCommandQuery("/etc/hosts")).toBeNull();
    expect(parseSlashCommandQuery("")).toBeNull();
    expect(parseSlashCommandQuery("hello")).toBeNull();
  });

  it("returns null for a multi-line draft without a caret", () => {
    expect(parseSlashCommandQuery("/search\nsecond line")).toBeNull();
    expect(parseSlashCommandQuery("/search extra\nmore")).toBeNull();
  });

  describe("inline form", () => {
    const parse = (value: string, caret = value.length) =>
      parseSlashCommandQuery(value, { caret, argumentNames: ["model"] });

    it("reads the slash word ending at the caret", () => {
      expect(parse("find me /sea")).toEqual({
        name: "sea",
        argument: "",
        hasArgument: false,
        start: 8,
        end: 12,
        inline: true,
      });
    });

    it("opens on a bare slash after a space", () => {
      expect(parse("i want you to /")).toMatchObject({
        name: "",
        start: 14,
        end: 15,
        inline: true,
      });
    });

    it("accepts a newline as the word boundary", () => {
      expect(parse("line one\n/search")).toMatchObject({
        name: "search",
        start: 9,
        inline: true,
      });
    });

    it("uses the caret, not the end of the draft", () => {
      expect(parse("find me /sea please", 12)).toMatchObject({
        name: "sea",
        start: 8,
        end: 12,
      });
      expect(parse("find me /sea please")).toBeNull();
    });

    it("ignores a slash inside a word", () => {
      expect(parse("check /etc/hosts")).toBeNull();
      expect(parse("and/or")).toBeNull();
      expect(parse("ratio 5/3")).toBeNull();
      expect(parse("see https://example.com")).toBeNull();
    });

    it("treats an inline token followed by a space as prose", () => {
      expect(parse("use /new to start")).toBeNull();
      expect(parse("see /search ")).toBeNull();
    });

    it("keeps an argument for a submenu command", () => {
      expect(parse("hi /model gpt 5")).toEqual({
        name: "model",
        argument: "gpt 5",
        hasArgument: true,
        start: 3,
        end: 15,
        inline: true,
      });
    });

    it("skips a path after the submenu argument boundary", () => {
      expect(parse("hi /model gpt/5")?.argument).toBe("gpt/5");
    });

    it("ends the token at a newline", () => {
      expect(parse("hi /model\nmore")).toBeNull();
    });

    it("prefers the whole-draft form when both apply", () => {
      expect(parse("/search")?.inline).toBe(false);
      expect(parse("/model gpt", 6)?.inline).toBe(false);
    });

    it("needs a caret to apply", () => {
      expect(parseSlashCommandQuery("find me /sea")).toBeNull();
    });
  });
});

describe("replaceSlashCommandSpan", () => {
  it("splices an inline token out and keeps one surrounding space", () => {
    expect(
      replaceSlashCommandSpan("find me /search please", { start: 8, end: 15 }, ""),
    ).toEqual({ value: "find me please", caret: 8 });
  });

  it("drops the token at the end of a sentence", () => {
    expect(
      replaceSlashCommandSpan("find me /search", { start: 8, end: 15 }, ""),
    ).toEqual({ value: "find me ", caret: 8 });
  });

  it("leaves the argument when a whole-draft command runs", () => {
    expect(
      replaceSlashCommandSpan("/search what's new", { start: 0, end: 18 }, "what's new"),
    ).toEqual({ value: "what's new", caret: 10 });
  });

  it("completes a partial name in place", () => {
    expect(
      replaceSlashCommandSpan("find me /sea now", { start: 8, end: 12 }, "/search"),
    ).toEqual({ value: "find me /search now", caret: 15 });
  });
});

describe("filterSlashCommands", () => {
  it("returns every command for an empty name", () => {
    expect(filterSlashCommands(COMMANDS, "")).toHaveLength(COMMANDS.length);
  });

  it("prefix-matches command names", () => {
    expect(filterSlashCommands(COMMANDS, "se").map((c) => c.name)).toEqual([
      "search",
      "settings",
    ]);
  });

  it("matches declared keywords", () => {
    expect(filterSlashCommands(COMMANDS, "voice").map((c) => c.name)).toEqual([
      "dictate",
    ]);
  });

  it("does not match on a substring that isn't a prefix", () => {
    expect(filterSlashCommands(COMMANDS, "ttings")).toEqual([]);
  });

  it("preserves declaration order", () => {
    expect(filterSlashCommands(COMMANDS, "").map((c) => c.name)).toEqual(
      COMMANDS.map((c) => c.name),
    );
  });
});

describe("resolveSlashCommand", () => {
  it("resolves an exact name even when it prefixes another command", () => {
    // "new" is a prefix of nothing here, but the exact-match branch must win
    // over the ambiguity check in general.
    const commands = [command("new"), command("newsletter")];
    const resolved = resolveSlashCommand(commands, { name: "new" });
    expect(resolved?.name).toBe("new");
  });

  it("resolves an unambiguous prefix", () => {
    expect(
      resolveSlashCommand(COMMANDS, { name: "att" })?.name,
    ).toBe("attach");
  });

  it("returns null for an ambiguous prefix", () => {
    expect(
      resolveSlashCommand(COMMANDS, { name: "se" }),
    ).toBeNull();
  });

  it("returns null for an unknown name", () => {
    expect(
      resolveSlashCommand(COMMANDS, { name: "zzz" }),
    ).toBeNull();
  });

  it("returns null for a bare slash", () => {
    expect(
      resolveSlashCommand(COMMANDS, { name: "" }),
    ).toBeNull();
  });
});

describe("isSlashCommandAvailable", () => {
  it("treats a command without a toggle as available", () => {
    expect(isSlashCommandAvailable(command("attach"))).toBe(true);
  });

  it("treats an enabled toggle as available", () => {
    expect(
      isSlashCommandAvailable(
        command("search", { toggle: { active: false } }),
      ),
    ).toBe(true);
  });

  it("treats a toggle with an unavailable reason as unavailable", () => {
    expect(
      isSlashCommandAvailable(
        command("search", {
          toggle: { active: false, unavailableReason: "Disabled in settings" },
        }),
      ),
    ).toBe(false);
  });
});

describe("groupSlashCommands", () => {
  it("groups commands in the declared group order", () => {
    const groups = groupSlashCommands(COMMANDS);
    expect(groups.map((g) => g.group)).toEqual(["actions", "navigate"]);
    expect(groups[0].commands.map((c) => c.name)).toEqual([
      "search",
      "attach",
      "dictate",
      "temporary",
      "model",
    ]);
  });

  it("omits groups with no matches", () => {
    const groups = groupSlashCommands(filterSlashCommands(COMMANDS, "att"));
    expect(groups).toHaveLength(1);
    expect(groups[0].group).toBe("actions");
  });

  it("returns nothing when no command matches", () => {
    expect(groupSlashCommands([])).toEqual([]);
  });
});

describe("filterSlashCommandModels", () => {
  const models = [
    { label: "Sonnet 5", model: "claude-sonnet-5", displayProvider: "Anthropic" },
    { label: "GPT 5", model: "gpt-5", displayProvider: "OpenAI" },
    { label: "Local Llama", model: "llama-4", displayProvider: "vLLM" },
  ];

  it("returns every model for an empty query", () => {
    expect(filterSlashCommandModels(models, "")).toHaveLength(3);
  });

  it("matches on label, model id, and provider", () => {
    expect(filterSlashCommandModels(models, "sonnet").map((m) => m.label)).toEqual(
      ["Sonnet 5"],
    );
    expect(filterSlashCommandModels(models, "gpt-5").map((m) => m.label)).toEqual(
      ["GPT 5"],
    );
    expect(filterSlashCommandModels(models, "vllm").map((m) => m.label)).toEqual(
      ["Local Llama"],
    );
  });

  it("matches a substring anywhere in the haystack", () => {
    expect(filterSlashCommandModels(models, "llama").map((m) => m.label)).toEqual(
      ["Local Llama"],
    );
  });

  it("does not mutate the input array", () => {
    const filtered = filterSlashCommandModels(models, "");
    filtered.pop();
    expect(models).toHaveLength(3);
  });
});
