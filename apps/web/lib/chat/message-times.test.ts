import { describe, expect, it } from "vitest";
import {
  createMessageTimeStore,
  loadedMessageTimes,
  stampNewMessages,
} from "./message-times";

describe("loadedMessageTimes", () => {
  it("keeps the server's time for each loaded message", () => {
    expect(
      loadedMessageTimes({
        messages: [{ id: "a" }, { id: "b" }],
        messageTimes: { a: 1_000, b: 2_000, elsewhere: 3_000 },
      }),
    ).toEqual({ a: 1_000, b: 2_000 });
  });

  it("marks loaded messages as unknown when the server reports no times", () => {
    expect(
      loadedMessageTimes({ messages: [{ id: "a" }, { id: "b" }] }),
    ).toEqual({ a: null, b: null });
  });
});

describe("stampNewMessages", () => {
  it("stamps only messages it has not seen", () => {
    const times = { saved: 1_000, unknown: null };

    expect(
      stampNewMessages(
        times,
        [{ id: "saved" }, { id: "unknown" }, { id: "sent" }, { id: "reply" }],
        9_000,
      ),
    ).toEqual({ saved: 1_000, unknown: null, sent: 9_000, reply: 9_000 });
  });

  it("returns the same object when every message is known", () => {
    const times = { saved: 1_000, unknown: null };

    expect(
      stampNewMessages(times, [{ id: "saved" }, { id: "unknown" }], 9_000),
    ).toBe(times);
  });
});

describe("createMessageTimeStore", () => {
  it("lets a later load replace a local stamp with the saved time", () => {
    const store = createMessageTimeStore({});
    store.stampNew([{ id: "reply" }], 9_000);
    expect(store.get()).toEqual({ reply: 9_000 });

    store.addLoaded({
      messages: [{ id: "older" }, { id: "reply" }],
      messageTimes: { older: 1_000, reply: 8_500 },
    });

    expect(store.get()).toEqual({ older: 1_000, reply: 8_500 });
  });

  it("notifies subscribers only when a time changes", () => {
    const store = createMessageTimeStore({ saved: 1_000 });
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });

    store.stampNew([{ id: "saved" }], 9_000);
    expect(calls).toBe(0);

    store.stampNew([{ id: "saved" }, { id: "sent" }], 9_000);
    expect(calls).toBe(1);

    unsubscribe();
    store.stampNew([{ id: "later" }], 9_500);
    expect(calls).toBe(1);
  });
});
