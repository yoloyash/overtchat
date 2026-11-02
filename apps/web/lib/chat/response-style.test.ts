import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { withResponseStyle, withTurnResponseStyle, VOICE_RESPONSE_STYLE_V1 } from "./response-style";
const user = (id: string): UIMessage => ({ id, role: "user", parts: [{ type: "text", text: id }] });
describe("per-turn voice style", () => {
  it("keeps the previous model prefix byte-for-byte stable across mode switches", () => {
    const first = user("text");
    const spoken = withTurnResponseStyle(user("voice"), "voice");
    const prefix = withResponseStyle([first, spoken]);
    const next = withResponseStyle([first, JSON.parse(JSON.stringify(spoken)), user("text-again")]);
    expect(next.slice(0, 2)).toEqual(prefix);
    expect(next[2]).toEqual(user("text-again"));
    expect(JSON.stringify(prefix[1])).toContain(VOICE_RESPONSE_STYLE_V1);
    expect(spoken.parts).toEqual(user("voice").parts);
  });
  it("ignores client-supplied historical style versions on text submissions", () => {
    expect(withTurnResponseStyle({ ...user("text"), metadata: { responseStyle: "voice-v1" } }, "text")).toEqual(user("text"));
  });
});
