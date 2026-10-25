import { Feather, Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { Directory } from "expo-file-system";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import type { UIMessage } from "ai";
import {
  DOCUMENT_TYPE_LABELS,
  documentFilename,
  documentMediaType,
  documentView,
  htmlPreviewDocument,
  type DocumentDraft,
} from "@overtchat/shared";
import { useTheme } from "@/lib/theme";
import { toastError, toastSuccess } from "@/lib/toast";
import { CodeBlock } from "./CodeBlock";
import { DOCUMENT_ICONS } from "./DocumentCard";
import { MarkdownBody } from "./MarkdownBody";

type ShownDocument = DocumentDraft & { version?: number };

/**
 * A full-screen view of the document version produced by one tool call, with
 * navigation to the document's other saved versions.
 */
export function DocumentViewer({
  messages,
  toolCallId,
  streaming,
  onSelect,
  onClose,
}: {
  messages: UIMessage[];
  toolCallId: string;
  streaming: boolean;
  onSelect: (toolCallId: string) => void;
  onClose: () => void;
}) {
  const { colors, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const view = useMemo(() => documentView(messages, toolCallId), [messages, toolCallId]);
  const [showSource, setShowSource] = useState(false);
  const [saving, setSaving] = useState(false);
  const missing = !view;
  useEffect(() => {
    // The tool call can disappear when history is edited or regenerated.
    if (missing) onClose();
  }, [missing, onClose]);
  if (!view) return null;

  const saved = view.versions[view.index];
  const document: ShownDocument | undefined = view.draft ?? saved;
  if (!document) return null;
  const writing = Boolean(view.draft) && streaming;
  // Diagrams render on web; native shows their source.
  const previewable = document.type !== "code" && document.type !== "mermaid";
  const sourceShown = !previewable || showSource || writing;
  const status = view.draft
    ? writing
      ? "Writing…"
      : "Not saved"
    : view.updating && streaming
      ? `Version ${saved.version} · Updating…`
      : `Version ${saved.version} of ${view.versions.at(-1)!.version}`;

  async function save() {
    setSaving(true);
    try {
      const directory = await Directory.pickDirectoryAsync();
      directory
        .createFile(documentFilename(document!), documentMediaType(document!))
        .write(document!.content);
      toastSuccess("Document saved");
    } catch (error) {
      if (!(error instanceof Error && /cancel/i.test(error.message)))
        toastError("Could not save document", error);
    } finally {
      setSaving(false);
    }
  }

  const iconButton = (
    label: string,
    icon: keyof typeof Feather.glyphMap,
    onPress: () => void,
    disabled = false,
  ) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.iconButton, { opacity: disabled ? 0.35 : pressed ? 0.6 : 1 }]}
    >
      <Feather name={icon} size={19} color={colors.foreground} />
    </Pressable>
  );

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={styles.titleRow}>
            <View style={[styles.typeIcon, { backgroundColor: colors.muted }]}>
              {writing ? (
                <ActivityIndicator size="small" color={colors.mutedForeground} />
              ) : (
                <Ionicons name={DOCUMENT_ICONS[document.type]} size={18} color={colors.mutedForeground} />
              )}
            </View>
            <View style={styles.titleText}>
              <Text
                accessibilityRole="header"
                numberOfLines={1}
                style={[styles.title, { color: colors.foreground, fontFamily: fonts.sansMedium }]}
              >
                {document.title}
              </Text>
              <Text numberOfLines={1} style={[styles.status, { color: colors.mutedForeground, fontFamily: fonts.sansRegular }]}>
                {DOCUMENT_TYPE_LABELS[document.type]}
                {document.type === "code" && document.language ? ` · ${document.language}` : ""} · {status}
              </Text>
            </View>
            {iconButton("Close document", "x", onClose)}
          </View>
          <View style={styles.toolbar}>
            {view.versions.length > 1 && !view.draft ? (
              <View style={styles.toolbarGroup} accessibilityLabel="Versions">
                {iconButton("Previous version", "chevron-left", () => onSelect(view.versions[view.index - 1].toolCallId), view.index <= 0)}
                {iconButton(
                  "Next version",
                  "chevron-right",
                  () => onSelect(view.versions[view.index + 1].toolCallId),
                  view.index >= view.versions.length - 1,
                )}
              </View>
            ) : (
              <View />
            )}
            <View style={styles.toolbarGroup}>
              {previewable
                ? iconButton(showSource ? "Show preview" : "Show source", showSource ? "eye" : "code", () => setShowSource((value) => !value), writing)
                : null}
              {iconButton("Copy document", "copy", () => {
                Clipboard.setStringAsync(document.content)
                  .then(() => toastSuccess("Document copied"))
                  .catch((error: unknown) => toastError("Could not copy the document", error));
              }, writing)}
              {iconButton("Share document", "share", () => {
                void Share.share({ title: document.title, message: document.content }).catch(() => {});
              }, writing)}
              {iconButton("Save document", "download", () => void save(), writing || saving)}
            </View>
          </View>
        </View>
        <DocumentBody
          key={`${toolCallId}:${saved?.version ?? "draft"}:${sourceShown}`}
          document={document}
          source={sourceShown}
          bottomInset={insets.bottom}
        />
      </View>
    </Modal>
  );
}

