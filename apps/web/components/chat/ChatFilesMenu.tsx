"use client";

import { useMemo, type ReactNode } from "react";
import { Menu } from "@base-ui/react/menu";
import type { UIMessage } from "ai";
import { File } from "lucide-react";
import {
  conversationFiles,
  DOCUMENT_TYPE_LABELS,
  type PanelFile,
} from "@overtchat/shared";
import { Button } from "@/components/ui/button";
import { humanMediaLabel } from "@/lib/chat/attachments";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { MediaIcon } from "./attachment-icons";
import { DOCUMENT_ICONS } from "./DocumentCard";
import { useDocumentPanel } from "./DocumentPanelContext";
import { useFilePanel } from "./FilePanelContext";

/** The conversation's outputs and attachments, each opening in the side panel. */
export function ChatFilesMenu({ messages }: { messages: UIMessage[] }) {
  const { outputs, uploads } = useMemo(() => conversationFiles(messages), [messages]);
  const filePanel = useFilePanel();
  const documentPanel = useDocumentPanel();
  const count = outputs.length + uploads.length;
  if (count === 0 || !filePanel || !documentPanel) return null;
  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="max-md:h-10"
            aria-label={count === 1 ? "1 file" : `${count} files`}
            title="Files"
          />
        }
      >
        <File className="size-4" />
        <span className="tabular-nums">{count}</span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={4} className="z-50">
          <Menu.Popup
            className={cn(
              "max-h-[min(28rem,var(--available-height))] w-72 overflow-y-auto rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md outline-none",
              motionClasses.popup,
            )}
          >
            {outputs.length > 0 && (
              <Menu.Group>
                <GroupLabel>Outputs</GroupLabel>
                {outputs.map((output) => {
                  if (output.kind === "file") {
                    return (
                      <FileItem
                        key={output.file.id}
                        file={output.file}
                        onOpen={() => filePanel.open(output.file)}
                      />
                    );
                  }
                  const { document } = output;
                  const Icon = DOCUMENT_ICONS[document.type];
                  return (
                    <Item
                      key={document.id}
                      icon={<Icon className="size-4" />}
                      name={document.title || "Untitled"}
                      label={DOCUMENT_TYPE_LABELS[document.type]}
                      onOpen={() => documentPanel.open(document.toolCallId)}
                    />
                  );
                })}
              </Menu.Group>
            )}
            {outputs.length > 0 && uploads.length > 0 && (
              <Menu.Separator className="mx-1 my-1 h-px bg-border" />
            )}
            {uploads.length > 0 && (
              <Menu.Group>
                <GroupLabel>Uploads</GroupLabel>
                {uploads.map((file) => (
                  <FileItem key={file.id} file={file} onOpen={() => filePanel.open(file)} />
                ))}
              </Menu.Group>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <Menu.GroupLabel className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">
      {children}
    </Menu.GroupLabel>
  );
}

function FileItem({ file, onOpen }: { file: PanelFile; onOpen: () => void }) {
  return (
    <Item
      icon={<MediaIcon mediaType={file.mediaType} filename={file.name} className="size-4" />}
      name={file.name}
      label={fileTypeLabel(file)}
      onOpen={onOpen}
    />
  );
}

function Item({
  icon,
  name,
  label,
  onOpen,
}: {
  icon: ReactNode;
  name: string;
  label: string;
  onOpen: () => void;
}) {
  return (
    <Menu.Item
      onClick={onOpen}
      title={name}
      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none motion-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
    >
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
    </Menu.Item>
  );
}

/** A short type such as "PNG" or "CSV", from the extension when it has one. */
function fileTypeLabel(file: PanelFile): string {
  const extension = /\.([a-z0-9]{1,5})$/i.exec(file.name)?.[1];
  return extension ? extension.toUpperCase() : humanMediaLabel(file.mediaType);
}
