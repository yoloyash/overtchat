import { getDataTransferFiles, hasDataTransferFiles } from "./attachments";

/** The slice of a drag event the drop handlers read, shared by React and DOM events. */
export interface FileDragEvent {
  dataTransfer: DataTransfer;
  preventDefault(): void;
  stopPropagation(): void;
}

export interface FileDropHost {
  /** When true the drag is left alone, so it falls through to the stray-drop guard. */
  disabled?: () => boolean;
  /** When false the cursor shows the drop will be refused; `onFiles` still runs so the host can explain. */
  accepting?: () => boolean;
  /** Stores how many nested elements the drag has entered; the zone is active above zero. */
  setDepth(update: (depth: number) => number): void;
  onFiles(files: File[]): void;
}

export interface FileDropHandlers {
  onDragEnter(event: FileDragEvent): void;
  onDragOver(event: FileDragEvent): void;
  onDragLeave(event: FileDragEvent): void;
  onDrop(event: FileDragEvent): void;
}

/**
 * Drop-zone handlers for file drags. Enter/leave events fire for every child
 * the pointer crosses, so a depth counter decides when the zone is really left.
 */
export function createFileDropHandlers(host: FileDropHost): FileDropHandlers {
  function claims(event: FileDragEvent): boolean {
    if (host.disabled?.() || !hasDataTransferFiles(event.dataTransfer)) return false;
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  return {
    onDragEnter(event) {
      if (!claims(event)) return;
      host.setDepth((depth) => depth + 1);
    },
    onDragOver(event) {
      if (!claims(event)) return;
      event.dataTransfer.dropEffect = host.accepting?.() === false ? "none" : "copy";
    },
    onDragLeave(event) {
      if (!claims(event)) return;
      host.setDepth((depth) => Math.max(0, depth - 1));
    },
    onDrop(event) {
      if (!claims(event)) return;
      host.setDepth(() => 0);
      const files = getDataTransferFiles(event.dataTransfer);
      if (files.length > 0) host.onFiles(files);
    },
  };
}

/**
 * Browsers open a dropped file in the tab when nothing claims the drop, which
 * replaces the app. Refuse file drags anywhere a zone has not already handled them.
 */
export function installStrayFileDropGuard(target: EventTarget): () => void {
  function refuse(event: Event) {
    const drag = event as DragEvent;
    if (!drag.dataTransfer || !hasDataTransferFiles(drag.dataTransfer)) return;
    drag.preventDefault();
    if (drag.type === "dragover") drag.dataTransfer.dropEffect = "none";
  }
  target.addEventListener("dragover", refuse);
  target.addEventListener("drop", refuse);
  return () => {
    target.removeEventListener("dragover", refuse);
    target.removeEventListener("drop", refuse);
  };
}
