import type { Metadata } from "next";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AudioLines,
  ArrowDown,
  ArrowRight,
  Bot,
  Boxes,
  Braces,
  Check,
  Database,
  Globe2,
  HardDrive,
  KeyRound,
  MemoryStick,
  MessageSquareText,
  Mic2,
  Search,
  Server,
  ShieldCheck,
  Smartphone,
  Users,
  Volume2,
  WandSparkles,
} from "lucide-react";
import Link from "next/link";
import { CopyButton } from "@/components/CopyButton";
import { GitHubIcon } from "@/components/GitHubIcon";
import { HeroVignette } from "@/components/HeroVignette";
import { SectionRail } from "@/components/SectionRail";
import { HOME_SECTION_IDS } from "@/lib/home-sections";
import {
  createPageMetadata,
  DEFAULT_SITE_DESCRIPTION,
  DEFAULT_SITE_TITLE,
} from "@/lib/metadata";

export const metadata: Metadata = createPageMetadata({
  title: DEFAULT_SITE_TITLE,
  description: DEFAULT_SITE_DESCRIPTION,
  path: "/",
  absoluteTitle: true,
});

const quickStart = "curl -fsSL https://overtchat.com/install | sh";

const steps: Array<{
  number: string;
  title: string;
  body: string;
}> = [
  {
    number: "01",
    title: "Bring any model",
    body: "Connect vLLM, llama.cpp, SGLang, Ollama, LM Studio, a hosted provider, or any OpenAI-compatible endpoint once at the server.",
  },
  {
    number: "02",
    title: "Choose who gets in",
    body: "Create accounts for people you trust. Public signup stays closed, and every person gets private history, projects, files, and memories.",
  },
  {
    number: "03",
    title: "Let them just chat",
    body: "They sign in from the web or Android app. Nobody else needs an inference URL, a shared API key, or a lesson in your model stack.",
  },
];

const features: Array<{
  icon: LucideIcon;
  title: string;
  body: string;
}> = [
  {
    icon: MessageSquareText,
    title: "Leave. The reply won’t.",
    body: "Generations keep running on the server when a tab closes or a phone backgrounds, then reconnect when you return.",
  },
  {
    icon: Search,
    title: "Useful search",
    body: "Search the web through bundled SearXNG and find old conversations with SQLite FTS5—no vector database required.",
  },
  {
    icon: HardDrive,
    title: "Files, not just prompts",
    body: "Work with images, PDFs, Word and Excel documents, CSV files, and source code directly in a chat.",
  },
  {
    icon: MemoryStick,
    title: "One server, personal to everyone",
    body: "Private history, projects, saved memories, and preferences make a shared installation feel like each person’s own app.",
  },
  {
    icon: WandSparkles,
    title: "Tools and reasoning included",
    body: "Connect standard MCP servers, use built-in web search, and expose the reasoning controls supported by each local or hosted model.",
  },
  {
    icon: Bot,
    title: "A side door to coding agents",
    body: "When useful, admins can run Codex, Claude Code, OpenCode, Pi, and Oh My Pi locally or over SSH without leaving the chat app.",
  },
];

const principles = [
  "One portable SQLite file",
  "No hosted control plane",
  "No usage analytics",
  "Optional local speech and search",
  "Standard MCP support",
  "One-command managed updates",
];

function HomePageShell({ children }: { children: ReactNode }) {
  return (
    <>
      <SectionRail />
      <main className="site-main" id="main-content" tabIndex={-1}>
        {children}
      </main>
    </>
  );
}

