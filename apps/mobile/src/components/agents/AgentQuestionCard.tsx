import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  agentQuestionFields,
  initialQuestionValues,
  interactionFormComplete,
  normalizeFormValues,
  questionOptions,
  questionResponse,
  dismissQuestion,
  questionAnswerValues,
  toggleQuestionOption,
  type AgentQuestionRequest,
  type AgentQuestionResponse,
} from "@overtchat/shared/agent-interaction";
import type { AgentInteractionValue } from "@overtchat/agent-bridge";
import { useTheme } from "@/lib/theme";

export function AgentQuestionCard({
  request,
  pending,
  error,
  onRespond,
}: {
  request: AgentQuestionRequest;
  pending: boolean;
  error?: string;
  onRespond: (response: AgentQuestionResponse) => void;
}) {
  const { colors, fonts } = useTheme();
  const fields = agentQuestionFields(request);
  const [values, setValues] = useState(() => initialQuestionValues(fields));
  const [index, setIndex] = useState(0);
  const [customTexts, setCustomTexts] = useState<Record<string, string>>({});
  const field = fields[index];
  const answers = questionAnswerValues(fields, values, customTexts);
  const normalized = normalizeFormValues(fields, answers);
  const answered = (at: number) =>
    !!fields[at] && interactionFormComplete([fields[at]], normalized);
  const last = index === fields.length - 1;
  const complete =
    fields.length > 0 && interactionFormComplete(fields, normalized);
  const disabled = pending || (last ? !complete : !answered(index));
  const typography = {
    fontFamily: fonts.sansRegular,
    fontSize: 14,
    lineHeight: 22,
    color: colors.foreground,
  };
  function change(value: AgentInteractionValue) {
    if (pending) return;
    setCustomTexts((current) => ({ ...current, [field.id]: "" }));
    setValues((current) => ({ ...current, [field.id]: value }));
  }
  function changeText(text: string) {
    if (pending) return;
    if (field.type === "select" || field.type === "multiselect") {
      setCustomTexts((current) => ({ ...current, [field.id]: text }));
      setValues((current) => ({ ...current, [field.id]: "" }));
    } else change(text);
  }
  function primary() {
    if (disabled) return;
    if (last) onRespond(questionResponse(request, fields, answers));
    else setIndex(index + 1);
  }
  const value = field ? values[field.id] : undefined;
  return (
    <View
      testID="agent-question-card"
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      {fields.length > 1 && (
        <View accessibilityRole="tablist" style={styles.tabs}>
          {fields.map((item, at) => (
            <Pressable
              key={item.id}
              accessibilityRole="tab"
              accessibilityLabel={`Question ${at + 1} of ${fields.length}: ${item.label}`}
              accessibilityState={{ selected: at === index, disabled: pending }}
              disabled={pending}
              onPress={() => setIndex(at)}
              style={[
                styles.tab,
                {
                  borderColor:
                    at === index ? colors.mutedForeground : colors.border,
                  backgroundColor: at === index ? colors.muted : colors.card,
                },
              ]}
            >
              {answered(at) && (
                <Ionicons
                  name="checkmark"
                  size={12}
                  color={colors.mutedForeground}
                />
              )}
              <Text
                style={[
                  typography,
                  {
                    color:
                      at === index ? colors.foreground : colors.mutedForeground,
                  },
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      <Text
        accessibilityRole="header"
        accessibilityLiveRegion="polite"
        style={[typography, styles.heading]}
      >
        {field?.description ||
          field?.label ||
          "The agent did not provide any answer fields."}
      </Text>
      {field && (
        <View key={field.id} style={{ gap: 8 }}>
          {questionOptions(field).length > 0 && (
            <View
              accessibilityRole={
                field.type === "multiselect" ? undefined : "radiogroup"
              }
              accessibilityLabel={`Choices for ${field.description || field.label}`}
              style={{ gap: 4 }}
            >
              {questionOptions(field).map((option) => {
                const selected =
                  field.type === "boolean"
                    ? value === (option.value === "true")
                    : Array.isArray(value)
                      ? value.includes(option.value)
                      : value === option.value;
                const multi = field.type === "multiselect";
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole={multi ? "checkbox" : "radio"}
                    accessibilityLabel={option.label}
                    accessibilityState={{
                      checked: selected,
                      disabled: pending,
                    }}
                    disabled={pending}
                    onPress={() => {
                      const next = toggleQuestionOption(
                        field,
                        value,
                        option.value,
                      );
                      change(next);
                      if (!multi && next !== "" && !last) setIndex(index + 1);
                    }}
                    style={({ pressed }) => [
                      styles.option,
                      {
                        backgroundColor:
                          selected || pressed ? colors.muted : "transparent",
                        opacity: pending ? 0.5 : 1,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.control,
                        {
                          borderRadius: multi ? 4 : 9,
                          borderColor: selected
                            ? colors.primary
                            : colors.mutedForeground,
                          backgroundColor:
                            selected && multi ? colors.primary : "transparent",
                        },
                      ]}
                    >
                      {selected &&
                        (multi ? (
                          <Ionicons
                            name="checkmark"
                            size={12}
                            color={colors.primaryForeground}
                          />
                        ) : (
                          <View
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: 4,
                              backgroundColor: colors.primary,
                            }}
                          />
                        ))}
                    </View>
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text
                        style={[
                          typography,
                          {
                            color: selected
                              ? colors.foreground
                              : colors.mutedForeground,
                          },
                        ]}
                      >
                        {option.label}
                      </Text>
                      {!!option.description && (
                        <Text
                          style={[
                            typography,
                            { lineHeight: 20, color: colors.mutedForeground },
                          ]}
                        >
                          {option.description}
                        </Text>
                      )}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
          {(field.type === "text" ||
            field.type === "number" ||
            field.allowOther) && (
            <TextInput
              accessibilityLabel={field.description || field.label}
              value={
                field.type === "select" || field.type === "multiselect"
                  ? (customTexts[field.id] ?? "")
                  : String(value ?? "")
              }
              onChangeText={changeText}
              placeholder={
                field.placeholder ||
                (field.options.length
                  ? "Other (type your answer)"
                  : "Type your answer")
              }
              placeholderTextColor={colors.mutedForeground}
              editable={!pending}
              secureTextEntry={field.secret}
              multiline={request.method === "editor" && !field.secret}
              keyboardType={
                field.type === "number" ? "numbers-and-punctuation" : "default"
              }
              onSubmitEditing={primary}
              submitBehavior={
                request.method === "editor" ? "newline" : "submit"
              }
              style={[
                typography,
                styles.input,
                { backgroundColor: colors.muted, borderColor: colors.border },
              ]}
            />
          )}
        </View>
      )}
      {!!error && (
        <Text
          accessibilityRole="alert"
          style={[typography, { color: colors.destructive }]}
        >
          {error}
        </Text>
      )}
      <View style={{ gap: 8 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            typeof request.dismissLabel === "string"
              ? request.dismissLabel
              : "Dismiss"
          }
          accessibilityState={{ disabled: pending }}
          disabled={pending}
          onPress={() => onRespond(dismissQuestion(request, fields))}
          style={[
            styles.action,
            { borderColor: colors.border, opacity: pending ? 0.5 : 1 },
          ]}
        >
          <Ionicons name="close" size={14} color={colors.mutedForeground} />
          <Text style={[typography, { color: colors.mutedForeground }]}>
            {typeof request.dismissLabel === "string"
              ? request.dismissLabel
              : "Dismiss"}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={last ? "Submit" : "Next"}
          accessibilityState={{ disabled, busy: pending }}
          disabled={disabled}
          onPress={primary}
          style={[
            styles.action,
            {
              backgroundColor: colors.primary,
              borderColor: colors.primary,
              opacity: disabled ? 0.5 : 1,
            },
          ]}
        >
          {pending ? (
            <ActivityIndicator size="small" color={colors.primaryForeground} />
          ) : (
            <Ionicons
              name="checkmark"
              size={14}
              color={colors.primaryForeground}
            />
          )}
          <Text style={[typography, { color: colors.primaryForeground }]}>
            {last ? "Submit" : "Next"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    marginTop: 12,
  },
  tabs: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    paddingHorizontal: 12,
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 28,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  heading: { paddingHorizontal: 12, paddingBottom: 4 },
  option: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    minHeight: 44,
  },
  control: {
    width: 18,
    height: 18,
    borderWidth: 1,
    marginTop: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  input: { borderWidth: 1, borderRadius: 8, padding: 12 },
  action: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    minHeight: 44,
    borderRadius: 6,
    borderWidth: 1,
  },
});
