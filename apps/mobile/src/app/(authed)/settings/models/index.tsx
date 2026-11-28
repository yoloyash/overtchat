import { useTranslation } from "react-i18next";
import { SettingsModelIcon } from "@/components/settings/SettingsModelIcon";
import { SettingsStatus } from "@/components/settings/SettingsStatus";
import { useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import {
  providerLabel,
  type SettingsModelConfig,
} from "@/lib/settings-model";
import { AdminGate } from "@/components/settings/AdminGate";
import {
  SettingsPage,
  Section,
  Row,
  SearchField,
  Choice,
  QueryState,
  Label,
  useRefreshOnFocus,
} from "@/components/settings/SettingsUI";
import {
  useSettingsQuery,
  useSettingsMutation,
  useReorderSettingsModels,
} from "@/lib/queries/settings";
import { useTheme } from "@/lib/theme";
export default function Models() {
  return (
    <AdminGate>
      <ModelList />
    </AdminGate>
  );
}
function ModelList() {
  const { t } = useTranslation();
  const query = useSettingsQuery<{ modelConfigs: SettingsModelConfig[] }>(
    "/model-configs?admin=1",
    true,
  );
  const mutation = useSettingsMutation();
  const reorder = useReorderSettingsModels();
  const moving = useRef(false);
  const [reordering, setReordering] = useState(false);
  const [search, setSearch] = useState("");
  const { colors, fonts } = useTheme();
  useRefreshOnFocus(query.refetch);
  const models = query.data?.modelConfigs ?? [];
  const filtered = models.filter((m) =>
    `${m.label} ${m.model} ${providerLabel(m, t)}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const busy = mutation.isPending || reorder.isPending || query.isFetching;
  const modeDisabled = reordering
    ? reorder.isPending
    : busy || !!search || models.length < 2 || !!query.error;
  function move(id: string, offset: -1 | 1) {
    if (!reordering || search || busy || moving.current || query.error) return;
    const index = models.findIndex((model) => model.id === id);
    if (index < 0 || index + offset < 0 || index + offset >= models.length)
      return;
    const ids = models.map((model) => model.id);
    [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
    moving.current = true;
    void reorder
      .mutateAsync(ids)
      .catch(() => {
        // The mutation restores the list and exposes the error beside its controls.
      })
      .finally(() => {
        moving.current = false;
      });
  }
  return (
    <SettingsPage
      title={t("models.page.title")}
      action={{
        label: t("models.page.addModel"),
        icon: "add",
        disabled: reorder.isPending,
        onPress: () => router.push("/settings/models/new"),
      }}
    >
      <QueryState query={query} />
      {query.data && (
        <>
          {!reordering && (
            <SearchField
              label={t("models.page.searchLabel")}
              value={search}
              onChangeText={setSearch}
            />
          )}
          <View style={{ gap: 8 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <Text
                accessibilityRole="header"
                style={{
                  color: colors.foreground,
                  fontFamily: fonts.sansSemiBold,
                  fontSize: 16,
                  flex: 1,
                }}
              >
                {t("models.mobile.list.availableTitle")}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  reordering
                    ? t("models.mobile.list.doneReorderingLabel")
                    : t("models.mobile.list.reorderLabel")
                }
                accessibilityState={{ disabled: modeDisabled }}
                disabled={modeDisabled}
                onPress={() => {
                  reorder.reset();
                  setReordering(!reordering);
                }}
                style={({ pressed }) => ({
                  minHeight: 44,
                  justifyContent: "center",
                  paddingHorizontal: 8,
                  opacity: pressed || modeDisabled ? 0.45 : 1,
                })}
              >
                <Text
                  style={{
                    color: colors.foreground,
                    fontFamily: fonts.sansMedium,
                    fontSize: 15,
                  }}
                >
                  {reordering
                    ? t("common.actions.done")
                    : t("models.mobile.list.reorder")}
                </Text>
              </Pressable>
            </View>
            {!!search && (
              <Label muted>{t("models.page.reorderClearSearch")}</Label>
            )}
            {reordering && (
              <Label muted>
                {reorder.isPending
                  ? t("models.mobile.list.savingOrder")
                  : t("models.mobile.list.reorderHint")}
              </Label>
            )}
            {reorder.error && <Label error>{reorder.error.message}</Label>}
            <Section
              description={
                reordering
                  ? undefined
                  : t("models.mobile.list.sectionDescription")
              }
            >
              {filtered.map((m, index) => (
                <Row
                  key={m.id}
                  title={m.label}
                  leading={
                    <SettingsModelIcon
                      provider={m.providerId}
                      model={m.model}
                    />
                  }
                  detail={t(
                    m.modelType === "chat"
                      ? "models.mobile.list.rowDetailChat"
                      : "models.mobile.list.rowDetailImage",
                    { provider: providerLabel(m, t) },
                  )}
                  status={
                    <SettingsStatus
                      label={t(
                        m.enabled
                          ? m.taskModel
                            ? "models.mobile.list.statusEnabledTask"
                            : "models.mobile.list.statusEnabled"
                          : m.taskModel
                            ? "models.mobile.list.statusDisabledTask"
                            : "models.mobile.list.statusDisabled",
                      )}
                      state={m.enabled ? "ready" : "neutral"}
                    />
                  }
                  navigation={!reordering}
                  onPress={
                    reordering
                      ? undefined
                      : () =>
                          router.push({
                            pathname: "/settings/models/[id]",
                            params: { id: m.id },
                          })
                  }
                >
                  {reordering && (
                    <View style={{ flexDirection: "row", gap: 2 }}>
                      <MoveButton
                        label={t("models.item.moveUpLabel", { label: m.label })}
                        direction="up"
                        disabled={busy || !!query.error || index === 0}
                        onPress={() => move(m.id, -1)}
                      />
                      <MoveButton
                        label={t("models.item.moveDownLabel", { label: m.label })}
                        direction="down"
                        disabled={
                          busy || !!query.error || index === models.length - 1
                        }
                        onPress={() => move(m.id, 1)}
                      />
                    </View>
                  )}
                </Row>
              ))}
              {!!models.length && !filtered.length && (
                <Row
                  title={t("models.mobile.list.noMatchesTitle")}
                  detail={t("models.mobile.list.noMatchesDetail")}
                />
              )}
              {!models.length && (
                <Row
                  title={t("models.mobile.list.emptyTitle")}
                  detail={t("models.mobile.list.emptyDetail")}
                />
              )}
            </Section>
          </View>
          <Section
            title={t("models.backgroundTasks.title")}
            description={t("models.mobile.list.backgroundTasksDescription")}
          >
            <Choice
              title={t("models.backgroundTasks.taskModelTitle")}
              searchLabel={t("models.mobile.list.searchTaskModel")}
              value={models.find((m) => m.taskModel)?.id ?? ""}
              disabled={mutation.isPending || reorder.isPending}
              options={[
                {
                  value: "",
                  label: t("models.backgroundTasks.sameAsChatModel"),
                },
                ...models
                  .filter((m) => m.modelType === "chat")
                  .map((m) => ({
                    value: m.id,
                    label: m.label,
                    leading: (
                      <SettingsModelIcon
                        provider={m.providerId}
                        model={m.model}
                      />
                    ),
                  })),
              ]}
              onChange={(id) =>
                mutation.mutate({
                  path: "/model-configs/task-model",
                  method: "PUT",
                  body: { modelConfigId: id || null },
                })
              }
            />
          </Section>
        </>
      )}
      {mutation.error && <Label error>{mutation.error.message}</Label>}
    </SettingsPage>
  );
}

function MoveButton({
  label,
  direction,
  disabled,
  onPress,
}: {
  label: string;
  direction: "up" | "down";
  disabled: boolean;
  onPress: () => void;
}) {
  const { colors, radii } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 44,
        minHeight: 44,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radii.md,
        backgroundColor: pressed ? colors.accent : colors.muted,
        opacity: disabled ? 0.35 : 1,
      })}
    >
      <Ionicons
        name={direction === "up" ? "arrow-up" : "arrow-down"}
        size={20}
        color={colors.foreground}
      />
    </Pressable>
  );
}
