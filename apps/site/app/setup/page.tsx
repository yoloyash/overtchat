import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, Server } from "lucide-react";
import { InstallCommand } from "@/components/InstallCommand";
import { createPageMetadata } from "@/lib/metadata";

export const metadata: Metadata = createPageMetadata({
  title: "Set up a server",
  description:
    "Set up your own OvertChat server on Linux or macOS. Install with the guided setup, connect your models, then sign in from the web, desktop, or mobile app.",
  path: "/setup/",
});

export default function SetupPage() {
  return (
    <main className="site-main" id="main-content" tabIndex={-1}>
      <section className="page-hero site-container">
        <div>
          <p className="eyebrow">Self-host OvertChat</p>
          <h1 className="page-title">Make it yours.</h1>
        </div>
        <div>
          <p className="page-lede">
            Set up OvertChat once on a computer you control. Connect your models,
            then use the same server from your browser, desktop, or phone.
          </p>
          <Link className="text-link" href="/downloads/">
            Already have a server? Get the app <ArrowRight aria-hidden="true" />
          </Link>
        </div>
      </section>

      <div className="site-container setup-layout">
        <aside className="setup-requirements" aria-labelledby="requirements-title">
          <Server className="download-icon" aria-hidden="true" />
          <h2 id="requirements-title">Before you start</h2>
          <ul>
            <li><Check aria-hidden="true" /><span>A Linux computer or Mac that stays on while you use OvertChat.</span></li>
            <li><Check aria-hidden="true" /><span>A local model server, such as Ollama or vLLM, or a hosted model provider.</span></li>
            <li><Check aria-hidden="true" /><span>Access to a terminal on the computer that will run your server.</span></li>
          </ul>
          <p>Linux supports x64 and ARM64. Macs support Apple Silicon and Intel.</p>
          <p>
            On macOS, install and start <a href="https://docs.docker.com/desktop/setup/install/mac-install/">Docker Desktop</a> first.
            On Linux, setup can install Docker for you.
          </p>
        </aside>

        <ol className="setup-steps" aria-label="Server setup steps">
          <li>
            <span className="setup-step-number" aria-hidden="true">01</span>
            <div>
              <h2>Run the installer</h2>
              <p>
                Open a terminal on your server computer and paste this command.
                On a Mac, run it as your normal user while logged in to the desktop.
              </p>
              <InstallCommand />
              <p className="setup-step-note">
                The guided setup configures Docker, generates secrets, and manages updates.
                You don’t need to edit an environment file.
              </p>
            </div>
          </li>
          <li>
            <span className="setup-step-number" aria-hidden="true">02</span>
            <div>
              <h2>Choose how you’ll connect</h2>
              <p>
                Follow the prompts to use OvertChat on this computer, on your home
                network, or remotely. For phones and other computers at home,
                choose your home network.
              </p>
              <p>
                For private remote access, install and connect Tailscale on your
                server first, then choose the Tailscale option. Advanced setup
                supports your own HTTPS address and reverse proxy.
              </p>
              <p>
                Search, speech, and coding-agent connections are optional.
                You can change these choices later with <code>overtchat setup</code>.
              </p>
            </div>
          </li>
          <li>
            <span className="setup-step-number" aria-hidden="true">03</span>
            <div>
              <h2>Open your server & connect a model</h2>
              <p>
                Open the address printed at the end of setup. Create the first
                account to become the administrator, then add your local model
                endpoint or hosted provider in the web app.
              </p>
              <p>
                Add accounts for other people in Settings → Users. Share your
                server address so they can sign in with their own account.
              </p>
            </div>
          </li>
          <li>
            <span className="setup-step-number" aria-hidden="true">04</span>
            <div>
              <h2>Take your chats with you</h2>
              <p>
                Keep using your browser, or get the macOS, Linux, Android, or iOS
                app. Enter the same server address and sign in.
                On another device, use an address it can reach, not localhost.
              </p>
              <Link className="button button-primary" href="/downloads/">
                Download an app <ArrowRight aria-hidden="true" />
              </Link>
            </div>
          </li>
        </ol>
      </div>

      <section className="site-container download-more" aria-label="Server help">
        <div>
          <h2>Keep it running</h2>
          <p>Run <code>overtchat status</code> to check your server,
            <code> overtchat update</code> to update it, or
            <code> overtchat setup</code> to change your configuration.</p>
        </div>
        <div>
          <h2>Need more detail?</h2>
          <p>The operator guide covers networking, speech, backups, updates,
            and troubleshooting.</p>
          <a className="text-link" href="https://github.com/yoloyash/overtchat/blob/main/docs/deploy.md">
            Read the operator guide on GitHub <ArrowRight aria-hidden="true" />
          </a>
        </div>
      </section>
    </main>
  );
}
