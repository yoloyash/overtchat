import { useState } from "react";
import { Linking, View } from "react-native";
import type {
  AgentRuntimeSnapshot,
  AgentSessionCommand,
} from "@overtchat/agent-bridge";
import { safeExternalUrl } from "@overtchat/shared/agent-interaction";
import { approvalDetails } from "@/lib/agents/tool-details";
import { AgentDetailSections } from "./AgentToolDetails";
import { AgentApprovalActions } from "./AgentApprovalActions";
import { text } from "@/lib/agents/model";
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
  const [linkError, setLinkError] = useState<string>();
  const approval = approvalDetails(request);
  const tool = approval.choices.length > 0;
  const url = safeExternalUrl(request.url);
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
        approval.category === "edit" &&
        !approval.sections.some(
          (section) =>
            section.kind === "diff" ||
            ["Before", "After"].includes(section.label),
        ) && (
          <AgentText muted>
            The agent did not provide a change preview.
          </AgentText>
        )}
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
      {request.method !== "external" && !tool && (
        <AgentText muted>
          This interaction requires the web app. You can cancel it here.
        </AgentText>
      )}
      {!!(error || linkError) && (
        <AgentText danger>{error || linkError}</AgentText>
      )}
      {!tool && (
        <View style={{ gap: 4 }}>
          {request.method === "external" && (
            <AgentButton
              label="Submit response"
              disabled={pending || !url}
              onPress={() => onRespond({ confirmed: true })}
            />
          )}
          <AgentButton
            label="Cancel request"
            disabled={pending}
            onPress={() => onRespond({ cancelled: true })}
          />
        </View>
      )}
    </AgentSheet>
  );
}