function DocumentBody({
  document,
  source,
  bottomInset,
}: {
  document: ShownDocument;
  source: boolean;
  bottomInset: number;
}) {
  const { colors, fonts } = useTheme();
  if (source || document.type === "markdown") {
    return (
      <ScrollView
        style={styles.body}
        contentContainerStyle={[styles.bodyContent, { paddingBottom: 24 + bottomInset }]}
      >
        {source ? (
          <CodeBlock code={document.content} language={sourceLanguage(document)} />
        ) : (
          <MarkdownBody text={document.content} />
        )}
        {document.type === "mermaid" ? (
          <Text style={[styles.note, { color: colors.mutedForeground, fontFamily: fonts.sansRegular }]}>
            Open this chat on the web to view the diagram.
          </Text>
        ) : null}
      </ScrollView>
    );
  }
  return <SandboxedPreview html={previewHtml(document)} background={document.type === "html" ? "#ffffff" : colors.background} />;
}

function previewHtml(document: ShownDocument): string {
  if (document.type === "svg") {
    // An SVG image document never runs scripts or loads resources.
    const image = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(document.content)}`;
    return htmlPreviewDocument(
      `<style>html,body{margin:0;height:100%;display:flex;align-items:center;justify-content:center}img{max-width:100%;max-height:100%}</style><img alt="SVG preview" src="${image}">`,
    );
  }
  return htmlPreviewDocument(document.content);
}

/** Untrusted HTML without cookies, file access, navigation or a native bridge. */
function SandboxedPreview({ html, background }: { html: string; background: string }) {
  const source = useMemo(() => ({ html, baseUrl: "about:blank" }), [html]);
  return (
    <WebView
      source={source}
      style={[styles.body, { backgroundColor: background }]}
      originWhitelist={["about:blank"]}
      incognito
      sharedCookiesEnabled={false}
      thirdPartyCookiesEnabled={false}
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      javaScriptCanOpenWindowsAutomatically={false}
      setSupportMultipleWindows={false}
      mediaPlaybackRequiresUserAction
      onShouldStartLoadWithRequest={(request) => {
        if (request.url === "about:blank" || request.url.startsWith("about:")) return true;
        // Links leave the preview for the system browser instead of navigating it.
        if (/^(https?|mailto|tel):/i.test(request.url)) void Linking.openURL(request.url).catch(() => {});
        return false;
      }}
    />
  );
}

function sourceLanguage(document: ShownDocument): string {
  switch (document.type) {
    case "code":
      return document.language ?? "";
    case "svg":
      return "xml";
    case "mermaid":
      return "";
    default:
      return document.type;
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingBottom: 6 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 8 },
  typeIcon: { width: 34, height: 34, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  titleText: { flex: 1, minWidth: 0 },
  title: { fontSize: 15 },
  status: { fontSize: 12, marginTop: 2 },
  toolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  toolbarGroup: { flexDirection: "row", alignItems: "center" },
  iconButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  body: { flex: 1 },
  bodyContent: { padding: 16 },
  note: { fontSize: 13, marginTop: 12 },
});
