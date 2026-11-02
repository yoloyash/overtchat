import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { checkThinkingLevels } from "./thinking-check";

describe("checkThinkingLevels", () => {
  it("groups identical prompts, reports rejected fields, and matches the default", async () => {
    const render = vi.fn(async (fields: Record<string, unknown>) => {
      const kwargs = fields.chat_template_kwargs as
        | Record<string, unknown>
        | undefined;
      if (fields.reasoning_effort === "max") return undefined;
      if (kwargs?.enable_thinking === false) return "off";
      if (fields.reasoning_effort) return "on";
      return "on";
    });

    await expect(
      checkThinkingLevels(render, {
        on: { chat_template_kwargs: { enable_thinking: true } },
        off: { chat_template_kwargs: { enable_thinking: false } },
        high: { reasoning_effort: "high" },
        max: { reasoning_effort: "max" },
      }),
    ).resolves.toEqual({
      status: "checked",
      failed: ["max"],
      identical: [["on", "high"]],
      matchesDefault: ["on", "high"],
    });
    expect(render).toHaveBeenNthCalledWith(1, {});
  });

  it("strips null removals before rendering", async () => {
    const render = vi.fn(async () => "prompt");
    await checkThinkingLevels(render, {
      on: { reasoning_effort: null, chat_template_kwargs: { thinking: true } },
      off: { chat_template_kwargs: { thinking: false } },
    });
    expect(render).toHaveBeenCalledWith({
      chat_template_kwargs: { thinking: true },
    });
  });

  it("is unavailable when the baseline prompt cannot be rendered", async () => {
    await expect(
      checkThinkingLevels(async () => undefined, {
        on: {},
        off: {},
      }),
    ).resolves.toEqual({ status: "unavailable" });
  });
});
