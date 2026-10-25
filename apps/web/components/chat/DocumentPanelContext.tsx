"use client";

import { createContext, useContext } from "react";

export interface DocumentPanelControls {
  /** Tool call whose document version is shown, if the panel is open. */
  activeToolCallId: string | null;
  open(toolCallId: string): void;
}

const DocumentPanelContext = createContext<DocumentPanelControls | null>(null);

export const DocumentPanelProvider = DocumentPanelContext.Provider;

/** Null where no panel is hosted; document cards are then not interactive. */
export function useDocumentPanel(): DocumentPanelControls | null {
  return useContext(DocumentPanelContext);
}
