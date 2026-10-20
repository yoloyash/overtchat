import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import {
  agentToolStatus,
  describeAgentTool,
  type AgentToolActivity,
  type AgentToolCategory,
} from "@overtchat/shared/agent-presentation";
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
export function AgentToolRow({
  tool,
  active,
  onPress,
}: {
  tool: AgentToolActivity;
  active: boolean;
  onPress: () => void;
}) {
  const { colors, fonts } = useTheme();
  const presentation = describeAgentTool(tool);
  const status = agentToolStatus(tool, active);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${presentation.label}${presentation.summary ? `: ${presentation.summary}` : ""}, ${status}`}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 48,
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
        borderRadius: 10,
        paddingHorizontal: 8,
        paddingVertical: 8,
        backgroundColor: pressed ? colors.muted : "transparent",
      })}
    >
      <Ionicons
        name={icons[presentation.category]}
        size={17}
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
        <AgentWorkingIndicator label="Tool running" />
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
  const status = agentToolStatus(tool, active);
  const details = toolDetails(tool);
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {status === "running" && <AgentWorkingIndicator label="Tool running" />}
        <AgentText muted={status !== "failed"} danger={status === "failed"}>
          {tool.cancelled
            ? "Cancelled"
            : status === "running"
              ? "Running"
              : status === "failed"
                ? "Failed"
                : status === "completed"
                  ? "Completed"
                  : "Stopped"}
        </AgentText>
      </View>
      <AgentDetailSections sections={details.sections} />
      {!details.sections.length && (
        <AgentText muted>
          {status === "running"
            ? "Waiting for output…"
            : "No details were provided by the agent."}
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
          accessibilityLabel={
            copied
              ? `Copied ${section.label.toLowerCase()}`
              : `Copy ${section.label.toLowerCase()}`
          }
          onPress={() => {
            void Clipboard.setStringAsync(section.value)
              .then(() => {
                if (!mounted.current) return;
                setCopied(true);
                clearTimeout(timer.current);
                timer.current = setTimeout(() => setCopied(false), 1200);
              })
              .catch((cause) => toastError("Couldn't copy", cause));
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
            {shown || "(empty)"}
          </Text>
        )}
      </ScrollView>
      {more && (
        <AgentButton
          label="Show more"
          detail={`${lines.length.toLocaleString()} lines total`}
          icon="chevron-down"
          onPress={() => setLimit((value) => value + 160)}
        />
      )}
    </View>
  );
}
