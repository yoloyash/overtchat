import type { Metadata } from "next";
import Link from "next/link";
import { createPageMetadata } from "@/lib/metadata";

export const metadata: Metadata = createPageMetadata({
  title: "Terms of Service",
  description: "The terms for using OvertChat Cloud.",
  path: "/terms/",
});

export default function TermsPage() {
  return (
    <main
      className="site-main legal-page"
      id="main-content"
      tabIndex={-1}
    >
      <article className="legal-document site-container">
        <header className="legal-header">
          <p className="eyebrow">Legal</p>
          <h1 className="page-title">Terms of Service</h1>
          <p className="legal-updated">Last updated 18 October 2026</p>
          <p className="page-lede">
            These terms apply to OvertChat Cloud, the optional service at
            account.overtchat.com that gives your server a public address. The
            OvertChat software itself is open source under the MIT license, and
            you can use it without an account or these terms.
          </p>
        </header>

        <div className="legal-content">
          <section>
            <h2>Using OvertChat Cloud</h2>
            <p>
              By creating an account you agree to these terms and to our{" "}
              <Link href="/privacy/">Privacy Policy</Link>. You need a Google
              account to sign in, and you must be at least 13 years old, or
              older if your country requires it.
            </p>
            <p>
              OvertChat Cloud is in beta and currently free for a limited number
              of accounts. We may change, limit, or end the service, including
              introducing paid plans. We will give reasonable notice before
              ending the service or charging for an existing free account.
            </p>
          </section>

          <section>
            <h2>Your address</h2>
            <p>
              Each account can have one address, such as{" "}
              <code>name.overtchat.app</code>. Names cannot be changed once
              claimed. We may decline or reclaim names that impersonate others,
              infringe trademarks, or are offensive.
            </p>
            <p>
              If you delete your account, your address stops working. A name that
              was used is held for you for 7 days and then becomes available to
              others.
            </p>
          </section>

          <section>
            <h2>Your server and its content</h2>
            <p>
              You are responsible for your server, the accounts on it, and what
              it serves through your address. Your traffic stays encrypted
              between visitors and your server, so we cannot see or moderate its
              content, and we claim no rights to it.
            </p>
          </section>

          <section>
            <h2>Acceptable use</h2>
            <p>Do not use OvertChat Cloud to:</p>
            <ul>
              <li>break the law or infringe the rights of others,</li>
              <li>host malware, phishing pages, or spam,</li>
              <li>
                attack, overload, or probe the service or other people&apos;s
                systems,
              </li>
              <li>
                get around bandwidth limits, share your connection credential, or
                publish addresses other than your own.
              </li>
            </ul>
            <p>
              OvertChat Cloud is meant for reaching your own OvertChat server.
              Each address has a bandwidth limit, and we may slow or limit
              addresses whose use affects others.
            </p>
          </section>

          <section>
            <h2>Suspension and termination</h2>
            <p>
              We may suspend or turn off an address that breaks these terms or
              puts the service or others at risk, and will tell you why where we
              can. You can stop using the service and delete your account at any
              time from account.overtchat.com.
            </p>
          </section>

          <section>
            <h2>No warranty</h2>
            <p>
              OvertChat Cloud is provided “as is” and “as available”, without
              warranties of any kind. We do not guarantee that it will be
              uninterrupted, error-free, or always reachable. Keep your own
              backups, and do not rely on the service for anything critical.
            </p>
          </section>

          <section>
            <h2>Limitation of liability</h2>
            <p>
              To the extent the law allows, we are not liable for any indirect,
              incidental, or consequential damages, or for lost data, profits, or
              revenue, arising from your use of OvertChat Cloud. Our total
              liability for any claim is limited to the amount you paid us for
              the service in the 12 months before the claim.
            </p>
          </section>

          <section>
            <h2>Changes to these terms</h2>
            <p>
              If we change these terms, we will update the “Last updated” date
              at the top of this page and, for significant changes, tell account
              holders in advance. The change history is visible on{" "}
              <a href="https://github.com/yoloyash/overtchat/commits/main/apps/site/app/terms/page.tsx">
                GitHub
              </a>
              .
            </p>
          </section>

          <section>
            <h2>Contact</h2>
            <p>
              Questions about these terms? Email{" "}
              <a href="mailto:support@overtchat.com">support@overtchat.com</a>.
            </p>
          </section>
        </div>
      </article>
    </main>
  );
}
