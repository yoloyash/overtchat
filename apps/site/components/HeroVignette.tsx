import { MODEL_BRAND_ICONS } from "@overtchat/shared";
import {
  ArrowUp,
  Bot,
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
      aria-label="OvertChat conversation interface with personal projects and Codex and Claude Code agent workspaces"
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
            <span>Household</span>
            <ChevronDown />
          </div>
          <div className="vignette-project-thread is-active">
            Weeknight meals
          </div>

          <div className="vignette-sidebar-label">Agent workspaces</div>
          <div className="vignette-agent-workspace">
            <Bot />
            <span>OvertChat</span>
            <small>Codex</small>
          </div>
          <div className="vignette-agent-workspace">
            <Bot />
            <span>Notes</span>
            <small>Claude Code</small>
          </div>

          <div className="vignette-sidebar-label">Today</div>
          <div className="vignette-thread">Homework helper</div>
          <div className="vignette-thread">Weekend plans</div>

          <div className="vignette-sidebar-spacer" />
          <div className="vignette-profile">
            <span><User /></span>
            <div>
              <strong>Maya</strong>
              <small>maya@home</small>
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
              <strong>Qwen 3.8 27B</strong>
              <ChevronDown />
            </div>
          </header>

          <div className="vignette-messages">
            <div className="vignette-message vignette-message-user">
              Plan a vegetarian dinner for six and make a shopping list.
            </div>
            <div className="vignette-tool">
              <Search />
              <span>Searched 4 recipes</span>
              <span className="vignette-tool-time">1.2s</span>
            </div>
            <div className="vignette-message vignette-message-assistant">
              <p>Here’s a low-stress menu everyone can share:</p>
              <ul>
                <li>Roasted tomato and chickpea pasta</li>
                <li>Arugula salad with lemon dressing</li>
                <li>Garlic bread and berry crumble</li>
              </ul>
              <p>I grouped the shopping list by aisle below.</p>
              <div className="vignette-citations">
                <span><Globe /> 4 sources</span>
                <span><FileText /> Shopping list</span>
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
