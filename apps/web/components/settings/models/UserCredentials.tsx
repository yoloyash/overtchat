"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { toast } from "@/components/ui/toast";
import { getErrorMessage } from "@/lib/errors";
import type { AdminModelUserCredential } from "@/lib/model-config/schema";
import {
  useModelUserCredentials,
  useSetModelUserCredential,
} from "@/lib/queries/modelConfigs";
import { useUsers, type UserRow } from "@/lib/queries/users";
import { SettingsNotice, SettingsRow, SettingsSection } from "../SettingsRows";

/** Each person's own key and endpoint for a model whose credentials are per user. */
export function UserCredentials({
  modelId,
  defaultBaseUrl,
}: {
  modelId: string;
  defaultBaseUrl: string;
}) {
  const { data: users = [], error: usersError, isSuccess: usersLoaded } = useUsers();
  const {
    data: credentials = [],
    error: credentialsError,
    isSuccess: credentialsLoaded,
  } = useModelUserCredentials(modelId);
  const byUser = new Map(credentials.map((c) => [c.userId, c]));
  const error = usersError ?? credentialsError;
  // Rows only once BOTH have loaded: a row shown before its saved credential arrives would look
  // like it uses the defaults, and editing it would overwrite the saved key and endpoint.
  const ready = usersLoaded && credentialsLoaded;

  return (
    <SettingsSection
      title="People"
      description="Each person can chat with their own key and endpoint. Leave a field empty to use the model's own."
    >
      {error && (
        <SettingsNotice tone="error">
          {getErrorMessage(error, "Couldn't load people")}
        </SettingsNotice>
      )}
      {!ready && !error && <SettingsNotice>Loading people…</SettingsNotice>}
      {ready && users.map((u) => (
        <UserCredentialRow
          key={u.id}
          modelId={modelId}
          user={u}
          defaultBaseUrl={defaultBaseUrl}
          credential={byUser.get(u.id)}
        />
      ))}
    </SettingsSection>
  );
}

function UserCredentialRow({
  modelId,
  user,
  defaultBaseUrl,
  credential,
}: {
  modelId: string;
  user: UserRow;
  defaultBaseUrl: string;
  credential?: Pick<AdminModelUserCredential, "apiKey" | "baseUrl">;
}) {
  const [editing, setEditing] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const setMut = useSetModelUserCredential(modelId);
  const inputId = `cred-${user.id}`;
  const who = user.name || user.email;
  const hasOwn = !!(credential?.apiKey || credential?.baseUrl);

  function startEditing() {
    // From the credential as it is NOW (it may have loaded after this row first rendered), so
    // saving one field never silently drops the other.
    setApiKey(credential?.apiKey ?? "");
    setBaseUrl(credential?.baseUrl ?? "");
    setEditing(true);
  }

  async function save(remove: boolean) {
    const key = apiKey.trim() || null;
    const url = baseUrl.trim() || null;
    // Both fields empty means the model's own key and endpoint: the same as no credential.
    const removing = remove || (!key && !url);
    try {
      await setMut.mutateAsync({
        userId: user.id,
        input: removing ? null : { apiKey: key, baseUrl: url },
      });
      setEditing(false);
      setApiKey("");
      toast.success({
        title: removing ? "Using the model's own credentials" : "Credential saved",
        description: who,
      });
    } catch (err) {
      toast.error({
        title: "Couldn't save credential",
        description: getErrorMessage(err, "Request failed"),
      });
    }
  }

  const status = hasOwn
    ? [
        credential?.apiKey ? `own key ${maskKey(credential.apiKey)}` : null,
        credential?.baseUrl ? `own endpoint ${credential.baseUrl}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "Uses the model's key and endpoint";

  return (
    <SettingsRow
      title={user.name || user.email}
      description={editing ? undefined : `${user.email} · ${status}`}
      htmlFor={editing ? inputId : undefined}
    >
      {editing ? (
        // Its own form: Enter saves this credential, never the surrounding model.
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save(false);
          }}
        >
          <PasswordInput
            id={inputId}
            aria-label={`API key for ${who}`}
            autoComplete="new-password"
            placeholder="Leave empty to use the model's key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <Input
            aria-label={`Endpoint for ${who}`}
            placeholder={`Leave empty to use ${defaultBaseUrl}`}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={setMut.isPending}
              aria-label={`Save credential for ${who}`}
            >
              Save
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex justify-end gap-2">
          {hasOwn && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={setMut.isPending}
              aria-label={`Remove credential for ${who}`}
              onClick={() => void save(true)}
            >
              Remove
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={`${hasOwn ? "Change" : "Set up"} credential for ${who}`}
            onClick={startEditing}
          >
            {hasOwn ? "Change" : "Set up"}
          </Button>
        </div>
      )}
    </SettingsRow>
  );
}

/** The last characters of a key, the way the model's own previously used keys are shown. */
function maskKey(apiKey: string): string {
  return `····${apiKey.length > 4 ? apiKey.slice(-4) : ""}`;
}
