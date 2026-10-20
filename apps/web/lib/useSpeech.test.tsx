import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSpeech } from "./useSpeech";

let root: Root;
let speech: ReturnType<typeof useSpeech>;
function Probe() {
  const playback = useSpeech();
  const { audioRef } = playback;
  useLayoutEffect(() => { speech = playback; });
  return <audio ref={audioRef} />;
}
beforeEach(async () => {
  const { window } = parseHTML(
    '<html><body><div id="root"></div></body></html>',
  );
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(
    window.document.getElementById("root") as unknown as HTMLElement,
  );
  await act(async () => root.render(<Probe />));
  Object.assign(speech.audioRef.current!, {
    pause: vi.fn(),
    load: vi.fn(),
    play: vi.fn(async () => {}),
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it.each([
  [503, "speech_disabled", false, "turned off"],
  [503, "speech_not_configured", false, "hasn't been set up"],
  [502, "speech_provider_auth", false, "server's credentials"],
  [502, "speech_unreachable", true, "Couldn't reach"],
  [504, "speech_timeout", true, "too long"],
])(
  "offers playback retry only when it can help: %s %s",
  async (status, code, canRetry, message) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ code }, { status: status as number })),
    );
    await act(async () => {
      speech.play("message", "Hello");
    });
    expect(speech.error).toContain(message);
    expect(speech.canRetry).toBe(canRetry);
    await act(async () => speech.stop());
    expect(speech.error).toBeNull();
  },
);

it("retries the same message after an outage", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    Response.json({ code: "speech_unreachable" }, { status: 502 }),
  );
  vi.stubGlobal("fetch", fetch);
  await act(async () => {
    speech.play("message", "Hello");
  });
  await act(async () => {
    speech.retry();
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body as string)).toEqual({
    text: "Hello",
  });
  expect(JSON.parse(fetch.mock.calls[1]?.[1]?.body as string)).toEqual({
    text: "Hello",
  });
});
