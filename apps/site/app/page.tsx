import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  Boxes,
  Braces,
  Check,
  Database,
  Globe2,
  HardDrive,
  MessageSquareText,
  Search,
  ShieldCheck,
  Smartphone,
  Volume2,
  WandSparkles,
} from "lucide-react";
import Link from "next/link";
import { CopyButton } from "@/components/CopyButton";
import { GitHubIcon } from "@/components/GitHubIcon";
import { HeroVignette } from "@/components/HeroVignette";

const quickStart = `git clone https://github.com/yoloyash/overtchat
cd overtchat
cp .env.example .env
echo "BETTER_AUTH_SECRET=$(openssl rand -hex 32)" >> .env
echo "SEARXNG_SECRET=$(openssl rand -hex 32)" >> .env
docker compose up -d --build`;

const steps: Array<{
  number: string;
  title: string;
  body: string;
}> = [
  {
    number: "01",
    title: "Start your server",
    body: "Run one Docker Compose command. OvertChat brings the app, SQLite database, resume buffer, web search, and text-to-speech.",
  },
  {
    number: "02",
    title: "Connect your models",
    body: "Add a hosted provider or an OpenAI-compatible local endpoint. The setup wizard checks the connection before you begin.",
  },
  {
    number: "03",
    title: "Chat from anywhere",
    body: "Use the responsive web app or connect the native mobile client to the server you control. Your data stays there.",
  },
];

const features: Array<{
  icon: LucideIcon;
  title: string;
  body: string;
}> = [
  {
    icon: MessageSquareText,
    title: "Fast, persistent chat",
    body: "Streaming replies, resumable generations, editable messages, projects, and automatically titled history.",
  },
  {
    icon: Search,
    title: "Useful search",
    body: "Search the web through bundled SearXNG and find old conversations with SQLite FTS5—no vector database required.",
  },
  {
    icon: HardDrive,
    title: "Rich attachments",
    body: "Work with images, PDFs, Word and Excel documents, CSV files, and source code directly in a conversation.",
  },
  {
    icon: Volume2,
    title: "Voice, both ways",
    body: "Bundled text-to-speech works out of the box. Optional local speech-to-text keeps dictation on your hardware.",
  },
  {
    icon: WandSparkles,
    title: "Model flexibility",
    body: "Use Anthropic, Gemini, OpenAI, Groq, OpenRouter, xAI, Mistral, DeepSeek, Ollama, vLLM, llama.cpp, and more.",
  },
  {
    icon: ShieldCheck,
    title: "Private by construction",
    body: "No analytics, advertising SDK, hosted account system, or telemetry pipeline. The server belongs to you.",
  },
];

const principles = [
  "One application process",
  "One portable SQLite file",
  "A small Redis resume buffer",
  "No RAG or embeddings stack",
  "No plugin runtime",
  "No hosted control plane",
];

export default function HomePage() {
  return (
    <main className="site-main">
      <section className="hero site-container">
        <div className="hero-copy">
          <p className="eyebrow">Open source · self-hosted</p>
          <h1 className="display-title">Chat without the sprawl.</h1>
          <p className="hero-lede">
            OvertChat is a lightweight chat client for the language models you
            already use. One Compose command, a focused interface, and data that
            stays on your server.
          </p>
          <div className="button-row">
            <a
              className="button button-primary"
              href="https://github.com/yoloyash/overtchat"
            >
              <GitHubIcon aria-hidden="true" />
              View on GitHub
            </a>
            <a className="button" href="#quick-start">
              Quick start
              <ArrowRight aria-hidden="true" />
            </a>
          </div>
          <div className="hero-facts" aria-label="Project highlights">
            <span><Check /> Zero telemetry</span>
            <span><Check /> MIT licensed</span>
            <span><Check /> Web + mobile</span>
          </div>
        </div>
        <HeroVignette />
      </section>

      <section className="trust-strip" aria-label="Supported deployment targets">
        <div className="site-container trust-strip-inner">
          <span>Hosted APIs</span>
          <span>Ollama</span>
          <span>vLLM</span>
          <span>llama.cpp</span>
          <span>OpenAI-compatible</span>
        </div>
      </section>

      <section className="site-section site-container" id="how-it-works">
        <div className="section-heading">
          <div>
            <p className="eyebrow">How it works</p>
            <h2 className="section-title">Your server is the product.</h2>
          </div>
          <p className="section-lede">
            OvertChat does not proxy your conversations through somebody else’s
            cloud. You operate one compact stack and choose exactly which model
            endpoints it can reach.
          </p>
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

      <section className="site-section site-container" id="features">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">What’s in the box</p>
            <h2 className="section-title">The useful parts, already wired up.</h2>
          </div>
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

      <section className="site-section architecture-section">
        <div className="site-container architecture-grid">
          <div className="architecture-copy">
            <p className="eyebrow">Deliberately boring infrastructure</p>
            <h2 className="section-title">Easy to understand. Easier to keep.</h2>
            <p className="section-lede">
              There is no distributed services diagram hiding behind the chat
              box. Back up one database file, update one container image, and
              keep operating on your terms.
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
                <div className="architecture-node"><Database /><span>SQLite</span></div>
                <div className="architecture-node"><Braces /><span>Your models</span></div>
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

      <section className="site-section site-container clients-section">
        <div className="client-card client-card-web">
          <span className="client-icon"><Globe2 aria-hidden="true" /></span>
          <p className="eyebrow">On the web</p>
          <h2>Open it and get to work.</h2>
          <p>
            A responsive interface for long conversations, projects, files,
            web research, voice, and every model connected to your server.
          </p>
          <a href="https://github.com/yoloyash/overtchat#quick-start" className="text-link">
            Self-host the web app <ArrowRight aria-hidden="true" />
          </a>
        </div>
        <div className="client-card client-card-mobile">
          <span className="client-icon"><Smartphone aria-hidden="true" /></span>
          <p className="eyebrow">On mobile</p>
          <h2>Your server, in your pocket.</h2>
          <p>
            The native client connects directly to your OvertChat instance.
            Chats and attachments stay on that server—not in a hosted mobile backend.
          </p>
          <a
            href="https://github.com/yoloyash/overtchat/blob/main/docs/android-testing.md"
            className="text-link"
          >
            Get the Android app <ArrowRight aria-hidden="true" />
          </a>
        </div>
      </section>

      <section className="site-section site-container quick-start-section" id="quick-start">
        <div className="quick-start-copy">
          <p className="eyebrow">Quick start</p>
          <h2 className="section-title">From clone to chat in one stack.</h2>
          <p className="section-lede">
            Docker and an LLM endpoint are the only real prerequisites. The
            first account becomes the administrator and the setup wizard handles
            the rest.
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
          <pre><code>{quickStart}</code></pre>
        </div>
      </section>

      <section className="site-section site-container release-cta">
        <div>
          <p className="eyebrow">Built in public</p>
          <h2 className="section-title">See what changed, without digging.</h2>
        </div>
        <div className="release-cta-copy">
          <p className="section-lede">
            Web and mobile releases live in one chronological log, generated
            directly from the project’s GitHub Releases.
          </p>
          <Link className="button button-primary" href="/releases/">
            Browse releases
            <ArrowRight aria-hidden="true" />
          </Link>
        </div>
      </section>
    </main>
  );
}
