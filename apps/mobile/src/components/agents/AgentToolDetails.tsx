import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import {
  agentToolStatus,
  describeAgentTool,
  type AgentToolActivity,
  type AgentToolCategory,
} from "@overtchat/shared/agent-presentation";
import { useFormatLocale } from "@/components/I18nProvider";
import { toolDetails, type ToolSection } from "@/lib/agents/tool-details";
import { useTheme } from "@/lib/theme";
import { toastError } from "@/lib/toast";
import { AgentButton, AgentText } from "./AgentPrimitives";
import { AgentWorkingIndicator } from "./AgentWorkingIndicator";

const icons: Record<
  AgentToolCategory,
  React.ComponentProps<typeof Ionicons>["name"]
> = {
  shell: "terminal-outline",
  read: "document-text-outline",
  edit: "create-outline",
  write: "document-outline",
  search: "search-outline",
  fetch: "globe-outline",
  other: "construct-outline",
};
const KNOWN_SECTION_COPY_KEYS = [
  ["agents.toolDetails.command", "agents.mobile.toolDetails.copy.command", "agents.mobile.toolDetails.copied.command"],
  ["agents.toolDetails.path", "agents.mobile.toolDetails.copy.path", "agents.mobile.toolDetails.copied.path"],
  ["agents.toolDetails.workingDirectory", "agents.mobile.toolDetails.copy.workingDirectory", "agents.mobile.toolDetails.copied.workingDirectory"],
  ["agents.activity.changes", "agents.mobile.toolDetails.copy.changes", "agents.mobile.toolDetails.copied.changes"],
  ["agents.toolDetails.before", "agents.mobile.toolDetails.copy.before", "agents.mobile.toolDetails.copied.before"],
  ["agents.toolDetails.after", "agents.mobile.toolDetails.copy.after", "agents.mobile.toolDetails.copied.after"],
  ["agents.activity.content", "agents.mobile.toolDetails.copy.content", "agents.mobile.toolDetails.copied.content"],
  ["agents.activity.input", "agents.mobile.toolDetails.copy.input", "agents.mobile.toolDetails.copied.input"],
  ["agents.activity.output", "agents.mobile.toolDetails.copy.output", "agents.mobile.toolDetails.copied.output"],
  ["agents.toolDetails.errorOutput", "agents.mobile.toolDetails.copy.errorOutput", "agents.mobile.toolDetails.copied.errorOutput"],
  ["agents.toolDetails.terminalInput", "agents.mobile.toolDetails.copy.terminalInput", "agents.mobile.toolDetails.copied.terminalInput"],
  ["agents.toolDetails.exitCode", "agents.mobile.toolDetails.copy.exitCode", "agents.mobile.toolDetails.copied.exitCode"],
  ["agents.toolDetails.status", "agents.mobile.toolDetails.copy.status", "agents.mobile.toolDetails.copied.status"],
  ["agents.toolDetails.outputLimit", "agents.mobile.toolDetails.copy.outputLimit", "agents.mobile.toolDetails.copied.outputLimit"],
] as const;

export function agentToolIcon(category: AgentToolCategory) {
  return icons[category];
}

export function AgentToolRow({
  tool,
  active,
  onPress,
}: {
  tool: AgentToolActivity;
  active: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { colors, fonts } = useTheme();
  const presentation = describeAgentTool(tool, t);
  const status = agentToolStatus(tool, active);
  const statusLabel = t(`agents.activity.toolStatus.${status}`);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        presentation.summary
          ? t("agents.activity.toolStepAriaWithSummary", {
              label: presentation.label,
              summary: presentation.summary,
              status: statusLabel,
            })
          : t("agents.activity.toolGroupAria", {
              label: presentation.label,
              status: statusLabel,
            })
      }
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        borderRadius: 10,
        paddingHorizontal: 6,
        paddingVertical: 6,
        backgroundColor: pressed ? colors.muted : "transparent",
      })}
    >
      <Ionicons
        name={icons[presentation.category]}
        size={16}
        color={colors.mutedForeground}
      />
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text
          style={{
            color: colors.foreground,
            fontFamily: fonts.sansMedium,
            fontSize: 13,
          }}
        >
          {presentation.label}
        </Text>
        {!!presentation.summary && (
          <Text
            numberOfLines={1}
            style={{
              color: colors.mutedForeground,
              fontFamily: fonts.mono,
              fontSize: 11,
            }}
          >
            {presentation.summary}
          </Text>
        )}
      </View>
      {status === "running" ? (
        <AgentWorkingIndicator label={t("agents.mobile.toolDetails.toolRunning")} />
      ) : (
        <Ionicons
          name={
            status === "failed"
              ? "alert-circle-outline"
              : status === "completed"
                ? "checkmark"
                : "remove-outline"
          }
          size={16}
          color={
            status === "failed" ? colors.destructive : colors.mutedForeground
          }
        />
      )}
      <Ionicons
        name="chevron-forward"
        size={14}
        color={colors.mutedForeground}
      />
    </Pressable>
  );
}

