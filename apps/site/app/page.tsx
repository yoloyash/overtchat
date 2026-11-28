import type { Metadata } from "next";
import type { ReactNode } from "react";
import {
  AudioLines,
  ArrowDown,
  ArrowRight,
  Boxes,
  Braces,
  Check,
  Database,
  Globe2,
  Lock,
  Plug,
  Search,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { AccessDemo } from "@/components/AccessDemo";
import { BrandIcon, type BrandIconId } from "@/components/BrandIcon";
import { HomeEffects } from "@/components/HomeEffects";
import { InstallSwitcher } from "@/components/InstallSwitcher";
import { GitHubIcon } from "@/components/GitHubIcon";
import { HeroDemo } from "@/components/HeroDemo";
import { SectionRail } from "@/components/SectionRail";
import { VoiceDemo } from "@/components/VoiceDemo";
import { APP_STORE_URL, GOOGLE_PLAY_URL } from "@/lib/downloads";
import { HOME_SECTION_IDS } from "@/lib/home-sections";
import {
  createPageMetadata,
  DEFAULT_SITE_DESCRIPTION,
  DEFAULT_SITE_TITLE,
} from "@/lib/metadata";
import { sitePath } from "@/lib/site";
import "./home.css";

export const metadata: Metadata = createPageMetadata({
  title: DEFAULT_SITE_TITLE,
  description: DEFAULT_SITE_DESCRIPTION,
  path: "/",
  absoluteTitle: true,
});

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
    body: "They sign in from the web, desktop, Android, or iOS app. Nobody else needs an inference URL, a shared API key, or a lesson in your model stack.",
  },
];

const endpoints: Array<{ name: string; icon?: BrandIconId }> = [
  { name: "Ollama", icon: "ollama" },
  { name: "vLLM", icon: "vllm" },
  { name: "llama.cpp", icon: "llamacpp" },
  { name: "SGLang", icon: "sglang" },
  { name: "LM Studio" },
  { name: "OpenRouter", icon: "openrouter" },
  { name: "OpenAI", icon: "openai" },
  { name: "Anthropic", icon: "anthropic" },
  { name: "Google Gemini", icon: "gemini" },
  { name: "DeepSeek", icon: "deepseek" },
  { name: "Amazon Bedrock", icon: "bedrock" },
  { name: "Any OpenAI-compatible endpoint" },
];

// Each card opens with a small scene instead of an icon. They are decoration:
// the title and body carry the meaning.
const features: Array<{
  visual: ReactNode;
  title: string;
  body: string;
}> = [
  {
    visual: (
      <div className="scene scene-persist">
        <span className="scene-chip scene-chip-closed"><X /> Tab closed</span>
        <div className="scene-lines">
          <i /><i /><i />
        </div>
        <span className="scene-chip"><span className="scene-live" /> Still writing on the server</span>
      </div>
    ),
    title: "Leave. The reply won’t.",
    body: "Generations keep running on the server when a tab closes or a phone backgrounds, then reconnect when you return.",
  },
  {
    visual: (
      <div className="scene scene-search">
        <div className="scene-field">
          <Search />
          <span>sourdough starter</span>
        </div>
        <div className="scene-result"><Globe2 /> <span>The web</span> <small>6 results</small></div>
        <div className="scene-result"><Database /> <span>Your chats</span> <small>2 matches</small></div>
      </div>
    ),
    title: "Useful search",
    body: "Search the web through bundled SearXNG and find old conversations with SQLite FTS5—no vector database required.",
  },
  {
    visual: (
      <div className="scene scene-files">
        {["PDF", "DOCX", "XLSX", "CSV", "PNG", "PY"].map((type) => (
          <span key={type}>
            <i /><i /><i />
            <b>{type}</b>
          </span>
        ))}
      </div>
    ),
    title: "Files, not just prompts",
    body: "Work with images, PDFs, Word and Excel documents, CSV files, and source code directly in a chat.",
  },
  {
    visual: (
      <div className="scene scene-people">
        {["Y", "M", "S"].map((initial) => (
          <div key={initial}>
            <span>{initial}</span>
            <i /><i />
            <Lock />
          </div>
        ))}
      </div>
    ),
    title: "One server, personal to everyone",
    body: "Private history, projects, saved memories, and preferences make a shared installation feel like each person’s own app.",
  },
  {
    visual: (
      <div className="scene scene-tools">
        <div className="scene-segments">
          <span>Low</span>
          <span>Medium</span>
          <span>High</span>
        </div>
        <div className="scene-chips">
          <span className="scene-chip"><Plug /> MCP</span>
          <span className="scene-chip"><Globe2 /> Web search</span>
        </div>
      </div>
    ),
    title: "Tools and reasoning included",
    body: "Connect standard MCP servers, use built-in web search, and expose the reasoning controls supported by each local or hosted model.",
  },
  {
    visual: (
      <div className="scene scene-agents">
        <div>
          <span className="scene-live" />
          <b>Add a reading list</b>
          <small>Codex · this server</small>
        </div>
        <div>
          <Check />
          <b>Fix the flaky test</b>
          <small>Claude Code · ssh</small>
        </div>
      </div>
    ),
    title: "A side door to coding agents",
    body: "When useful, admins can run Codex, Claude Code, OpenCode, Pi, Oh My Pi, and Hermes locally or over SSH without leaving the chat app.",
  },
];

