import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { WebView } from "react-native-webview";
import {
  normalizeOpenUILang,
  openUIFallbackText,
  readOpenUIAction,
  type OpenUIAction,
  type OpenUIFormState,
  type OpenUIToolPart,
} from "@overtchat/shared";
import { useServerUrl } from "@/lib/server-url";
import { useTheme } from "@/lib/theme";
import { MarkdownBody } from "./MarkdownBody";

export function OpenUICard({
  messageId,
  part,
  streaming,
  initialState,
  onAction,
  deferred = false,
}: {
  messageId: string;
  part: OpenUIToolPart;
  streaming: boolean;
  initialState?: OpenUIFormState;
  onAction?: (action: OpenUIAction) => void;
  /** Older cards show their readable answer until opened; each live card is a WebView. */
  deferred?: boolean;
}) {
  const { colors, fonts, scheme } = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  // Keep an internally scrolling card inside the visible chat area, including
  // when the keyboard reduces the window. Otherwise its bottom can be offscreen
  // while Android directs every gesture to the inner WebView.
  const maxHeight = Math.max(160, Math.min(1200, Math.floor(windowHeight * 0.6)));
  const server = useServerUrl();
  const ref = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [height, setHeight] = useState(160);
  // Once live, a card stays live until its cell is recycled.
  const [activated, setActivated] = useState(!deferred);
  const live = activated || !deferred;
  const uri = `${server?.replace(/\/$/, "")}/openui/index.html`;
  const source = useMemo(() => ({ uri }), [uri]);
  const pending =
    part.state === "input-streaming" || part.state === "input-available";
  const isStreaming = streaming && pending;
  const text = openUIFallbackText(part);
  const code = normalizeOpenUILang(part.input?.ui ?? part.rawInput?.ui);
  const payload = JSON.stringify({
    messageId,
    toolCallId: part.toolCallId,
    code,
    isStreaming,
    fallbackText: text,
    mode: scheme,
    colors,
    initialState,
    canAct: Boolean(onAction) && part.state === "output-available",
  });
  useEffect(() => {
    if (ready)
      ref.current?.injectJavaScript(
        `window.overtchatOpenUI?.render(${payload}); true;`,
      );
  }, [ready, payload]);

  useEffect(() => {
    if (!live || ready || failed || !code.trim()) return;
    const timer = setTimeout(() => setFailed(true), 15_000);
    return () => clearTimeout(timer);
  }, [live, ready, failed, code]);

  const interrupted = !streaming && pending;
  if (failed || part.state === "output-error" || interrupted || !server) {
    return (
      <View style={{ marginVertical: 8, gap: 8 }}>
        <Text style={{ color: colors.mutedForeground }}>
          {part.errorText ??
            (interrupted
              ? "Interactive UI generation was interrupted."
              : "Interactive UI is unavailable. The readable answer is shown below.")}
        </Text>
        {text ? <MarkdownBody text={text} /> : null}
      </View>
    );
  }
  if (!code.trim())
    return isStreaming ? (
      <ActivityIndicator color={colors.mutedForeground} />
    ) : (
      <MarkdownBody text={text || "Interactive UI is unavailable."} />
    );
  if (!live)
    return (
      <View style={{ marginVertical: 8, gap: 8 }}>
        {text ? <MarkdownBody text={text} /> : null}
        <Pressable
          accessibilityRole="button"
          onPress={() => setActivated(true)}
          hitSlop={6}
          style={({ pressed }) => ({
            alignSelf: "flex-start",
            opacity: pressed ? 0.65 : 1,
          })}
        >
          <Text style={{ color: colors.primary, fontFamily: fonts.sansMedium }}>
            Show interactive view
          </Text>
        </Pressable>
      </View>
    );
  return (
    <View style={{ marginVertical: 8, width: "100%" }}>
      {!ready && (
        <ActivityIndicator
          accessibilityLabel="Loading interactive UI"
          color={colors.mutedForeground}
        />
      )}
      <WebView
        ref={ref}
        source={source}
        style={{
          height: Math.min(height, maxHeight),
          backgroundColor: colors.background,
        }}
        nestedScrollEnabled={height >= maxHeight}
        incognito
        sharedCookiesEnabled={false}
        thirdPartyCookiesEnabled={false}
        allowFileAccess={false}
        javaScriptCanOpenWindowsAutomatically={false}
        setSupportMultipleWindows
        onShouldStartLoadWithRequest={(request) => request.url === uri}
        onError={() => setFailed(true)}
        onHttpError={() => setFailed(true)}
        onContentProcessDidTerminate={() => setFailed(true)}
        onMessage={(event) => {
          if (event.nativeEvent.data.length > 70_000) return;
          try {
            const data = JSON.parse(event.nativeEvent.data);
            if (data.type === "ready") setReady(true);
            else if (
              data.type === "height" &&
              typeof data.height === "number" &&
              Number.isFinite(data.height)
            )
              setHeight(
                Math.min(1200, Math.max(80, Math.ceil(data.height) + 8)),
              );
            else if (
              data.type === "action" &&
              onAction &&
              part.state === "output-available"
            ) {
              const action = readOpenUIAction(data.action);
              if (
                action?.messageId === messageId &&
                action.toolCallId === part.toolCallId
              )
                onAction(action);
            } else if (
              data.type === "open-url" &&
              typeof data.url === "string"
            ) {
              const url = new URL(data.url);
              if (["http:", "https:", "mailto:", "tel:"].includes(url.protocol))
                void Linking.openURL(url.href).catch(() => {});
            }
          } catch {
            /* Ignore malformed bridge messages. */
          }
        }}
      />
    </View>
  );
}
