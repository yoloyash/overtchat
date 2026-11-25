import { ErrorNotice } from "@/components/ErrorNotice";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, View } from "react-native";
import type {
  AgentProviderId,
  AgentMode,
  AgentModel,
  AgentSelectOption,
} from "@overtchat/agent-bridge";
import { i18n } from "@overtchat/shared/i18n";
import { thinkingOptionLabel } from "@/lib/agents/model";
import {
  AgentButton,
  AgentInput,
  AgentSheet,
  AgentText,
} from "./AgentPrimitives";

import { AgentProviderIcon } from "./AgentProviderIcon";

export type AgentSettingsPanel = "settings" | "models" | "thinking" | "permissions";

export function chooseAgentMode(mode: AgentMode, apply: () => void) {
  if (!mode.dangerous) {
    apply();
    return;
  }
  Alert.alert(
    i18n.t("agents.composer.enableModeTitle", { mode: mode.label }),
    mode.description || i18n.t("agents.mobile.controls.enableModeFallback"),
    [
      { text: i18n.t("agents.common.cancel"), style: "cancel" },
      {
        text: i18n.t("agents.mobile.controls.enable"),
        style: "destructive",
        onPress: apply,
      },
    ],
  );
}

export function AgentControls({
  visible,
  initialPanel = "settings",
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
  /** The panel shown when the sheet opens. */
  initialPanel?: AgentSettingsPanel;
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
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [panel, setPanel] = useState<AgentSettingsPanel>("settings");
  useEffect(() => {
    if (visible) {
      setPanel(initialPanel);
      setSearch("");
    }
  }, [visible, initialPanel]);
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
          ? t("agents.mobile.controls.chooseModel")
          : panel === "thinking"
            ? t("agents.mobile.controls.reasoningEffort")
            : panel === "permissions"
              ? t("agents.composer.permissions")
              : t("agents.mobile.controls.agentSettings")
      }
      visible={visible}
      onClose={close}
    >
      {!!error && <ErrorNotice message={error} />}
      {!!notice && <AgentText muted>{notice}</AgentText>}
      {panel !== "settings" && (
        <AgentButton
          label={t("agents.mobile.controls.agentSettings")}
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
            label={t("agents.composer.model")}
            detail={model?.label ?? (modelId || t("agents.terminal.unavailable"))}
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
              label={t("agents.mobile.controls.reasoningEffort")}
              detail={
                thinking !== undefined
                  ? (thinkingOptionLabel(
                      thinking,
                      model.thinkingOptions.find(
                        (option) => option.id === thinking,
                      )?.label,
                      t,
                    ) ?? thinking)
                  : t("agents.composer.thinking.default")
              }
              icon="sparkles-outline"
              chevron
              disabled={disabled}
              onPress={() => setPanel("thinking")}
            />
          )}
          {!!modes.length && (
            <AgentButton
              label={t("agents.composer.permissions")}
              detail={
                modes.find((mode) => mode.id === modeId)?.label ??
                t("agents.composer.thinking.default")
              }
              icon="shield-checkmark-outline"
              chevron
              disabled={disabled}
              onPress={() => setPanel("permissions")}
            />
          )}
          {onPlan && (
            <AgentButton
              label={t("agents.composer.planMode")}
              detail={
                planMode
                  ? t("agents.mobile.controls.planOn")
                  : t("agents.mobile.controls.planOff")
              }
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
            accessibilityLabel={t("app.modelPicker.searchModels")}
            placeholder={t("app.modelPicker.searchModels")}
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
          ) && <AgentText muted>{t("agents.composer.noMatchingModels")}</AgentText>}
        </>
      ) : panel === "thinking" ? (
        <>
          {model?.thinkingOptions?.map((option) => (
            <AgentButton
              key={option.id}
              label={thinkingOptionLabel(option.id, option.label, t) ?? option.label}
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
              danger={mode.dangerous}
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
