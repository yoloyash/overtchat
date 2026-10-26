"use client";

import { createContext, useContext } from "react";
import type { PanelFile } from "@overtchat/shared";

export interface FilePanelControls {
  /** File the panel shows, if it is open. */
  activeFileId: string | null;
  open(file: PanelFile): void;
}

const FilePanelContext = createContext<FilePanelControls | null>(null);

export const FilePanelProvider = FilePanelContext.Provider;

/** Null where no panel is hosted; files then open or download directly. */
export function useFilePanel(): FilePanelControls | null {
  return useContext(FilePanelContext);
}
