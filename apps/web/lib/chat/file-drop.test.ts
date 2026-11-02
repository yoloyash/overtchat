import { describe, expect, it, vi } from "vitest";
import { createFileDropHandlers, installStrayFileDropGuard } from "./file-drop";

function transfer(files: File[] = [new File(["x"], "shot.png", { type: "image/png" })]) {
  return {
    types: ["Files"],
    files,
    items: files.map((file) => ({ kind: "file", getAsFile: () => file })),
    dropEffect: "move",
  } as unknown as DataTransfer;
}

function dragEvent(dataTransfer: DataTransfer = transfer()) {
  return { dataTransfer, preventDefault: vi.fn(), stopPropagation: vi.fn() };
}

function textDrag() {
  return dragEvent({ types: ["text/plain"], files: [], items: [] } as unknown as DataTransfer);
}

/** A host that keeps the depth counter the way React state would. */
function host(overrides: Partial<Parameters<typeof createFileDropHandlers>[0]> = {}) {
  const state = { depth: 0 };
  return {
    state,
    onFiles: vi.fn(),
    setDepth: (update: (depth: number) => number) => {
      state.depth = update(state.depth);
    },
    ...overrides,
  };
}

describe("createFileDropHandlers", () => {
  it("stays active while the pointer crosses children and reports the dropped files", () => {
    const zone = host();
    const handlers = createFileDropHandlers(zone);
    const png = new File(["x"], "shot.png", { type: "image/png" });

    handlers.onDragEnter(dragEvent());
    handlers.onDragEnter(dragEvent());
    handlers.onDragLeave(dragEvent());
    expect(zone.state.depth).toBe(1);

    const over = dragEvent();
    handlers.onDragOver(over);
    expect(over.dataTransfer.dropEffect).toBe("copy");

    handlers.onDrop(dragEvent(transfer([png])));
    expect(zone.state.depth).toBe(0);
    expect(zone.onFiles).toHaveBeenCalledWith([png]);
  });

  it("ignores drags without files so text can still drop into inputs", () => {
    const zone = host();
    const handlers = createFileDropHandlers(zone);
    const event = textDrag();
    handlers.onDragEnter(event);
    handlers.onDrop(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(zone.state.depth).toBe(0);
    expect(zone.onFiles).not.toHaveBeenCalled();
  });

  it("leaves the drag to the browser while disabled", () => {
    const zone = host({ disabled: () => true });
    const handlers = createFileDropHandlers(zone);
    const event = dragEvent();
    handlers.onDragEnter(event);
    handlers.onDrop(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(zone.state.depth).toBe(0);
    expect(zone.onFiles).not.toHaveBeenCalled();
  });

  it("refuses the cursor but still reports the drop when the host cannot accept", () => {
    const zone = host({ accepting: () => false });
    const handlers = createFileDropHandlers(zone);
    const over = dragEvent();
    handlers.onDragOver(over);
    expect(over.dataTransfer.dropEffect).toBe("none");
    handlers.onDrop(dragEvent());
    expect(zone.onFiles).toHaveBeenCalledTimes(1);
  });

  it("never counts below zero after a stray leave", () => {
    const zone = host();
    const handlers = createFileDropHandlers(zone);
    handlers.onDragLeave(dragEvent());
    expect(zone.state.depth).toBe(0);
    handlers.onDragEnter(dragEvent());
    expect(zone.state.depth).toBe(1);
  });
});

describe("installStrayFileDropGuard", () => {
  it("cancels unclaimed file drags and leaves other drags alone", () => {
    const target = new EventTarget();
    const uninstall = installStrayFileDropGuard(target);

    const fileOver = Object.assign(new Event("dragover", { cancelable: true }), {
      dataTransfer: transfer(),
    });
    target.dispatchEvent(fileOver);
    expect(fileOver.defaultPrevented).toBe(true);
    expect(fileOver.dataTransfer.dropEffect).toBe("none");

    const fileDrop = Object.assign(new Event("drop", { cancelable: true }), {
      dataTransfer: transfer(),
    });
    target.dispatchEvent(fileDrop);
    expect(fileDrop.defaultPrevented).toBe(true);

    const textDrop = Object.assign(new Event("drop", { cancelable: true }), {
      dataTransfer: textDrag().dataTransfer,
    });
    target.dispatchEvent(textDrop);
    expect(textDrop.defaultPrevented).toBe(false);

    uninstall();
    const afterwards = Object.assign(new Event("drop", { cancelable: true }), {
      dataTransfer: transfer(),
    });
    target.dispatchEvent(afterwards);
    expect(afterwards.defaultPrevented).toBe(false);
  });
});
