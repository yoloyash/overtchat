import { app, clipboard, Menu, shell, type MenuItemConstructorOptions, type WebContents } from "electron";

/** Electron ships no context menu; this provides the standard editing one. */
export function attachContextMenu(contents: WebContents): void {
  contents.on("context-menu", (_event, params) => {
    const items: MenuItemConstructorOptions[] = [];
    const separate = () => {
      if (items.length && items.at(-1)?.type !== "separator") items.push({ type: "separator" });
    };
    const selection = params.selectionText.trim();

    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
        items.push({ label: suggestion, click: () => contents.replaceMisspelling(suggestion) });
      }
      if (!params.dictionarySuggestions.length) items.push({ label: "No Guesses Found", enabled: false });
      items.push({
        label: "Learn Spelling",
        click: () => contents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      });
      separate();
    }

    if (params.linkURL && !params.linkURL.startsWith("javascript:")) {
      const external = /^(https?|mailto):/.test(params.linkURL);
      if (external) {
        items.push({ label: "Open Link in Browser", click: () => void shell.openExternal(params.linkURL) });
      }
      items.push({ label: "Copy Link", click: () => clipboard.writeText(params.linkURL) });
      separate();
    }

    if (params.mediaType === "image" && params.srcURL) {
      items.push(
        { label: "Copy Image", click: () => contents.copyImageAt(params.x, params.y) },
        { label: "Save Image to Downloads", click: () => contents.downloadURL(params.srcURL) },
      );
      separate();
    }

    if (selection && process.platform === "darwin") {
      const preview = selection.length > 24 ? `${selection.slice(0, 24)}…` : selection;
      items.push({ label: `Look Up “${preview}”`, click: () => contents.showDefinitionForSelection() });
      separate();
    }

    const { editFlags } = params;
    if (params.isEditable) {
      items.push(
        { role: "cut", enabled: editFlags.canCut },
        { role: "copy", enabled: editFlags.canCopy },
        { role: "paste", enabled: editFlags.canPaste },
        { role: "pasteAndMatchStyle", enabled: editFlags.canPaste },
        { role: "selectAll", enabled: editFlags.canSelectAll },
      );
    } else if (selection) {
      items.push({ role: "copy" });
    }

    if (!app.isPackaged) {
      separate();
      items.push({ label: "Inspect Element", click: () => contents.inspectElement(params.x, params.y) });
    }

    while (items.at(-1)?.type === "separator") items.pop();
    if (items.length) Menu.buildFromTemplate(items).popup();
  });
}
