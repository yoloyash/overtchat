import { auth } from "@/lib/auth/server";
import { serverCapabilityInputSchema } from "@/lib/capabilities/schema";
import { getServerCapability } from "@/lib/db/serverCapabilities";
import { proxySpeech, proxyTranscription } from "@/lib/speech/proxy";

// One second of silent, mono PCM audio at 16 kHz. No microphone is needed.
function silentWav(): Uint8Array<ArrayBuffer> {
  const audio = Buffer.alloc(44 + 32_000);
  audio.write("RIFF", 0);
  audio.writeUInt32LE(audio.length - 8, 4);
  audio.write("WAVEfmt ", 8);
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(16_000, 24);
  audio.writeUInt32LE(32_000, 28);
  audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34);
  audio.write("data", 36);
  audio.writeUInt32LE(32_000, 40);
  return new Uint8Array(audio);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (session.user.role !== "admin") {
    return new Response("Forbidden", { status: 403 });
  }
  const { id } = await params;
  if (id !== "tts" && id !== "stt") {
    return new Response("Not found", { status: 404 });
  }
  const parsed = serverCapabilityInputSchema.safeParse({
    ...(await request.json().catch(() => null)),
    id,
  });
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid capability." },
      { status: 400 },
    );
  }
  const draft = parsed.data;
  if (draft.provider === "disabled") {
    return Response.json(
      { error: "Choose a speech provider to test." },
      { status: 400 },
    );
  }
  if (draft.provider === "openai-compatible") {
    const error =
      !draft.baseUrl || !/^https?:\/\//iu.test(draft.baseUrl)
        ? "Enter an HTTP or HTTPS API base URL."
        : !draft.model?.trim()
          ? "Enter the provider model name."
          : id === "tts" && !draft.voice?.trim()
            ? "Enter the default voice."
            : null;
    if (error) return Response.json({ error }, { status: 400 });
  }
  const current = getServerCapability(id);
  if (draft.provider === "bundled" && !current.bundledInstalled) {
    return Response.json(
      { error: `${id} is not installed on this server. Run: overtchat setup` },
      { status: 409 },
    );
  }
  const capability = { ...draft, apiKey: draft.apiKey || current.apiKey };
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]);
  try {
    let response: Response;
    if (id === "tts") {
      response = await proxySpeech(
        new Request(request.url, {
          method: "POST",
          body: JSON.stringify({ input: "OvertChat connection test." }),
          signal,
        }),
        "mp3",
        capability,
      );
    } else {
      const body = new FormData();
      body.set(
        "file",
        new Blob([silentWav()], { type: "audio/wav" }),
        "test.wav",
      );
      body.set("response_format", "json");
      response = await proxyTranscription(
        new Request(request.url, {
          method: "POST",
          body,
          signal,
        }),
        capability,
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        "Connection failed. Check the API base URL, credentials, and model.",
      );
    }
    if (id === "tts") {
      const contentType = response.headers.get("content-type") ?? "";
      if (
        !contentType.startsWith("audio/") &&
        !contentType.startsWith("application/octet-stream")
      ) {
        await response.body?.cancel();
        throw new Error(
          "The provider did not return audio. Check the API base URL.",
        );
      }
      const reader = response.body?.getReader();
      try {
        const chunk = await reader?.read();
        if (!chunk?.value?.byteLength)
          throw new Error("The provider returned empty audio.");
      } finally {
        await reader?.cancel();
      }
    } else {
      const body = await response.json().catch(() => null);
      if (typeof body?.text !== "string") {
        throw new Error(
          "The provider did not return a transcription response. Check the API base URL.",
        );
      }
    }
    return Response.json({
      message:
        id === "tts"
          ? "Connection successful. The provider returned audio."
          : "Connection successful. The provider accepted the test audio.",
    });
  } catch (error) {
    return Response.json(
      {
        error: signal.aborted
          ? "The connection test timed out or was cancelled."
          : error instanceof Error
            ? error.message
            : "Could not connect to the provider.",
      },
      { status: 502 },
    );
  }
}
