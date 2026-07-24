import type { Metadata } from "next";
import { createPageMetadata } from "@/lib/metadata";

export const metadata: Metadata = createPageMetadata({
  title: "Privacy Policy",
  description:
    "How the OvertChat mobile client handles data, permissions, and crash reports.",
  path: "/privacy/",
});

export default function PrivacyPage() {
  return (
    <main
      className="site-main legal-page"
      id="main-content"
      tabIndex={-1}
    >
      <article className="legal-document site-container">
        <header className="legal-header">
          <p className="eyebrow">Legal</p>
          <h1 className="page-title">Privacy Policy</h1>
          <p className="legal-updated">Last updated 23 July 2026</p>
          <p className="page-lede">
            OvertChat is an open-source chat client that connects to a server you
            choose. The short version: the app is a client, we do not run a
            server for you, and the server you point it at is governed by whoever
            operates it—which may be you.
          </p>
        </header>

        <div className="legal-content">
          <section>
            <h2>What OvertChat is</h2>
            <p>
              The mobile app is a thin client. On first launch you enter a server
              URL—usually one you self-host, but it can be any compatible
              deployment. Your chats, messages, projects, and uploaded files live
              on that server, not on our infrastructure. We do not operate a
              hosted backend.
            </p>
          </section>

          <section>
            <h2>What the app sends to your server</h2>
            <p>
              Except for crash reporting described below, the app communicates
              with the server URL you configured, over HTTPS or HTTP, in order
              to:
            </p>
            <ul>
              <li>
                sign you in and keep you signed in (a session cookie stored
                locally on your device),
              </li>
              <li>
                send your messages, attachments, and voice dictation audio to
                your server so it can talk to a language model on your behalf,
              </li>
              <li>
                load chat history, projects, and settings you have created on
                that server.
              </li>
            </ul>
            <p>
              How that server stores, retains, or shares that data is governed by
              whoever administers it—that is a separate policy from this one. If
              you self-host, you are that administrator.
            </p>
          </section>

          <section>
            <h2>What is stored on your device</h2>
            <ul>
              <li>The server URL you entered (in Android secure storage).</li>
              <li>Your auth session cookie (in Android secure storage).</li>
              <li>
                Your appearance, chat font, and web-search toggle preferences.
              </li>
              <li>
                Cached image previews and temporary copies of files you select,
                which the operating system may retain in the app cache until
                cleanup or uninstall.
              </li>
            </ul>
            <p>
              Uninstalling the app removes all of the above. You can also clear
              the server URL from inside the app to start over.
            </p>
          </section>

          <section>
            <h2>What we collect</h2>
            <p>
              We—the publisher of the app—do not operate a hosted OvertChat
              backend, and the app does not include usage analytics or
              advertising SDKs.
            </p>
            <p>
              We receive limited crash diagnostics through Sentry when crash
              reporting is configured in the distributed app, as described
              next.
            </p>
          </section>

          <section>
            <h2>Crash reporting (Sentry)</h2>
            <p>
              When the app encounters an unhandled error or crashes, it may send
              a diagnostic report to{" "}
              <a href="https://sentry.io/security/">Sentry</a>, a third-party
              error monitoring service, so we can fix bugs. A report may
              contain:
            </p>
            <ul>
              <li>the JavaScript error and stack trace,</li>
              <li>device model, OS version, and app version,</li>
              <li>
                a randomly generated install identifier (not tied to your name
                or email).
              </li>
              <li>
                recent network request metadata, which may include the
                configured server URL, HTTP method, and status code.
              </li>
            </ul>
            <p>
              Sentry is initialized with default PII collection disabled. The
              app does not intentionally attach chat or attachment contents,
              session cookies, API keys, or other credentials to crash reports.
              Because reports capture diagnostic context, we do not make an
              absolute guarantee that user-provided data can never appear in an
              error message.
            </p>
            <p>
              Sentry is governed by its own{" "}
              <a href="https://sentry.io/privacy/">privacy notice</a> and{" "}
              <a href="https://sentry.io/security/">security information</a>. If
              you would prefer no crash reports leave your device, you can build
              the app from source without the Sentry DSN configured.
            </p>
          </section>

          <section>
            <h2>Permissions and why we ask for them</h2>
            <ul>
              <li>
                <strong>Microphone</strong>—used only when you tap the dictation
                button. The recording is sent to your configured server for
                transcription when you stop recording and is deleted from the
                app cache after transcription completes.
              </li>
              <li>
                <strong>Camera</strong>—used only when you choose “Take Photo” to
                attach an image to a message.
              </li>
              <li>
                <strong>Photos / Storage</strong>—used only when you pick an image
                or document to attach to a message.
              </li>
              <li>
                <strong>Foreground Service / Media Playback</strong>—used so
                audio playback (text-to-speech) does not cut off when you switch
                apps.
              </li>
            </ul>
            <p>
              None of these permissions transmit data simply by being granted.
              Data selected through them leaves the device only when you choose
              an app action that uses it—for example, selecting an attachment
              uploads it to your server, and stopping dictation sends the
              recording for transcription. Crash diagnostics are a separate
              data flow to Sentry, described above.
            </p>
          </section>

          <section>
            <h2>Children</h2>
            <p>
              OvertChat is not directed at children under 13. We do not knowingly
              collect personal information from children. Crash reporting
              handles limited technical diagnostics as described above.
            </p>
          </section>

          <section>
            <h2>Changes to this policy</h2>
            <p>
              If we change this policy, we will update the “Last updated” date at
              the top of this page. The change history is visible on{" "}
              <a href="https://github.com/yoloyash/overtchat/commits/main/apps/site/app/privacy/page.tsx">
                GitHub
              </a>.
            </p>
          </section>

          <section>
            <h2>Contact</h2>
            <p>
              Questions or concerns? Open an issue at{" "}
              <a href="https://github.com/yoloyash/overtchat/issues">
                github.com/yoloyash/overtchat/issues
              </a>.
            </p>
          </section>

          <p className="legal-closing">
            OvertChat is open source under the MIT license. Source code is at{" "}
            <a href="https://github.com/yoloyash/overtchat">
              github.com/yoloyash/overtchat
            </a>.
          </p>
        </div>
      </article>
    </main>
  );
}
