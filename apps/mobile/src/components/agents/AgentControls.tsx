import { useEffect, useState } from "react";
import { Alert, View } from "react-native";
import type {
  AgentProviderId,
  AgentMode,
  AgentModel,
  AgentSelectOption,
} from "@overtchat/agent-bridge";
import {
  AgentButton,
  AgentInput,
  AgentSheet,
  AgentText,
} from "./AgentPrimitives";

import { AgentProviderIcon } from "./AgentProviderIcon";

type AgentSettingsPanel = "settings" | "models" | "thinking" | "permissions";

export function chooseAgentMode(mode: AgentMode, apply: () => void) {
  if (!mode.dangerous) {
    apply();
    return;
  }
  Alert.alert(
    `Enable ${mode.label}?`,
    mode.description ||
      "The agent can run commands and modify files without sandbox restrictions or approval prompts.",
    [
      { text: "Cancel", style: "cancel" },
      { text: "Enable", style: "destructive", onPress: apply },
    ],
  );
}

export function AgentControls({
  visible,
  provider,
  onClose,
  models,
  modelId,
  modes,
  modeId,
  thinking,
  disabled,
  onModel,
  onMode,
  onThinking,
  planMode,
  onPlan,
  error,
  notice,
}: {
  visible: boolean;
  provider?: AgentProviderId;
  onClose: () => void;
  models: AgentModel[];
  modelId: string;
  modes: AgentMode[];
  modeId: string;
  thinking?: string;
  disabled?: boolean;
  onModel: (model: AgentModel) => void;
  onMode: (mode: AgentMode) => void;
  onThinking: (option: AgentSelectOption) => void;
  planMode?: boolean;
  onPlan?: () => void;
  error?: string;
  notice?: string;
}) {
  const [search, setSearch] = useState("");
  const [panel, setPanel] = useState<AgentSettingsPanel>("settings");
  useEffect(() => {
    if (visible) {
      setPanel("settings");
      setSearch("");
    }
  }, [visible]);
  const model = models.find((item) => item.id === modelId);
  const close = () => {
    setPanel("settings");
    setSearch("");
    onClose();
  };
  return (
    <AgentSheet
      title={
        panel === "models"
          ? "Choose model"
          : panel === "thinking"
            ? "Reasoning effort"
            : panel === "permissions"
              ? "Permissions"
              : "Agent settings"
      }
      visible={visible}
      onClose={close}
    >
      {!!error && <AgentText danger>{error}</AgentText>}
      {!!notice && <AgentText muted>{notice}</AgentText>}
      {panel !== "settings" && (
        <AgentButton
          label="Agent settings"
          icon="arrow-back"
          onPress={() => {
            setPanel("settings");
            setSearch("");
          }}
        />
      )}
      {panel === "settings" ? (
        <View style={{ gap: 6 }}>
          <AgentButton
            label="Model"
            detail={model?.label ?? (modelId || "Unavailable")}
            leading={
              provider ? <AgentProviderIcon provider={provider} /> : undefined
            }
            icon="hardware-chip-outline"
            chevron
            disabled={disabled || !models.length}
            onPress={() => setPanel("models")}
          />
          {!!model?.thinkingOptions?.length && (
            <AgentButton
              label="Reasoning effort"
              detail={
                model.thinkingOptions.find((option) => option.id === thinking)
                  ?.label ??
                thinking ??
                "Default"
              }
              icon="sparkles-outline"
              chevron
              disabled={disabled}
              onPress={() => setPanel("thinking")}
            />
          )}
          {!!modes.length && (
            <AgentButton
              label="Permissions"
              detail={
                modes.find((mode) => mode.id === modeId)?.label ?? "Default"
              }
              icon="shield-checkmark-outline"
              chevron
              disabled={disabled}
              onPress={() => setPanel("permissions")}
            />
          )}
          {onPlan && (
            <AgentButton
              label="Plan mode"
              detail={planMode ? "On" : "Off"}
              icon="list-outline"
              selected={planMode}
              disabled={disabled}
              onPress={onPlan}
            />
          )}
        </View>
      ) : panel === "models" ? (
        <>
          <AgentInput
            accessibilityLabel="Search models"
            placeholder="Search models"
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
          />
          {models
            .filter((item) =>
              `${item.label} ${item.id}`
                .toLowerCase()
                .includes(search.toLowerCase()),
            )
            .map((item) => (
              <AgentButton
                key={item.id}
                label={item.label}
                leading={
                  provider ? (
                    <AgentProviderIcon provider={provider} />
                  ) : undefined
                }
                detail={item.description}
                selected={modelId === item.id}
                disabled={disabled}
                onPress={() => {
                  onModel(item);
                  setPanel("settings");
                  setSearch("");
                }}
              />
            ))}
          {!models.some((item) =>
            `${item.label} ${item.id}`
              .toLowerCase()
              .includes(search.toLowerCase()),
          ) && <AgentText muted>No matching models.</AgentText>}
        </>
      ) : panel === "thinking" ? (
        <>
          {model?.thinkingOptions?.map((option) => (
            <AgentButton
              key={option.id}
              label={option.label}
              icon="sparkles-outline"
              detail={option.description}
              selected={thinking === option.id}
              disabled={disabled}
              onPress={() => {
                onThinking(option);
                setPanel("settings");
              }}
            />
          ))}
        </>
      ) : (
        <>
          {modes.map((mode) => (
            <AgentButton
              key={mode.id}
              label={mode.label}
              icon={
                mode.dangerous ? "shield-outline" : "shield-checkmark-outline"
              }
              detail={mode.description}
              selected={modeId === mode.id}
              disabled={disabled}
              onPress={() =>
                chooseAgentMode(mode, () => {
                  onMode(mode);
                  setPanel("settings");
                })
              }
            />
          ))}
        </>
      )}
    </AgentSheet>
  );
}
