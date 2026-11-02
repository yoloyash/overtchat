import { CopyButton } from "@/components/CopyButton";

const commands = {
  unix: "curl -fsSL https://overtchat.com/install | sh",
  windows: "irm https://overtchat.com/install.ps1 | iex",
};

export function InstallCommand({ platform = "unix" }: { platform?: keyof typeof commands }) {
  const command = commands[platform];
  return (
    <div className="code-window">
      <div className="code-window-header">
        <div className="window-dots" aria-hidden="true"><span /><span /><span /></div>
        <span>{platform === "windows" ? "PowerShell" : "terminal"}</span>
        <CopyButton value={command} />
      </div>
      <pre tabIndex={0} aria-label="Quick start commands">
        <code>{command}</code>
      </pre>
    </div>
  );
}
