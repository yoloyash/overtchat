import { useState } from "react";
import { Linking, View } from "react-native";
import type {
  AgentInteractionValue,
  AgentRuntimeSnapshot,
  AgentSessionCommand,
} from "@overtchat/agent-bridge";
import {
  interactionFormFields,
  interactionFormComplete,
  normalizeFormValues,
  safeExternalUrl,
} from "@/lib/agents/interaction";
import { approvalDetails } from "@/lib/agents/tool-details";
import { AgentDetailSections } from "./AgentToolDetails";
import { AgentApprovalActions } from "./AgentApprovalActions";
import { text } from "@/lib/agents/model";
import {
  AgentButton,
  AgentInput,
  AgentSheet,
  AgentText,
} from "./AgentPrimitives";

type Request = NonNullable<AgentRuntimeSnapshot["pendingInteraction"]>;
type Response = Omit<
  Extract<AgentSessionCommand, { type: "interaction_response" }>,
  "type" | "id"
>;

export function AgentInteraction({
  request,
  visible,
  onClose,
  pending,
  error,
  onRespond,
}: {
  request: Request;
  visible: boolean;
  onClose: () => void;
  pending: boolean;
  error?: string;
  onRespond: (response: Response) => void;
}) {
  const fields = interactionFormFields(request.fields);
  const [value, setValue] = useState(text(request.prefill));
  const [values, setValues] = useState<Record<string, AgentInteractionValue>>(
    () =>
      Object.fromEntries(
        fields.flatMap((field) =>
          field.defaultValue === undefined
            ? []
            : [[field.id, field.defaultValue]],
        ),
      ),
  );
  const [linkError, setLinkError] = useState<string>();
  const options = Array.isArray(request.options)
    ? request.options.filter((item): item is string => typeof item === "string")
    : [];
  const approval = approvalDetails(request);
  const tool = approval.choices.length > 0;
  const url = safeExternalUrl(request.url);
  const known = [
    "select",
    "input",
    "editor",
    "form",
    "confirm",
    "external",
  ].includes(request.method);
  const complete =
    request.method === "form"
      ? interactionFormComplete(fields, normalizeFormValues(fields, values))
      : request.method !== "select" || !!value;
  function change(id: string, value: AgentInteractionValue) {
    setValues((current) => ({ ...current, [id]: value }));
  }
  function submit() {
    if (request.method === "form")
      onRespond({ values: normalizeFormValues(fields, values) });
    else if (request.method === "confirm" || request.method === "external")
      onRespond({ confirmed: true });
    else onRespond({ value });
  }
  return (
    <AgentSheet
      title={text(request.title) || "Your agent needs input"}
      visible={visible}
      onClose={onClose}
      closeLabel="Close request"
      snapPoints={["70%", "90%"]}
      footer={
        tool ? (
          <AgentApprovalActions
            choices={approval.choices}
            disabled={pending}
            onChoose={(value) => onRespond({ value })}
          />
        ) : undefined
      }
    >
      {!!approval.message && <AgentText>{approval.message}</AgentText>}
      <AgentDetailSections sections={approval.sections} />
      {tool &&
        (approval.category === "edit" ||
          request.title === "Approve file changes?") &&
        !approval.sections.some(
          (section) =>
            section.kind === "diff" ||
            ["Before", "After"].includes(section.label),
        ) && (
          <AgentText muted>
            The agent did not provide a change preview.
          </AgentText>
        )}
      {request.method === "select" &&
        !tool &&
        options.map((option) => (
          <AgentButton
            key={option}
            label={option}
            selected={value === option}
            disabled={pending}
            onPress={() => setValue(option)}
          />
        ))}
      {(request.method === "input" || request.method === "editor") && (
        <AgentInput
          accessibilityLabel={text(request.title) || "Your response"}
          value={value}
          onChangeText={setValue}
          editable={!pending}
          secureTextEntry={request.secret === true}
          multiline={request.method === "editor"}
          placeholder={text(request.placeholder)}
        />
      )}
      {request.method === "form" &&
        fields.map((field) => (
          <View key={field.id} style={{ gap: 6 }}>
            <AgentText title>
              {field.label}
              {field.required ? " *" : ""}
            </AgentText>
            {!!field.description && (
              <AgentText muted>{field.description}</AgentText>
            )}
            {(field.type === "text" || field.type === "number") && (
              <AgentInput
                accessibilityLabel={field.label}
                editable={!pending}
                secureTextEntry={field.secret}
                keyboardType={
                  field.type === "number"
                    ? "numbers-and-punctuation"
                    : "default"
                }
                value={
                  values[field.id] === undefined ? "" : String(values[field.id])
                }
                onChangeText={(input) => change(field.id, input)}
              />
            )}
            {field.type === "boolean" && (
              <View style={{ flexDirection: "row", gap: 8 }}>
                {[true, false].map((answer) => (
                  <AgentButton
                    key={String(answer)}
                    label={answer ? "Yes" : "No"}
                    selected={values[field.id] === answer}
                    disabled={pending}
                    onPress={() => change(field.id, answer)}
                  />
                ))}
              </View>
            )}
            {(field.type === "select" || field.type === "multiselect") &&
              field.options.map((option) => {
                const selection = values[field.id];
                const multi = Array.isArray(selection) ? selection : [];
                return (
                  <AgentButton
                    key={option.value}
                    label={option.label}
                    disabled={pending}
                    selected={
                      field.type === "select"
                        ? selection === option.value
                        : multi.includes(option.value)
                    }
                    onPress={() =>
                      change(
                        field.id,
                        field.type === "select"
                          ? option.value
                          : multi.includes(option.value)
                            ? multi.filter((item) => item !== option.value)
                            : [...multi, option.value],
                      )
                    }
                  />
                );
              })}
          </View>
        ))}
      {request.method === "external" &&
        (url ? (
          <AgentButton
            label="Open authorization page"
            onPress={() => {
              void Linking.openURL(url).catch(() =>
                setLinkError("Couldn't open the authorization page."),
              );
            }}
          />
        ) : (
          <AgentText danger>
            The agent did not provide a valid authorization URL.
          </AgentText>
        ))}
      {!known && !tool && (
        <AgentText muted>
          This interaction requires the web app. You can cancel it here.
        </AgentText>
      )}
      {!!(error || linkError) && (
        <AgentText danger>{error || linkError}</AgentText>
      )}
      {!tool && (
        <View style={{ gap: 4 }}>
          {known && (
            <AgentButton
              label={request.method === "confirm" ? "Yes" : "Submit response"}
              disabled={
                pending || !complete || (request.method === "external" && !url)
              }
              onPress={submit}
            />
          )}
          <AgentButton
            label={request.method === "confirm" ? "No" : "Cancel request"}
            disabled={pending}
            onPress={() =>
              onRespond(
                request.method === "confirm"
                  ? { confirmed: false }
                  : { cancelled: true },
              )
            }
          />
        </View>
      )}
    </AgentSheet>
  );
}
