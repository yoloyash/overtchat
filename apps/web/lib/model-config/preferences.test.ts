import { expect, it } from "vitest";
import { favoriteModelsFirst, resolveChatModelId } from "@overtchat/shared";
const models = [{ id: "a" }, { id: "b" }, { id: "c" }];
it("uses the chat selection, then the remembered selection, then the first available model", () => {
  expect(resolveChatModelId(models, "c", "a")).toBe("c");
  expect(resolveChatModelId(models, null, "b")).toBe("b");
  expect(resolveChatModelId(models, "removed", "c")).toBe("c");
  expect(resolveChatModelId(models, null, "removed")).toBe("a");
  expect(resolveChatModelId([], "c", "a")).toBe("");
});
it("groups all favorites first in stable configured order without mutating the list", () => {
  expect(favoriteModelsFirst(models, ["c", "b"])).toEqual([
    { id: "b" },
    { id: "c" },
    { id: "a" },
  ]);
  expect(models.map((model) => model.id)).toEqual(["a", "b", "c"]);
  expect(favoriteModelsFirst(models, ["missing"])).toEqual(models);
  expect(favoriteModelsFirst(models, [])).toEqual(models);
});
