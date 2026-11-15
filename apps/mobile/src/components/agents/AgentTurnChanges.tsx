import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { AgentTurnChanges } from "@overtchat/agent-bridge";
import {
  agentTurnChangesDirectories,
  agentTurnChangesLabel,
  agentTurnChangesRows,
  buildAgentTurnChangesTree,
  formatAgentChangeCount,
} from "@overtchat/shared/agent-turn-changes";
import { useTheme } from "@/lib/theme";

function LineCounts({
  additions,
  deletions,
  size = 11,
}: {
  additions: number;
  deletions: number;
  size?: number;
}) {
  const { fonts, scheme } = useTheme();
  const dark = scheme === "dark";
  const style = {
    fontFamily: fonts.mono,
    fontSize: size,
    fontVariant: ["tabular-nums" as const],
  };
  return (
    <View
      accessible
      accessibilityLabel={`${additions} added, ${deletions} removed`}
      style={styles.counts}
    >
      <Text style={[style, { color: dark ? "#6ee7b7" : "#047857" }]}>
        +{formatAgentChangeCount(additions)}
      </Text>
      <Text style={[style, { color: dark ? "#fca5a5" : "#b91c1c" }]}>
        -{formatAgentChangeCount(deletions)}
      </Text>
    </View>
  );
}

/** The files one turn changed, as a folder tree with line counts. */
export function AgentTurnChangesCard({
  changes,
  onToggle,
}: {
  changes: AgentTurnChanges;
  /** Called before the card changes height. */
  onToggle: () => void;
}) {
  const { colors, fonts, radii } = useTheme();
  const tree = useMemo(() => buildAgentTurnChangesTree(changes), [changes]);
  const hasDirectories = useMemo(
    () => agentTurnChangesDirectories(tree).length > 0,
    [tree],
  );
  // Folders start closed; each one remembers a press until all are toggled.
  const [allOpen, setAllOpen] = useState(false);
  const [toggled, setToggled] = useState<ReadonlySet<string>>(() => new Set());
  const rows = useMemo(
    () => agentTurnChangesRows(tree, (path) => allOpen !== toggled.has(path)),
    [tree, allOpen, toggled],
  );
  const unlisted = changes.total.files - changes.files.length;
  const counted = changes.total.additions > 0 || changes.total.deletions > 0;
  const name = {
    flexShrink: 1,
    fontFamily: fonts.mono,
    fontSize: 12,
  };

  return (
    <View
      testID="agent-turn-changes"
      style={{
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
        borderRadius: radii.xl,
        backgroundColor: colors.card,
        overflow: "hidden",
      }}
    >
      <View style={styles.header}>
        <Text
          accessibilityRole="header"
          style={{
            color: colors.foreground,
            fontFamily: fonts.sansMedium,
            fontSize: 13,
          }}
        >
          {agentTurnChangesLabel(changes.total.files)}
        </Text>
        {counted && (
          <LineCounts
            additions={changes.total.additions}
            deletions={changes.total.deletions}
            size={12}
          />
        )}
        <View style={{ flex: 1 }} />
        {hasDirectories && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={allOpen ? "Collapse all folders" : "Expand all folders"}
            hitSlop={10}
            onPress={() => {
              onToggle();
              setAllOpen((current) => !current);
              setToggled(new Set());
            }}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <Ionicons
              name={allOpen ? "contract-outline" : "expand-outline"}
              size={15}
              color={colors.mutedForeground}
            />
          </Pressable>
        )}
      </View>
      <View style={styles.rows}>
        {rows.map(({ node, depth }) => {
          const counts = (node.additions > 0 || node.deletions > 0) && (
            <LineCounts additions={node.additions} deletions={node.deletions} />
          );
          const indent = { paddingLeft: 12 + depth * 14 };
          if (node.kind === "directory") {
            const open = allOpen !== toggled.has(node.path);
            return (
              <Pressable
                key={`directory:${node.path}`}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={node.name}
                onPress={() => {
                  onToggle();
                  setToggled((current) => {
                    const next = new Set(current);
                    if (!next.delete(node.path)) next.add(node.path);
                    return next;
                  });
                }}
                style={({ pressed }) => [
                  styles.row,
                  indent,
                  { opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <Ionicons
                  name={open ? "chevron-down" : "chevron-forward"}
                  size={13}
                  color={colors.mutedForeground}
                />
                <Ionicons
                  name={open ? "folder-open-outline" : "folder-outline"}
                  size={14}
                  color={colors.mutedForeground}
                />
                <Text
                  numberOfLines={1}
                  ellipsizeMode="middle"
                  style={[name, { color: colors.mutedForeground }]}
                >
                  {node.name}
                </Text>
                <View style={{ flex: 1 }} />
                {counts}
              </Pressable>
            );
          }
          return (
            <View
              key={`file:${node.path}`}
              testID="agent-turn-changes-file"
              style={[styles.row, indent]}
            >
              {(hasDirectories || depth > 0) && <View style={{ width: 13 }} />}
              <Ionicons
                name="document-outline"
                size={14}
                color={colors.mutedForeground}
              />
              <Text
                numberOfLines={1}
                ellipsizeMode="middle"
                style={[name, { color: colors.foreground }]}
              >
                {node.name}
              </Text>
              <View style={{ flex: 1 }} />
              {counts}
            </View>
          );
        })}
      </View>
      {unlisted > 0 && (
        <Text
          style={{
            color: colors.mutedForeground,
            fontFamily: fonts.sansRegular,
            fontSize: 12,
            paddingHorizontal: 12,
            paddingBottom: 10,
          }}
        >
          and {unlisted.toLocaleString("en-US")} more {unlisted === 1 ? "file" : "files"}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 4,
  },
  rows: { paddingBottom: 6 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    minHeight: 30,
    paddingRight: 12,
  },
  counts: { flexDirection: "row", alignItems: "center", gap: 6 },
});