const principles = [
  "One portable SQLite file",
  "No OvertChat account required",
  "No usage analytics",
  "Optional local speech and search",
  "Standard MCP support",
  "One-command managed updates",
];

function HomePageShell({ children }: { children: ReactNode }) {
  return (
    <>
      <HomeEffects />
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
              <svg
                className="hero-underline"
                viewBox="0 0 100 10"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <path d="M1 6.5 C 22 1.5, 44 1.5, 62 4.5 S 90 8.5, 99 3.5" pathLength={1} />
              </svg>
            </span>
          </h1>
          <p className="hero-lede">
            OvertChat brings local and hosted models into one polished,
            self-hosted app. You decide where requests go; accounts,
            conversations, files, and memories stay on your server.
          </p>
          <div className="button-row">
            <Link className="button button-primary" href="/setup/">
              Set up a server
              <ArrowRight aria-hidden="true" />
            </Link>
            <a
              className="button"
              href="https://github.com/yoloyash/overtchat"
            >
              <GitHubIcon aria-hidden="true" />
              View on GitHub
            </a>
          </div>
          <div className="hero-facts" aria-label="Project highlights">
            <span><Globe2 aria-hidden="true" /> Use it from anywhere</span>
            <span><Users aria-hidden="true" /> Multi-user</span>
            <span><AudioLines aria-hidden="true" /> Realtime local voice</span>
          </div>
        </div>
        <HeroDemo modelIcon={<BrandIcon id="qwen" />} />
        <a
          className="hero-scroll-cue"
          href={`#${HOME_SECTION_IDS.sharing}`}
        >
          Continue
          <ArrowDown aria-hidden="true" />
        </a>
      </section>

      <section className="trust-strip" aria-label="Supported deployment targets">
        <div className="site-container trust-strip-inner">
          <span className="trust-strip-label">Bring your models</span>
          <div
            className="trust-strip-track"
            role="region"
            aria-label="Supported model endpoints"
            tabIndex={0}
          >
            {[false, true].map((repeat) => (
              <ul key={String(repeat)} aria-hidden={repeat || undefined}>
                {endpoints.map((endpoint) => (
                  <li key={endpoint.name}>
                    {endpoint.icon && <BrandIcon id={endpoint.icon} />}
                    {endpoint.name}
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </div>
      </section>

      <section
        className="site-section site-container"
        id={HOME_SECTION_IDS.sharing}
      >
        <div className="section-heading" data-reveal="">
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
        <AccessDemo />
        <div className="steps-grid" data-reveal="stagger">
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
        <div className="voice-showcase" data-reveal="">
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
          <VoiceDemo />
        </div>
      </section>

      <section
        className="site-section site-container"
        id={HOME_SECTION_IDS.features}
      >
        <div className="section-heading" data-reveal="">
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
        <div className="feature-grid" data-reveal="stagger">
          {features.map(({ visual, title, body }) => (
            <article className="feature-card" key={title} data-glow="">
              <div className="feature-visual" aria-hidden="true">{visual}</div>
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
          <div className="architecture-copy" data-reveal="">
            <p className="eyebrow">What “yours” means</p>
            <h2 className="section-title">No mystery cloud in the middle.</h2>
            <p className="section-lede">
              Accounts, conversations, files, memories, and settings stay in
              one portable SQLite database on your server. Model requests go
              directly to the endpoints you configure. To reach your server from
              anywhere, the optional OvertChat Cloud gives it an address that
              forwards encrypted traffic without being able to read it.
            </p>
            <a
              className="text-link"
              href="https://github.com/yoloyash/overtchat/blob/main/docs/deploy.md"
            >
              Read the deployment guide <ArrowRight aria-hidden="true" />
            </a>
          </div>
          <div className="architecture-card" data-reveal="" data-glow="">
            <div className="architecture-diagram" aria-hidden="true">
              <div className="architecture-node architecture-client">
                <Globe2 />
                <span>Web + desktop + mobile</span>
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
        data-reveal="stagger"
      >
        <div className="client-card client-card-web">
          <div className="client-visual">
            <div className="client-window">
              <div className="client-window-bar" aria-hidden="true"><i /><i /><i /></div>
              {/* eslint-disable-next-line @next/next/no-img-element -- static export, no image optimizer */}
              <img
                src={sitePath("/media/desktop-chat.webp")}
                alt="OvertChat on a desktop: a web-search answer with numbered sources, beside projects and recent chats"
                width={1600}
                height={1025}
                loading="lazy"
                decoding="async"
              />
            </div>
          </div>
          <div className="client-card-body">
            <p className="eyebrow">At your desk</p>
            <h2>Open it. Pick up where you left off.</h2>
            <p>
              Use OvertChat in your browser or download the app for macOS or
              Linux. Connect to your existing server and pick up the same chats,
              projects, and files.
            </p>
            <Link href="/downloads/" className="text-link">
              Download for macOS or Linux <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </div>
        <div className="client-card client-card-mobile">
          <div className="client-visual">
            <div className="client-phone">
              {/* eslint-disable-next-line @next/next/no-img-element -- static export, no image optimizer */}
              <img
                src={sitePath("/media/android-chat.webp")}
                alt="OvertChat for Android: a conversation with a local model in dark mode"
                width={720}
                height={1584}
                loading="lazy"
                decoding="async"
              />
            </div>
          </div>
          <div className="client-card-body">
            <p className="eyebrow">Away from the desk</p>
            <h2>Same server. Smaller screen.</h2>
            <p>
              The native Android and iOS apps connect straight to OvertChat.
              Chats, attachments, projects, search, and voice follow without
              moving into a separate mobile backend.
            </p>
            <div className="store-links">
              <a
                href={GOOGLE_PLAY_URL}
                className="text-link"
              >
                Get it on Google Play <ArrowRight aria-hidden="true" />
              </a>
              <a
                href={APP_STORE_URL}
                className="text-link"
              >
                Get it on the App Store <ArrowRight aria-hidden="true" />
              </a>
            </div>
          </div>
        </div>
      </section>

      <section
        className="site-section site-container quick-start-section"
        id={HOME_SECTION_IDS.quickStart}
      >
        <div className="quick-start-copy" data-reveal="">
          <p className="eyebrow">Set up a server</p>
          <h2 className="section-title">One command between here and yours.</h2>
          <p className="section-lede">
            The guided setup handles Docker, secrets, updates, and optional
            search, speech, and Agent Connections. Bring a model endpoint; the
            first account becomes the administrator.
          </p>
          <div className="button-row">
            <Link className="button" href="/setup/">
              Follow the setup guide
              <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </div>
        <InstallSwitcher />
      </section>

      <section
        className="site-section site-container release-cta"
        id={HOME_SECTION_IDS.releases}
        data-reveal=""
      >
        <div>
          <p className="eyebrow">Still becoming yours</p>
          <h2 className="section-title">Built in public. Shipped in the open.</h2>
        </div>
        <div className="release-cta-copy">
          <p className="section-lede">
            Follow every stable web, desktop, and mobile release in one chronological log,
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
