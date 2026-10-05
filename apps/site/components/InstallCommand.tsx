import { CopyButton } from "@/components/CopyButton";

const command = "curl -fsSL https://overtchat.com/install | sh";

export function InstallCommand() {
  return (
    <div className="code-window">
      <div className="code-window-header">
        <div className="window-dots" aria-hidden="true"><span /><span /><span /></div>
        <span>terminal</span>
        <CopyButton value={command} />
      </div>
      <pre tabIndex={0} aria-label="Quick start commands">
        <code>{command}</code>
      </pre>
    </div>
  );
}
