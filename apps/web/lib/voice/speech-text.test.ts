import { describe, expect, it } from "vitest";
import { stripCitationMarkers } from "@overtchat/shared";
import { SpeechTextFilter } from "./speech-text";

function filter(parts: string[]) {
  const stream = new SpeechTextFilter();
  return parts.map(part => stream.push(part)).join("") + stream.finish();
}

const examples = [
  ["Herons live near water.\\ue202turn0search0 Next sentence.", "Herons live near water. Next sentence."],
  ["A.turn0search12turn1news3 B.", "A. B."],
  ["A.\\ue200\\ue202turn0search0\\ue202turn1search1\\ue201 B.", "A. B."],
  ["Cited wordsturn{12}file{34}.", "Cited words."],
  ["\\ue203Highlighted text\\ue204\\ue202turn0ref0", "Highlighted text"],
  ["Aturn0image0Bturn2video9C.", "ABC."],
  ["Ordinary text, turn0search0, C:\\users\\example and [1].", "Ordinary text, turn0search0, C:\\users\\example and [1]."],
];

describe("streaming citation cleanup for speech", () => {
  it.each(examples)("removes markers at every chunk boundary: %s", (input, expected) => {
    for (let split = 0; split <= input.length; split++) {
      expect(filter([input.slice(0, split), input.slice(split)]), `split ${split}`).toBe(expected);
    }
    expect(filter([...input])).toBe(expected);
    expect(stripCitationMarkers(input)).toBe(expected);
  });

  it("forwards ordinary speech immediately and holds only uncertain citation suffixes", () => {
    const stream = new SpeechTextFilter();
    expect(stream.push("First sentence.\\u")).toBe("First sentence.");
    expect(stream.push("e202turn0sea")).toBe("");
    expect(stream.push("rch1")).toBe("");
    expect(stream.push("2 Next sentence.")).toBe(" Next sentence.");
    expect(stream.finish()).toBe("");
  });

  it.each(["\\u", "\\ue", "\\ue20", "\\ue202", "\\ue202tur", "turn0sea", "turn12search{"])(
    "does not flush a truncated marker to speech at EOF: %s", marker => {
      expect(filter([...`Answer.${marker}`])).toBe("Answer.");
    },
  );

  it("preserves non-citation escapes and trailing backslashes", () => {
    expect(filter([..."Path \\unknown \\ue999 and \\"])).toBe("Path \\unknown \\ue999 and \\");
  });

  it("preserves prose after a stray citation marker", () => {
    expect(filter([..."A then more prose."])).toBe("A then more prose.");
  });

  it("does not buffer indefinitely after malformed marker input", () => {
    const stream = new SpeechTextFilter();
    expect(stream.push("turn" + "1".repeat(1000))).not.toBe("");
    expect(stream.push(" Normal speech.")).toBe(" Normal speech.");
  });
});
