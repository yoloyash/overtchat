"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowUp, Command, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { AgentSlashCommand } from "@/lib/agents/types";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";

function slashQuery(value: string): string | null {
  const match = /^\/([a-z0-9-]*)$/iu.exec(value);
  return match ? match[1].toLowerCase() : null;
}

function commandSource(source: AgentSlashCommand["source"]): string {
  return source === "extension"
    ? "Extension"
    : source === "prompt"
      ? "Prompt"
      : "Skill";
}

export function AgentComposer({
  commands,
  running,
  pending,
  disabled,
  onSubmit,
  onStop,
}: {
  commands: AgentSlashCommand[];
  running: boolean;
  pending: boolean;
  disabled: boolean;
  onSubmit: (message: string) => void;
  onStop: () => void;
}) {
  const [input, setInput] = useState("");
  const [dismissedDraft, setDismissedDraft] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const listboxId = useId();
  const optionIdPrefix = useId();

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [input]);

  const query = slashQuery(input);
  const filteredCommands = useMemo(() => {
    if (query === null) return [];
    if (!query) return commands;
    return commands.filter((command) =>
      [command.name, command.description ?? "", command.source]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [commands, query]);
  const menuOpen =
    query !== null &&
    input !== dismissedDraft &&
    filteredCommands.length > 0;
  const activeRow = Math.min(
    activeIndex,
    Math.max(0, filteredCommands.length - 1),
  );

  function selectCommand(command: AgentSlashCommand) {
    setInput(`/${command.name} `);
    setDismissedDraft(null);
    setActiveIndex(0);
    requestAnimationFrame(() => {
      const element = textareaRef.current;
      element?.focus({ preventScroll: true });
      element?.setSelectionRange(element.value.length, element.value.length);
    });
  }

  function submit() {
    const message = input.trim();
    if (!message || pending || disabled) return;
    onSubmit(message);
    setInput("");
    setDismissedDraft(null);
    setActiveIndex(0);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (menuOpen) {
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissedDraft(input);
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        setActiveIndex(
          (activeRow + delta + filteredCommands.length) %
            filteredCommands.length,
        );
        return;
      }
      if (
        (event.key === "Enter" && !event.shiftKey) ||
        (event.key === "Tab" && !event.shiftKey)
      ) {
        event.preventDefault();
        selectCommand(filteredCommands[activeRow]);
        return;
      }
    }
    if (event.key === "Escape" && running) {
      event.preventDefault();
      onStop();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className="relative">
      {menuOpen && (
        <div
          className={cn(
            "absolute bottom-full left-0 z-30 mb-2 w-full max-w-lg overflow-hidden rounded-xl border bg-popover text-sm text-popover-foreground shadow-md",
            motionClasses.palette,
          )}
        >
          <div
            id={listboxId}
            role="listbox"
            aria-label="Pi commands"
            className="max-h-72 overflow-y-auto p-1.5"
          >
            {filteredCommands.map((command, index) => (
              <button
                key={`${command.source}:${command.name}`}
                id={`${optionIdPrefix}-${index}`}
                type="button"
                role="option"
                aria-selected={index === activeRow}
                onPointerDown={(event) => event.preventDefault()}
                onPointerMove={() => setActiveIndex(index)}
                onClick={() => selectCommand(command)}
                className={cn(
                  "flex min-h-11 w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left motion-colors",
                  index === activeRow && "bg-accent text-accent-foreground",
                )}
              >
                <Command className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    /{command.name}
                  </span>
                  {command.description && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {command.description}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {commandSource(command.source)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-3xl border bg-background px-3.5 pt-3.5 pb-2.5 shadow-sm motion-colors focus-within:border-ring focus-within:ring-1 focus-within:ring-ring">
        <Textarea
          ref={textareaRef}
          rows={1}
          value={input}
          disabled={disabled}
          placeholder="Message Pi or type / for commands"
          className="max-h-48 min-h-10 resize-none border-0 bg-transparent px-1 py-0 shadow-none focus-visible:ring-0 md:text-sm dark:bg-transparent"
          onChange={(event) => {
            setInput(event.target.value);
            setDismissedDraft(null);
            setActiveIndex(0);
          }}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? listboxId : undefined}
          aria-activedescendant={
            menuOpen ? `${optionIdPrefix}-${activeRow}` : undefined
          }
          aria-autocomplete="list"
        />
        <div className="flex h-8 items-center justify-end gap-1">
          {running && (
            <Button
              type="button"
              variant="secondary"
              size="icon-sm"
              className="rounded-full"
              disabled={pending}
              onClick={onStop}
              aria-label="Stop Pi"
              title="Stop Pi"
            >
              <Square className="size-3 fill-current" />
            </Button>
          )}
          <Button
            type="button"
            size="icon-sm"
            className="rounded-full"
            disabled={!input.trim() || pending || disabled}
            onClick={submit}
            aria-label={running ? "Steer Pi" : "Send message"}
            title={running ? "Steer Pi" : "Send message"}
          >
            <ArrowUp />
          </Button>
        </div>
      </div>
    </div>
  );
}
