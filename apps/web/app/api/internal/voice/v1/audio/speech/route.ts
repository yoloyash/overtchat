import { proxySpeech } from "@/lib/speech/proxy";
import { authorizeVoiceService } from "@/lib/voice/internal-auth";

export async function POST(request: Request) {
  if (!authorizeVoiceService(request)) {
    return new Response("Unauthorized", { status: 401 });
  }
  return proxySpeech(request, "pcm");
}
