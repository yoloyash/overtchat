import { FileText, Globe2, Paperclip, Search, SendHorizontal } from "lucide-react";

export function HeroVignette() {
  return (
    <div
      className="vignette"
      role="img"
      aria-label="Illustration of the OvertChat conversation interface"
    >
      <div className="vignette-glow" aria-hidden="true" />
      <div className="vignette-window" aria-hidden="true">
        <aside className="vignette-sidebar">
          <div className="vignette-brand">overtchat</div>
          <button type="button" tabIndex={-1} className="vignette-new-chat">
            <span>+</span> New chat
          </button>
          <div className="vignette-sidebar-label">Recent</div>
          <div className="vignette-thread is-active">Project architecture</div>
          <div className="vignette-thread">Weekend reading</div>
          <div className="vignette-thread">Model comparison</div>
          <div className="vignette-sidebar-spacer" />
          <div className="vignette-profile">
            <span>Y</span>
            <div>
              <strong>Self-hosted</strong>
              <small>Connected</small>
            </div>
          </div>
        </aside>
        <section className="vignette-chat">
          <header className="vignette-chat-header">
            <div>
              <strong>Project architecture</strong>
              <span>Gemini 2.5 Pro</span>
            </div>
            <span className="vignette-status">Private</span>
          </header>
          <div className="vignette-messages">
            <div className="vignette-message vignette-message-user">
              Give me the practical tradeoffs. Keep it concise.
            </div>
            <div className="vignette-tool">
              <Search />
              <span>Searched 6 sources</span>
              <span className="vignette-tool-time">1.8s</span>
            </div>
            <div className="vignette-message vignette-message-assistant">
              <p>
                The simple version: keep the server boundary boring. One app,
                one SQLite file, and a small resume buffer.
              </p>
              <ul>
                <li>Less infrastructure to operate</li>
                <li>Backups stay portable</li>
                <li>Local and hosted models use the same path</li>
              </ul>
              <div className="vignette-citations">
                <span><Globe2 /> 1</span>
                <span><FileText /> 2</span>
              </div>
            </div>
          </div>
          <div className="vignette-composer">
            <span className="vignette-placeholder">Ask anything…</span>
            <div className="vignette-composer-actions">
              <Paperclip />
              <span className="vignette-model">Gemini 2.5 Pro</span>
              <span className="vignette-send"><SendHorizontal /></span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
