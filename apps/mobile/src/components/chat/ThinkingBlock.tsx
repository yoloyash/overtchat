import { Feather } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { LayoutAnimation, Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/lib/theme";
import { MarkdownBody } from "./MarkdownBody";

export function ThinkingBlock({
  content,
  active,
}: {
  content: string;
  active: boolean;
}) {
  const { colors, fonts } = useTheme();
  const [open, setOpen] = useState(false);
  const [duration, setDuration] = useState(0);
  const startedAtRef = useRef<number | null>(null);
  const settledRef = useRef(false);

  useEffect(() => {
    if (active) {
      if (startedAtRef.current == null) startedAtRef.current = Date.now();
      settledRef.current = false;
      const tick = () => {
        if (startedAtRef.current != null) {
          setDuration(Math.floor((Date.now() - startedAtRef.current) / 1000));
        }
      };
      tick();
      const id = setInterval(tick, 1000);
      return () => clearInterval(id);
    }
    if (startedAtRef.current != null && !settledRef.current) {
      settledRef.current = true;
      setDuration(
        Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000)),
      );
    }
  }, [active]);

  const trimmed = content.trim();
  if (!trimmed && !active) return null;

  const label = active
    ? "Thinking…"
    : duration > 0
      ? `Thought for ${duration}s`
      : "Thoughts";

  function toggle() {
    LayoutAnimation.configureNext(
      LayoutAnimation.create(180, "easeInEaseOut", "opacity"),
    );
    setOpen((o) => !o);
  }

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={toggle}
        hitSlop={6}
        style={[styles.header, { backgroundColor: open ? colors.muted : "transparent" }]}
      >
        <Text
          style={[
            styles.label,
            { color: colors.mutedForeground, fontFamily: fonts.sansMedium },
          ]}
        >
          {label}
        </Text>
        <Feather
          name={open ? "chevron-up" : "chevron-down"}
          size={14}
          color={colors.mutedForeground}
        />
      </Pressable>
      {open && trimmed ? (
        <View
          style={[
            styles.body,
            { borderLeftColor: colors.border },
          ]}
        >
          <MarkdownBody text={trimmed} variant="thinking" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginVertical: 2 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  label: { fontSize: 12 },
  body: {
    marginTop: 6,
    paddingLeft: 10,
    borderLeftWidth: 2,
  },
});
