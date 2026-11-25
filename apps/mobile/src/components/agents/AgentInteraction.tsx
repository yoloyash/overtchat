import { ErrorNotice } from "@/components/ErrorNotice";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Linking, View } from "react-native";
import type {
  AgentRuntimeSnapshot,
  AgentSessionCommand,
} from "@overtchat/agent-bridge";
import { safeExternalUrl } from "@overtchat/shared/agent-interaction";
import { approvalDetails } from "@/lib/agents/tool-details";
import { AgentDetailSections } from "./AgentToolDetails";
import { AgentApprovalActions } from "./AgentApprovalActions";
import { AgentButton, AgentSheet, AgentText } from "./AgentPrimitives";

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
  const { t } = useTranslation();
  const [linkError, setLinkError] = useState<string>();
  const approval = approvalDetails(request);
  const tool = approval.choices.length > 0;
  const url = safeExternalUrl(request.url);
  return (
    <AgentSheet
      title={approval.title}
      visible={visible}
      onClose={onClose}
      closeLabel={t("agents.mobile.interaction.closeLabel")}
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
        approval.category === "edit" &&
        !approval.sections.some(
          (section) =>
            section.kind === "diff" ||
            [
              t("agents.toolDetails.before"),
              t("agents.toolDetails.after"),
            ].includes(section.label),
        ) && (
          <AgentText muted>
            {t("agents.mobile.interaction.noChangePreview")}
          </AgentText>
        )}
      {request.method === "external" &&
        (url ? (
          <AgentButton
            label={t("agents.dialogs.openAuthPage")}
            onPress={() => {
              void Linking.openURL(url).catch(() =>
                setLinkError(t("agents.mobile.interaction.openAuthFailed")),
              );
            }}
          />
        ) : (
          <AgentText danger>
            {t("agents.mobile.interaction.invalidAuthUrl")}
          </AgentText>
        ))}
      {request.method !== "external" && !tool && (
        <AgentText muted>
          {t("agents.mobile.interaction.webAppRequired")}
        </AgentText>
      )}
      {!!(error || linkError) && (
        <ErrorNotice message={error || linkError} />
      )}
      {!tool && (
        <View style={{ gap: 4 }}>
          {request.method === "external" && (
            <AgentButton
              label={t("agents.mobile.interaction.submitResponse")}
              disabled={pending || !url}
              onPress={() => onRespond({ confirmed: true })}
            />
          )}
          <AgentButton
            label={t("agents.mobile.interaction.cancelRequest")}
            disabled={pending}
            onPress={() => onRespond({ cancelled: true })}
          />
        </View>
      )}
    </AgentSheet>
  );
}
