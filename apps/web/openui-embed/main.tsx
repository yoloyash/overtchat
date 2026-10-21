import { createRoot } from "react-dom/client";
import OpenUIRenderer from "../components/chat/OpenUIRenderer";
import type { ColorTokens, OpenUIFormState } from "@overtchat/shared";
import "@overtchat/shared/theme.css";
import "@openuidev/react-ui/styles/index.css";
import "./style.css";

type Payload = {
  messageId: string;
  toolCallId: string;
  code: string;
  isStreaming: boolean;
  fallbackText: string;
  mode: "light" | "dark";
  colors?: ColorTokens;
  initialState?: OpenUIFormState;
  canAct: boolean;
};

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(value: string): void };
    overtchatOpenUI?: { render(payload: Payload): void };
  }
}
const root = createRoot(document.getElementById("root")!);
const post = (data: unknown) =>
  window.ReactNativeWebView?.postMessage(JSON.stringify(data));
window.overtchatOpenUI = {
  render(payload) {
    document.documentElement.classList.toggle("dark", payload.mode === "dark");
    for (const [name, color] of Object.entries(payload.colors ?? {})) {
      document.documentElement.style.setProperty(
        `--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
        color,
      );
    }
    root.render(
      <OpenUIRenderer
        key={`${payload.messageId}:${payload.toolCallId}`}
        {...payload}
        onAction={
          payload.canAct
            ? (action) => post({ type: "action", action })
            : undefined
        }
        onOpenUrl={(url) => post({ type: "open-url", url })}
      />,
    );
  },
};
new ResizeObserver(() =>
  post({
    type: "height",
    height: document.getElementById("root")!.getBoundingClientRect().height,
  }),
).observe(document.getElementById("root")!);
post({ type: "ready" });
