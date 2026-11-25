import { Feather, Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { Directory } from "expo-file-system";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
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
  canExportToWord,
  documentFilename,
  documentMediaType,
  documentView,
  htmlPreviewDocument,
  WORD_MEDIA_TYPE,
  type DocumentDraft,
} from "@overtchat/shared";
import { authFetch, getApiBase } from "@/lib/api";
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
  const { t } = useTranslation();
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
      ? t("chat.documents.writing")
      : t("chat.documents.notSaved")
    : view.updating && streaming
      ? t("chat.documents.versionUpdating", { version: saved.version })
      : t("chat.documents.versionOf", {
          version: saved.version,
          total: view.versions.at(-1)!.version,
        });

  async function save(format: "source" | "docx") {
    const shown = document!;
    setSaving(true);
    try {
      // Convert first, so a failed export does not leave the folder picker open.
      let bytes: Uint8Array | undefined;
      if (format === "docx") {
        const response = await authFetch(`${getApiBase()}/api/documents/export`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: shown.title,
            type: shown.type,
            content: shown.content,
            format: "docx",
          }),
        });
        if (!response.ok) throw new Error(`Export failed (${response.status})`);
        bytes = new Uint8Array(await response.arrayBuffer());
      }
      const directory = await Directory.pickDirectoryAsync();
      if (bytes) {
        directory.createFile(documentFilename(shown, "docx"), WORD_MEDIA_TYPE).write(bytes);
      } else {
        directory
          .createFile(documentFilename(shown), documentMediaType(shown))
          .write(shown.content);
      }
      toastSuccess(t("chat.mobile.documents.saved"));
    } catch (error) {
      if (!(error instanceof Error && /cancel/i.test(error.message)))
        toastError(t("chat.mobile.documents.saveFailed"), error);
    } finally {
      setSaving(false);
    }
  }

  function chooseSave() {
    if (!canExportToWord(document!)) {
      void save("source");
      return;
    }
    Alert.alert(t("chat.mobile.documents.saveTitle"), undefined, [
      { text: "Markdown (.md)", onPress: () => void save("source") },
      { text: "Word (.docx)", onPress: () => void save("docx") },
      { text: t("chat.messages.cancel"), style: "cancel" },
    ]);
  }

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
                {t(`chat.documents.types.${document.type}`)}
                {document.type === "code" && document.language ? ` · ${document.language}` : ""} · {status}
              </Text>
            </View>
            <ToolbarIconButton label={t("chat.documents.closeDocument")} icon="x" onPress={onClose} />
          </View>
          <View style={styles.toolbar}>
            {view.versions.length > 1 && !view.draft ? (
              <View style={styles.toolbarGroup} accessibilityLabel={t("chat.documents.versions")}>
                <ToolbarIconButton
                  label={t("chat.documents.previousVersion")}
                  icon="chevron-left"
                  onPress={() => onSelect(view.versions[view.index - 1].toolCallId)}
                  disabled={view.index <= 0}
                />
                <ToolbarIconButton
                  label={t("chat.documents.nextVersion")}
                  icon="chevron-right"
                  onPress={() => onSelect(view.versions[view.index + 1].toolCallId)}
                  disabled={view.index >= view.versions.length - 1}
                />
              </View>
            ) : (
              <View />
            )}
            <View style={styles.toolbarGroup}>
              {previewable ? (
                <ToolbarIconButton
                  label={showSource ? t("chat.files.showPreview") : t("chat.files.showSource")}
                  icon={showSource ? "eye" : "code"}
                  onPress={() => setShowSource((value) => !value)}
                  disabled={writing}
                />
              ) : null}
              <ToolbarIconButton
                label={t("chat.documents.copyDocument")}
                icon="copy"
                onPress={() => {
                  Clipboard.setStringAsync(document.content)
                    .then(() => toastSuccess(t("chat.documents.documentCopied")))
                    .catch((error: unknown) => toastError(t("chat.documents.copyDocumentFailed"), error));
                }}
                disabled={writing}
              />
              <ToolbarIconButton
                label={t("chat.mobile.documents.share")}
                icon="share"
                onPress={() => {
                  void Share.share({ title: document.title, message: document.content }).catch(() => {});
                }}
                disabled={writing}
              />
              <ToolbarIconButton
                label={t("chat.mobile.documents.saveTitle")}
                icon="download"
                onPress={chooseSave}
                disabled={writing || saving}
              />
            </View>
          </View>
        </View>
        <DocumentBody
          key={`${toolCallId}:${saved?.version ?? "draft"}:${sourceShown}`}
          document={document}
          source={sourceShown}
          writing={writing}
          bottomInset={insets.bottom}
        />
      </View>
    </Modal>
  );
}

function ToolbarIconButton({
  label,
  icon,
  onPress,
  disabled = false,
}: {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
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
}

function DocumentBody({
  document,
  source,
  writing,
  bottomInset,
}: {
  document: ShownDocument;
  source: boolean;
  writing: boolean;
  bottomInset: number;
}) {
  const { colors, fonts } = useTheme();
  const { t } = useTranslation();
  if (source || document.type === "markdown") {
    return (
      <ScrollView
        style={styles.body}
        contentContainerStyle={[styles.bodyContent, { paddingBottom: 24 + bottomInset }]}
      >
        {source ? (
          <CodeBlock code={document.content} language={sourceLanguage(document)} streaming={writing} />
        ) : (
          <MarkdownBody text={document.content} />
        )}
        {document.type === "mermaid" ? (
          <Text style={[styles.note, { color: colors.mutedForeground, fontFamily: fonts.sansRegular }]}>
            {t("chat.mobile.documents.diagramWebHint")}
          </Text>
        ) : null}
      </ScrollView>
    );
  }
  return <SandboxedPreview html={previewHtml(document, t("chat.documents.svgPreviewAlt"))} background={document.type === "html" ? "#ffffff" : colors.background} />;
}

function previewHtml(document: ShownDocument, svgAlt: string): string {
  if (document.type === "svg") {
    // An SVG image document never runs scripts or loads resources.
    const image = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(document.content)}`;
    return htmlPreviewDocument(
      `<style>html,body{margin:0;height:100%;display:flex;align-items:center;justify-content:center}img{max-width:100%;max-height:100%}</style><img alt="${svgAlt.replace(/"/g, "&quot;")}" src="${image}">`,
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
