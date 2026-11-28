import { expect, it } from "vitest";
import { formatModelIds, parseModelIds } from "./model-ids";

it("reads model IDs separated by commas or line breaks, once each and in order", () => {
  expect(parseModelIds("gpt-5.6")).toEqual(["gpt-5.6"]);
  expect(
    parseModelIds(" vendor/b , vendor/a,\nllama3:8b\r\nvendor/b,, "),
  ).toEqual(["vendor/b", "vendor/a", "llama3:8b"]);
  expect(parseModelIds(" , \n")).toEqual([]);
  // A space is part of an ID, not a separator.
  expect(parseModelIds("my local model")).toEqual(["my local model"]);
});

it("writes IDs back in a form it reads the same way", () => {
  const ids = ["vendor/b", "vendor/a", "llama3:8b"];
  expect(parseModelIds(formatModelIds(ids))).toEqual(ids);
  expect(formatModelIds([])).toBe("");
});