export default function HomePage() {
  return (
    <HomePageShell>
      <section
        className="hero site-container"
        id={HOME_SECTION_IDS.intro}
      >
        <div className="hero-copy">
          <p className="eyebrow">Open source · self-hosted</p>
          <h1 className="hero-headline">
            <span className="hero-headline-setup">
              Your AI chat.
            </span>
            <span className="hero-headline-punch">
              Actually yours.
            </span>
          </h1>
          <p className="hero-lede">
            OvertChat brings local and hosted models into one polished,
            self-hosted app. You decide where requests go; accounts,
            conversations, files, and memories stay on your server.
          </p>
          <div className="button-row">
            <a
              className="button button-primary"
              href="https://github.com/yoloyash/overtchat"
            >
              <GitHubIcon aria-hidden="true" />
              View on GitHub
            </a>
            <a className="button" href={`#${HOME_SECTION_IDS.quickStart}`}>
              Quick start
              <ArrowRight aria-hidden="true" />
            </a>
          </div>
          <div className="hero-facts" aria-label="Project highlights">
            <span><ShieldCheck aria-hidden="true" /> No OvertChat cloud</span>
            <span><Users aria-hidden="true" /> Multi-user</span>
            <span><AudioLines aria-hidden="true" /> Realtime local voice</span>
          </div>
        </div>
        <HeroVignette />
        <a
          className="hero-scroll-cue"
          href={`#${HOME_SECTION_IDS.sharing}`}
        >
          Continue
          <ArrowDown aria-hidden="true" />
        </a>
      </section>

      <section className="trust-strip" aria-label="Supported deployment targets">
        <div
          className="site-container trust-strip-inner"
          role="region"
          aria-label="Supported model endpoints"
          tabIndex={0}
        >
          <span className="trust-strip-label">Bring your models</span>
          <span>Ollama</span>
          <span>vLLM</span>
          <span>llama.cpp</span>
          <span>SGLang</span>
          <span>LM Studio</span>
          <span>Hosted APIs</span>
        </div>
      </section>

      <section
        className="site-section site-container"
        id={HOME_SECTION_IDS.sharing}
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">Built to be used</p>
            <h2 className="section-title">Your models deserve an actual front door.</h2>
          </div>
          <p className="section-lede">
            An inference server is infrastructure. OvertChat is the part people
            use: you configure the models once, then everyone you trust gets an
            account and a private space of their own.
          </p>
        </div>
        <div
          className="access-card"
          role="img"
          aria-label="A private model server connected through OvertChat to separate user accounts"
        >
          <div className="access-node">
            <span className="access-node-icon"><Server /></span>
            <div>
              <strong>Your model server</strong>
              <small>One private endpoint</small>
            </div>
          </div>
          <span className="access-arrow"><ArrowRight /></span>
          <div className="access-node access-node-primary">
            <span className="access-node-icon"><Boxes /></span>
            <div>
              <strong>OvertChat</strong>
              <small>Accounts, chat, voice, files</small>
            </div>
          </div>
          <span className="access-arrow"><ArrowRight /></span>
          <div className="access-people">
            <div className="access-person"><span>Y</span><div><strong>You</strong><small>Admin</small></div></div>
            <div className="access-person"><span>M</span><div><strong>Maya</strong><small>Private history</small></div></div>
            <div className="access-person"><span>S</span><div><strong>Sam</strong><small>Private history</small></div></div>
          </div>
          <div className="access-safety">
            <span><KeyRound /> Admin-created accounts</span>
            <span><ShieldCheck /> Public signup closed</span>
          </div>
        </div>
        <div className="steps-grid">
          {steps.map((step) => (
            <article className="step-card" key={step.number}>
              <span className="step-number">{step.number}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section
        className="site-section site-container"
        id={HOME_SECTION_IDS.voice}
      >
        <div className="voice-showcase">
          <div className="voice-copy">
            <p className="eyebrow">Beyond the text box</p>
            <h2 className="section-title">Local voice, at conversation speed.</h2>
            <p className="section-lede">
              Speak naturally. Cut in mid-answer. Change direction and keep
              going. OvertChat wraps local Parakeet and Kokoro around the model
              you choose, with web search and a saved transcript along for the
              conversation.
            </p>
            <div className="voice-proof">
              <strong>&lt;8 GB</strong>
              <span>VRAM for the entire speech layer in our current NVIDIA testing. The rest belongs to the model.</span>
            </div>
            <p className="voice-hardware-note">
              A 24 GB card can still have room for a capable quantized model.
              Speech can also run on CPU or a second GPU when you want to go
              bigger.
            </p>
          </div>
          <div
            className="voice-console"
            role="img"
            aria-label="Realtime voice moving from Parakeet speech recognition through the selected language model to Kokoro speech synthesis"
          >
            <div className="voice-console-header">
              <span><span className="voice-live-dot" /> Listening</span>
              <small>Realtime voice</small>
            </div>
            <div className="voice-orb">
              <Mic2 />
              <div className="voice-wave" aria-hidden="true">
                {Array.from({ length: 15 }, (_, index) => <span key={index} />)}
              </div>
            </div>
            <div className="voice-pipeline">
              <div><AudioLines /><strong>Parakeet</strong><small>Speech to text</small></div>
              <ArrowRight />
              <div><Braces /><strong>Your model</strong><small>Local or hosted</small></div>
              <ArrowRight />
              <div><Volume2 /><strong>Kokoro</strong><small>Text to speech</small></div>
            </div>
            <div className="voice-console-footer">
              <span>Interruptible</span>
              <span>Search-aware</span>
              <span>Transcript saved</span>
            </div>
          </div>
        </div>
      </section>

      <section
        className="site-section site-container"
        id={HOME_SECTION_IDS.features}
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">A focused Open WebUI alternative</p>
            <h2 className="section-title">Everything around the model matters too.</h2>
          </div>
          <p className="section-lede">
            OvertChat stays focused on a fast, complete chat experience instead
            of becoming another platform to maintain. The everyday details are
            already handled.
          </p>
        </div>
        <div className="feature-grid">
          {features.map(({ icon: Icon, title, body }) => (
            <article className="feature-card" key={title}>
              <span className="feature-icon"><Icon aria-hidden="true" /></span>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section
        className="site-section architecture-section"
        id={HOME_SECTION_IDS.architecture}
      >
        <div className="site-container architecture-grid">
          <div className="architecture-copy">
            <p className="eyebrow">What “yours” means</p>
            <h2 className="section-title">No mystery cloud in the middle.</h2>
            <p className="section-lede">
              Accounts, conversations, files, memories, and settings stay in
              one portable SQLite database on your server. Model requests go
              directly to the endpoints you configure. OvertChat operates no
              account system, API relay, or hosted control plane.
            </p>
            <a
              className="text-link"
              href="https://github.com/yoloyash/overtchat/blob/main/docs/deploy.md"
            >
              Read the deployment guide <ArrowRight aria-hidden="true" />
            </a>
          </div>
          <div className="architecture-card">
            <div className="architecture-diagram" aria-hidden="true">
              <div className="architecture-node architecture-client">
                <Globe2 />
                <span>Web + mobile</span>
              </div>
              <div className="architecture-line" />
              <div className="architecture-node architecture-core">
                <Boxes />
                <span>OvertChat</span>
              </div>
              <div className="architecture-split">
                <div className="architecture-node"><Database /><span>Your data</span></div>
                <div className="architecture-node"><Braces /><span>Your endpoints</span></div>
              </div>
            </div>
            <ul className="principle-list">
              {principles.map((principle) => (
                <li key={principle}><Check aria-hidden="true" /> {principle}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section
        className="site-section site-container clients-section"
        id={HOME_SECTION_IDS.clients}
      >
        <div className="client-card client-card-web">
          <span className="client-icon"><Globe2 aria-hidden="true" /></span>
          <div className="client-card-body">
            <p className="eyebrow">Wherever there’s a browser</p>
            <h2>Open it. Pick up where you left off.</h2>
            <p>
              Long conversations stay responsive, active replies survive a
              disconnect, and every project, file, search, memory, and model is
              waiting on the server.
            </p>
            <a href="https://github.com/yoloyash/overtchat#quick-start" className="text-link">
              Self-host the web app <ArrowRight aria-hidden="true" />
            </a>
          </div>
        </div>
        <div className="client-card client-card-mobile">
          <span className="client-icon"><Smartphone aria-hidden="true" /></span>
          <div className="client-card-body">
            <p className="eyebrow">Away from the desk</p>
            <h2>Same server. Smaller screen.</h2>
            <p>
              The native Android app connects straight to OvertChat. Chats,
              attachments, projects, search, and voice follow without moving
              into a separate mobile backend.
            </p>
            <a
              href="https://play.google.com/store/apps/details?id=com.overtchat.mobile"
              className="text-link"
            >
              Get it on Google Play <ArrowRight aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>

      <section
        className="site-section site-container quick-start-section"
        id={HOME_SECTION_IDS.quickStart}
      >
        <div className="quick-start-copy">
          <p className="eyebrow">Your turn</p>
          <h2 className="section-title">One command between here and yours.</h2>
          <p className="section-lede">
            The guided setup handles Docker, secrets, updates, and optional
            search, speech, and Agent Connections. Bring a model endpoint; the
            first account becomes the administrator.
          </p>
          <div className="button-row">
            <a
              className="button"
              href="https://github.com/yoloyash/overtchat/blob/main/docs/deploy.md"
            >
              Full deployment guide
              <ArrowRight aria-hidden="true" />
            </a>
          </div>
        </div>
        <div className="code-window">
          <div className="code-window-header">
            <div className="window-dots" aria-hidden="true"><span /><span /><span /></div>
            <span>terminal</span>
            <CopyButton value={quickStart} />
          </div>
          <pre tabIndex={0} aria-label="Quick start commands">
            <code>{quickStart}</code>
          </pre>
        </div>
      </section>

      <section
        className="site-section site-container release-cta"
        id={HOME_SECTION_IDS.releases}
      >
        <div>
          <p className="eyebrow">Still becoming yours</p>
          <h2 className="section-title">Built in public. Shipped in the open.</h2>
        </div>
        <div className="release-cta-copy">
          <p className="section-lede">
            Follow every stable web and mobile release in one chronological log,
            generated directly from the project’s GitHub Releases.
          </p>
          <Link className="button button-primary" href="/releases/">
            Browse releases
            <ArrowRight aria-hidden="true" />
          </Link>
        </div>
      </section>
    </HomePageShell>
  );
}
