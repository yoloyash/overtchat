import {
  ArrowUp,
  ChevronDown,
  ChevronUp,
  FileText,
  Folder,
  Globe,
  Mic,
  PanelLeft,
  Paperclip,
  Pencil,
  Search,
  User,
} from "lucide-react";

export function HeroVignette() {
  return (
    <div
      className="vignette"
      role="img"
      aria-label="Illustration closely matching the OvertChat conversation interface"
    >
      <div className="vignette-glow" aria-hidden="true" />
      <div className="vignette-window" aria-hidden="true">
        <aside className="vignette-sidebar">
          <div className="vignette-sidebar-header">
            <div className="vignette-brand">overtchat</div>
            <PanelLeft />
          </div>

          <div className="vignette-sidebar-nav">
            <div className="vignette-sidebar-action">
              <Pencil />
              <span>New chat</span>
            </div>
            <div className="vignette-sidebar-action">
              <Search />
              <span>Search chats</span>
              <kbd>⌘ K</kbd>
            </div>
          </div>

          <div className="vignette-sidebar-label">Projects</div>
          <div className="vignette-project">
            <Folder />
            <span>OvertChat launch</span>
            <ChevronDown />
          </div>
          <div className="vignette-project-thread is-active">
            Project architecture
          </div>

          <div className="vignette-sidebar-label">Today</div>
          <div className="vignette-thread">Weekend reading</div>
          <div className="vignette-thread">Model comparison</div>

          <div className="vignette-sidebar-spacer" />
          <div className="vignette-profile">
            <span><User /></span>
            <div>
              <strong>Yash</strong>
              <small>yash@example.com</small>
            </div>
            <ChevronUp />
          </div>
        </aside>

        <section className="vignette-chat">
          <header className="vignette-chat-header">
            <div className="vignette-model-picker">
              <span className="vignette-model-mark">G</span>
              <strong>Gemini 2.5 Pro</strong>
              <ChevronDown />
            </div>
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
                <span><Globe /> 1</span>
                <span><FileText /> 2</span>
              </div>
            </div>
          </div>

          <div className="vignette-composer">
            <span className="vignette-placeholder">Message…</span>
            <div className="vignette-composer-actions">
              <span className="vignette-composer-icon"><Paperclip /></span>
              <span className="vignette-search-toggle"><Globe /> Search</span>
              <span className="vignette-composer-spacer" />
              <span className="vignette-composer-icon"><Mic /></span>
              <span className="vignette-send"><ArrowUp /></span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
