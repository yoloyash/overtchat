import type { ITheme } from "@xterm/xterm";

export function terminalTheme(element: HTMLElement): ITheme {
  const styles = getComputedStyle(element);
  const dark = document.documentElement.classList.contains("dark");
  return {
    background: styles.getPropertyValue("--background").trim(),
    foreground: styles.getPropertyValue("--foreground").trim(),
    cursor: styles.getPropertyValue("--foreground").trim(),
    cursorAccent: styles.getPropertyValue("--background").trim(),
    selectionBackground: dark ? "#64764b80" : "#a1b88780",
    selectionInactiveBackground: dark ? "#64764b50" : "#a1b88750",
    ...(dark
      ? {
          black: "#27272a",
          brightBlack: "#8b8b93",
          red: "#f08080",
          brightRed: "#ffa0a0",
          green: "#a3c778",
          brightGreen: "#c0df96",
          yellow: "#e0bd70",
          brightYellow: "#f4d996",
          blue: "#83b3ed",
          brightBlue: "#aecfff",
          magenta: "#c5a0e8",
          brightMagenta: "#dfbfff",
          cyan: "#78c6cc",
          brightCyan: "#a0e1e5",
          white: "#d4d4d8",
          brightWhite: "#fafafa",
        }
      : {
          black: "#27272a",
          brightBlack: "#62626b",
          red: "#ad3535",
          brightRed: "#ba3535",
          green: "#426526",
          brightGreen: "#4c7029",
          yellow: "#835e16",
          brightYellow: "#8e6214",
          blue: "#285e9c",
          brightBlue: "#2e65a6",
          magenta: "#80529e",
          brightMagenta: "#8956aa",
          cyan: "#28696d",
          brightCyan: "#2c7277",
          white: "#56565f",
          brightWhite: "#38383f",
        }),
  };
}

export function terminalFont(element: HTMLElement): string {
  return (
    getComputedStyle(element).getPropertyValue("--font-geist-mono").trim() ||
    "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
  );
}

export function terminalOutputQuote(selection: string): string {
  return `Terminal output:\n${selection
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n")}\n\n`;
}

export function terminalWebUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}
