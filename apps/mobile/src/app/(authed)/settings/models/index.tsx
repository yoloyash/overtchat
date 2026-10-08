import { PROVIDERS } from "@overtchat/shared/provider-catalog";
import { SettingsModelIcon } from "@/components/settings/SettingsModelIcon";
import { SettingsStatus } from "@/components/settings/SettingsStatus";
import { useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import type { AdminModelConfig } from "@overtchat/shared/admin-settings";
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
  const query = useSettingsQuery<{ modelConfigs: AdminModelConfig[] }>(
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
    `${m.label} ${m.model} ${PROVIDERS[m.providerId].label}`
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
      title="Models"
      action={{
        label: "Add model",
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
              label="Search models"
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
                Available models
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  reordering ? "Done reordering models" : "Reorder models"
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
                  {reordering ? "Done" : "Reorder"}
                </Text>
              </Pressable>
            </View>
            {!!search && (
              <Label muted>Clear search to change model order.</Label>
            )}
            {reordering && (
              <Label muted>
                {reorder.isPending
                  ? "Saving order…"
                  : "Use the arrows to set the model order for everyone. Changes save automatically."}
              </Label>
            )}
            {reorder.error && <Label error>{reorder.error.message}</Label>}
            <Section
              description={
                reordering
                  ? undefined
                  : "Open a model to edit, test, or change availability."
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
                  detail={`${PROVIDERS[m.providerId].label} · ${m.modelType === "chat" ? "Chat" : "Image"}`}
                  status={
                    <SettingsStatus
                      label={`${m.enabled ? "Enabled" : "Disabled"}${m.taskModel ? " · Task model" : ""}`}
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
                        label={`Move ${m.label} up`}
                        direction="up"
                        disabled={busy || !!query.error || index === 0}
                        onPress={() => move(m.id, -1)}
                      />
                      <MoveButton
                        label={`Move ${m.label} down`}
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
                  title="No matching models"
                  detail="Try another name or provider."
                />
              )}
              {!models.length && (
                <Row
                  title="No models configured"
                  detail="Add your first chat or image model."
                />
              )}
            </Section>
          </View>
          <Section
            title="Background tasks"
            description="The task model generates chat titles for everyone on this server."
          >
            <Choice
              title="Task model"
              value={models.find((m) => m.taskModel)?.id ?? ""}
              disabled={mutation.isPending || reorder.isPending}
              options={[
                { value: "", label: "Same as chat model" },
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
