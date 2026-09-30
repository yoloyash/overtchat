import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { useSpeech } from "@/lib/useSpeech";
import { MiniSpeechPlayer } from "@/components/chat/MiniSpeechPlayer";

function idleSpeech(): ReturnType<typeof useSpeech> {
  return {
    activeId: null,
    status: "idle",
    canSeek: false,
    error: null,
    canRetry: true,
    play: vi.fn(),
    stop: vi.fn(),
    retry: vi.fn(),
    audioRef: { current: null },
  };
}

it("keeps idle player markup independent of session hydration", () => {
  const speech = idleSpeech();
  const anonymous = renderToStaticMarkup(<MiniSpeechPlayer speech={speech} />);
  const admin = renderToStaticMarkup(<MiniSpeechPlayer speech={speech} isAdmin />);
  expect(admin).toBe(anonymous);
  expect(admin).not.toContain('role="alert"');
  expect(admin).not.toContain("Speech settings");
  // The media element stays mounted for synchronous playback on mobile.
  expect(admin).toContain('<audio slot="media" tabindex="-1">');
});

it("shows recovery and admin settings when playback actually fails", () => {
  const speech = { ...idleSpeech(), error: "Couldn't reach the speech playback service." };
  const markup = renderToStaticMarkup(<MiniSpeechPlayer speech={speech} isAdmin />);
  expect(markup).toContain('role="alert"');
  expect(markup).toContain("Retry playback");
  expect(markup).toContain("Speech settings");
});
