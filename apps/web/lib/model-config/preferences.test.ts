import { expect, it } from "vitest";
import { resolveChatModelId } from "@overtchat/shared";
const models = [{ id: "a" }, { id: "b" }, { id: "c" }];
it("uses the chat selection, then the default, then the first available model", () => {
  expect(resolveChatModelId(models, "c", "a")).toBe("c");
  expect(resolveChatModelId(models, null, "b")).toBe("b");
  expect(resolveChatModelId(models, "removed", "c")).toBe("c");
  expect(resolveChatModelId(models, null, "removed")).toBe("a");
  expect(resolveChatModelId([], "c", "a")).toBe("");
});
it("prefers the project default over the account default", () => {
  expect(resolveChatModelId(models, null, "b", "c")).toBe("b");
  expect(resolveChatModelId(models, "a", "b", "c")).toBe("a");
  expect(resolveChatModelId(models, null, "removed", "c")).toBe("c");
  expect(resolveChatModelId(models, null, null, "c")).toBe("c");
});
