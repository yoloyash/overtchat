"use client";

import { Check, Plus } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { CopyButton } from "@/components/CopyButton";
import { INSTALL_COMMANDS } from "@/components/InstallCommand";

type Platform = keyof typeof INSTALL_COMMANDS;

const PLATFORMS: Array<{ id: Platform; label: string; prompt: string }> = [
  { id: "unix", label: "macOS / Linux", prompt: "$" },
  { id: "windows", label: "Windows", prompt: ">" },
];

const subscribeToNothing = () => () => {};

/** The install command for the visitor's system, with the other one a tab away. */
export function InstallSwitcher() {
  const detected = useSyncExternalStore<Platform>(
    subscribeToNothing,
    () => (/Windows/i.test(navigator.userAgent) ? "windows" : "unix"),
    () => "unix",
  );
  const [choice, setChoice] = useState<Platform | null>(null);
  const platform = PLATFORMS.find((entry) => entry.id === (choice ?? detected))!;
  const command = INSTALL_COMMANDS[platform.id];

  return (
    <div className="code-window" data-reveal="">
      <div className="code-window-header">
        <div className="window-dots" aria-hidden="true"><span /><span /><span /></div>
        <div className="code-tabs" role="group" aria-label="Operating system">
          {PLATFORMS.map((entry) => (
            <button
              type="button"
              key={entry.id}
              aria-pressed={entry.id === platform.id}
              onClick={() => setChoice(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <CopyButton value={command} />
      </div>
      <pre tabIndex={0} aria-label="Quick start commands">
        <code key={platform.id}>
          <span className="code-prompt" aria-hidden="true">{platform.prompt}</span>
          {command}
          <span className="code-caret" aria-hidden="true" />
        </code>
      </pre>
      <ul className="code-window-footer" aria-label="What the guided setup handles">
        <li><Check aria-hidden="true" /> Docker</li>
        <li><Check aria-hidden="true" /> Secrets</li>
        <li><Check aria-hidden="true" /> Updates</li>
        <li data-optional=""><Plus aria-hidden="true" /> Search</li>
        <li data-optional=""><Plus aria-hidden="true" /> Speech</li>
        <li data-optional=""><Plus aria-hidden="true" /> Agent Connections</li>
      </ul>
    </div>
  );
}
