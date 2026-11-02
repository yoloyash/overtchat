import { createContext, useContext } from "react";

export interface DocumentViewerControls {
  /** Tool call whose document version is shown, if the viewer is open. */
  activeToolCallId: string | null;
  open(toolCallId: string): void;
}

const DocumentViewerContext = createContext<DocumentViewerControls | null>(null);

export const DocumentViewerProvider = DocumentViewerContext.Provider;

/** Null where no viewer is hosted; document cards are then not interactive. */
export function useDocumentViewer(): DocumentViewerControls | null {
  return useContext(DocumentViewerContext);
}
