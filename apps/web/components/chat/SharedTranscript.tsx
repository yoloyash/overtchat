import { useCallback, useMemo, useState } from "react";
import type { UIMessage } from "ai";
import {
  codeExecutionFileIndex,
  collectOpenUIStates,
  type OpenUIFormState,
  type PanelFile,
} from "@overtchat/shared";
import { DocumentPanel } from "./DocumentPanel";
import { DocumentPanelProvider } from "./DocumentPanelContext";
import { FilePanel } from "./FilePanel";
import { FilePanelProvider } from "./FilePanelContext";
import { MessageBubble } from "./MessageBubble";
import { Button } from "@/components/ui/button";

export function SharedTranscript({
  messages,
  formStates,
  onLoadMore,
  hasMore,
  loadingMore,
}: {
  messages: UIMessage[];
  formStates?: Array<[string, OpenUIFormState]>;
  onLoadMore?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
}) {
  const [visible, setVisible] = useState(50);
  const [documentTarget, setDocumentTarget] = useState<string | null>(null);
  const closeDocument = useCallback(() => setDocumentTarget(null), []);
  const [fileTarget, setFileTarget] = useState<PanelFile | null>(null);
  const closeFile = useCallback(() => setFileTarget(null), []);
  const documentPanel = useMemo(
    () => ({
      activeToolCallId: documentTarget,
      open(toolCallId: string) {
        setFileTarget(null);
        setDocumentTarget(toolCallId);
      },
    }),
    [documentTarget],
  );
  const filePanel = useMemo(
    () => ({
      activeFileId: fileTarget?.id ?? null,
      open(file: PanelFile) {
        setDocumentTarget(null);
        setFileTarget(file);
      },
    }),
    [fileTarget],
  );
  const openuiStates = useMemo(
    () => new Map([...collectOpenUIStates(messages), ...(formStates ?? [])]),
    [messages, formStates],
  );
  const codeFiles = useMemo(() => codeExecutionFileIndex(messages), [messages]);
  return (
    <DocumentPanelProvider value={documentPanel}>
    <FilePanelProvider value={filePanel}>
    <div className="space-y-8" data-shared-transcript="">
      {(onLoadMore ? messages : messages.slice(0, visible)).map((message) => (
        <article
          key={message.id}
          aria-label={
            message.role === "user" ? "User message" : "Assistant message"
          }
        >
          <MessageBubble
            message={message}
            streaming={false}
            canAct={false}
            readOnly
            showStats={false}
            stats={null}
            openuiStates={openuiStates}
            codeFiles={codeFiles}
          />
        </article>
      ))}
      {(onLoadMore ? hasMore : visible < messages.length) && (
        <Button
          variant="outline"
          disabled={loadingMore}
          onClick={onLoadMore ?? (() => setVisible((count) => count + 50))}
        >
          {loadingMore ? "Loading messages…" : "Show more messages"}
        </Button>
      )}
    </div>
    {documentTarget && (
      <DocumentPanel
        messages={messages}
        toolCallId={documentTarget}
        streaming={false}
        variant="overlay"
        wordExport={false}
        onSelect={setDocumentTarget}
        onClose={closeDocument}
      />
    )}
    {fileTarget && <FilePanel file={fileTarget} variant="overlay" onClose={closeFile} />}
    </FilePanelProvider>
    </DocumentPanelProvider>
  );
}
