<p align="center">
  <img src=".github/assets/banner.png" alt="overtchat" width="600" />
</p>

<p align="center">
  <strong>A self-hosted client for vLLM, llama.cpp, and coding agents.</strong>
</p>

<p align="center">
  <a href="https://overtchat.com/"><img src="https://img.shields.io/badge/Website-overtchat-0D9488" alt="Project website" valign="middle"></a>&nbsp; • &nbsp;
  <a href="https://github.com/yoloyash/overtchat/releases"><img src="https://img.shields.io/github/v/release/yoloyash/overtchat?label=release" alt="Latest release" valign="middle"></a>&nbsp; • &nbsp;
  <a href="https://play.google.com/store/apps/details?id=com.overtchat.mobile"><img src="https://img.shields.io/badge/Android-Google_Play-22C55E?logo=googleplay&logoColor=white" alt="Android on Google Play" valign="middle"></a>&nbsp; • &nbsp;
  <a href="https://overtchat.com/privacy/"><img src="https://img.shields.io/badge/Privacy-No_Usage_Analytics-teal?color=0D9488" alt="Privacy policy" valign="middle"></a>&nbsp; • &nbsp;
  <a href=".github/actions/repo-tokens/README.md"><img src=".github/badges/tokens.svg" alt="Source tokens" valign="middle"></a>
</p>

<p align="center">
  <img src=".github/assets/chat.png" alt="OvertChat running a conversation with a Gemini model" width="100%" />
</p>

## Quick start

```bash
curl -fsSL https://overtchat.com/install | sh
```

The guided installer handles Docker, configuration, and secrets, then gives
you a URL to open. The first signup becomes the admin.

- `overtchat setup` — add or change optional services
- `overtchat status` — check the installation
- `overtchat update` — update the app and everything it manages

Prefer to manage Compose yourself or deploy from source? See the
[deployment guide](docs/deploy.md#manual-compose-installation).

## Built for your stack

| Local inference | Included locally | Coding agents |
| --- | --- | --- |
| vLLM · llama.cpp · SGLang | SearXNG · Kokoro TTS · Parakeet STT | Codex · Pi · Oh My Pi |

First-class setup and model discovery for local inference servers, plus hosted
providers and custom endpoints. The installer can also wire up local search,
playback, and dictation—no extra integrations or API keys to stitch together.

## When you need more than chat

Connect your coding agents on your server or over SSH. Start or resume
sessions, follow plans and tool calls as they happen, review changes, and steer
the agent without living in a terminal.

<p align="center">
  <img src=".github/assets/agent-connections.png" alt="OvertChat controlling a Codex coding-agent session" width="100%" />
</p>

## A focused alternative to Open WebUI

[Open WebUI](https://github.com/open-webui/open-webui) is an impressive project
with a huge feature surface. OvertChat is deliberately more focused: a fast
chat experience, practical built-ins, and coding-agent control without turning
your server into a platform to maintain.

- **Fast by default.** A clean interface that stays out of the conversation.
- **Simple to run.** Guided setup, one-command updates, and portable data.

If you want a large plugin ecosystem, image generation, knowledge graphs, or a
code interpreter, Open WebUI or LibreChat may be a better fit. If you want a
focused self-hosted home for chat and coding agents, that is what OvertChat is
built for.

## Mobile

<a href="https://play.google.com/store/apps/details?id=com.overtchat.mobile"><img src="https://img.shields.io/badge/Get_it_on-Google_Play-22C55E?logo=googleplay&logoColor=white" alt="Get it on Google Play"></a>

Connect the native Android app to your OvertChat server and take your chats
with you. Your history, projects, files, web search, and voice tools come along.

[Download from Google Play](https://play.google.com/store/apps/details?id=com.overtchat.mobile)
or [sideload the app](docs/android.md#sideload-apk).

## Documentation

- [Deployment, updates, backup, and troubleshooting](docs/deploy.md)
- [Android installation](docs/android.md)
- [Privacy policy](https://overtchat.com/privacy/)

## License

MIT. Fork it, white-label it, ship it. No branding clauses to negotiate around.