export function AgentToolDetails({
  tool,
  active,
}: {
  tool: AgentToolActivity;
  active: boolean;
}) {
  const { t } = useTranslation();
  const status = agentToolStatus(tool, active);
  const details = toolDetails(tool, t);
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {status === "running" && (
          <AgentWorkingIndicator label={t("agents.mobile.toolDetails.toolRunning")} />
        )}
        <AgentText muted={status !== "failed"} danger={status === "failed"}>
          {tool.cancelled
            ? t("agents.toolDetails.cancelled")
            : status === "running"
              ? t("agents.mobile.toolDetails.statusRunning")
              : status === "failed"
                ? t("agents.mobile.toolDetails.statusFailed")
                : status === "completed"
                  ? t("agents.mobile.toolDetails.statusCompleted")
                  : t("agents.mobile.toolDetails.statusStopped")}
        </AgentText>
      </View>
      <AgentDetailSections sections={details.sections} />
      {!details.sections.length && (
        <AgentText muted>
          {status === "running"
            ? t("agents.mobile.toolDetails.waitingForOutput")
            : t("agents.mobile.toolDetails.noDetails")}
        </AgentText>
      )}
    </View>
  );
}

export function AgentDetailSections({ sections }: { sections: ToolSection[] }) {
  return (
    <View style={{ gap: 12 }}>
      {sections.map((section, index) => (
        <DetailSection key={`${index}:${section.label}`} section={section} />
      ))}
    </View>
  );
}

function DetailSection({ section }: { section: ToolSection }) {
  const { t } = useTranslation();
  const locale = useFormatLocale();
  const { colors, fonts, scheme } = useTheme();
  const [limit, setLimit] = useState(80);
  const [copied, setCopied] = useState(false);
  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  const lines = section.value.split("\n");
  // Keep large command output responsive. Full content remains available through
  // explicit expansion and copying, including during streamed updates.
  const shown = lines
    .slice(0, limit)
    .join("\n")
    .slice(0, limit * 250);
  const more = shown.length < section.value.length;
  const diff = section.kind === "diff";
  const code = {
    fontFamily: fonts.mono,
    fontSize: 12,
    lineHeight: 19,
    color: colors.foreground,
  };
  if (section.kind === "text")
    return (
      <View style={{ gap: 4, paddingHorizontal: 2 }}>
        <Text
          style={{
            color: colors.mutedForeground,
            fontFamily: fonts.sansMedium,
            fontSize: 12,
          }}
        >
          {section.label}
        </Text>
        <Text
          selectable
          style={{
            color: colors.foreground,
            fontFamily: fonts.sansRegular,
            fontSize: 13,
            lineHeight: 20,
          }}
        >
          {section.value}
        </Text>
      </View>
    );
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 12,
        overflow: "hidden",
        backgroundColor: colors.card,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingLeft: 12,
          borderBottomWidth: 1,
          borderColor: colors.border,
        }}
      >
        <Text
          style={{
            flex: 1,
            fontFamily: fonts.sansMedium,
            fontSize: 12,
            color: colors.mutedForeground,
          }}
        >
          {section.label}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={(() => {
            const known = KNOWN_SECTION_COPY_KEYS.find(
              ([labelKey]) => t(labelKey) === section.label,
            );
            if (known) return t(copied ? known[2] : known[1]);
            return copied
              ? t("agents.mobile.messages.copiedSectionLabel", {
                  label: section.label,
                })
              : t("agents.mobile.messages.copySectionLabel", {
                  label: section.label,
                });
          })()}
          onPress={() => {
            void Clipboard.setStringAsync(section.value)
              .then(() => {
                if (!mounted.current) return;
                setCopied(true);
                clearTimeout(timer.current);
                timer.current = setTimeout(() => setCopied(false), 1200);
              })
              .catch((cause) =>
                toastError(t("agents.mobile.messages.copyFailed"), cause),
              );
          }}
          style={{
            width: 44,
            height: 44,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons
            name={copied ? "checkmark" : "copy-outline"}
            size={16}
            color={colors.mutedForeground}
          />
        </Pressable>
      </View>
      <ScrollView
        horizontal
        nestedScrollEnabled
        contentContainerStyle={{ paddingVertical: 10, minWidth: "100%" }}
      >
        {diff ? (
          <View style={{ minWidth: "100%" }}>
            {shown.split("\n").map((line, index) => {
              const added = line.startsWith("+") && !line.startsWith("+++");
              const removed = line.startsWith("-") && !line.startsWith("---");
              return (
                <Text
                  selectable
                  key={index}
                  style={{
                    ...code,
                    paddingHorizontal: 12,
                    backgroundColor: added
                      ? "#22c55e18"
                      : removed
                        ? "#ef444418"
                        : "transparent",
                    color: added
                      ? scheme === "dark"
                        ? "#86efac"
                        : "#166534"
                      : removed
                        ? scheme === "dark"
                          ? "#fca5a5"
                          : "#991b1b"
                        : colors.foreground,
                  }}
                >
                  {line || " "}
                </Text>
              );
            })}
          </View>
        ) : (
          <Text selectable style={{ ...code, paddingHorizontal: 12 }}>
            {shown || t("agents.mobile.toolDetails.empty")}
          </Text>
        )}
      </ScrollView>
      {more && (
        <AgentButton
          label={t("common.actions.showMore")}
          detail={t("agents.mobile.toolDetails.linesTotal", {
            formattedCount: lines.length.toLocaleString(locale),
          })}
          icon="chevron-down"
          onPress={() => setLimit((value) => value + 160)}
        />
      )}
    </View>
  );
}
