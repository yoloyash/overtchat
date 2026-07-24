import { MODEL_BRAND_ICONS } from "@overtchat/shared";
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

const qwenIcon = MODEL_BRAND_ICONS.qwen;

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
              <span className="vignette-model-mark">
                <svg viewBox={qwenIcon.viewBox} fill="currentColor">
                  {qwenIcon.paths.map((path, index) => (
                    <path
                      key={index}
                      d={path.d}
                      fillRule={path.fillRule}
                      clipRule={path.fillRule}
                    />
                  ))}
                </svg>
              </span>
              <strong>Qwen 3.6 27B (Q6)</strong>
              <ChevronDown />
            </div>
          </header>

          <div className="vignette-messages">
            <div className="vignette-message vignette-message-user">
              How do hosted and local models differ for privacy?
            </div>
            <div className="vignette-tool">
              <Search />
              <span>Searched 5 sources</span>
              <span className="vignette-tool-time">1.4s</span>
            </div>
            <div className="vignette-message vignette-message-assistant">
              <p>Mostly in where requests go:</p>
              <ul>
                <li>A hosted model receives prompts at its API</li>
                <li>A local model can process them on your hardware</li>
                <li>OvertChat stores chat history on your server</li>
              </ul>
              <p>You choose the endpoint for each conversation.</p>
              <div className="vignette-citations">
                <span><Globe /> ollama.com</span>
                <span><FileText /> openai.com</span>
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
