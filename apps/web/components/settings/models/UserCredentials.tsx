"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { getErrorMessage } from "@/lib/errors";
import {
  useModelUserCredentials,
  useSetModelUserCredential,
} from "@/lib/queries/modelConfigs";
import { useUsers, type UserRow } from "@/lib/queries/users";
import { SettingsNotice, SettingsRow, SettingsSection } from "../SettingsRows";

/** Each person's own credential for a model whose credentials are per user. */
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
  // "not set up", and editing it would overwrite the saved endpoint.
  const ready = usersLoaded && credentialsLoaded;

  return (
    <SettingsSection
      title="People"
      description="Each person chats with their own key. People without one don't see this model."
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
  credential?: { hasApiKey: boolean; baseUrl: string | null };
}) {
  const [editing, setEditing] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const setMut = useSetModelUserCredential(modelId);
  const inputId = `cred-${user.id}`;
  const who = user.name || user.email;

  function startEditing() {
    // From the credential as it is NOW (it may have loaded after this row first rendered), so saving
    // a new key never silently drops an endpoint override.
    setApiKey("");
    setBaseUrl(credential?.baseUrl ?? "");
    setEditing(true);
  }

  async function save(remove: boolean) {
    try {
      await setMut.mutateAsync({
        userId: user.id,
        input: remove
          ? null
          : {
              // An empty key field keeps the stored key.
              ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
              baseUrl: baseUrl.trim() || null,
            },
      });
      setEditing(false);
      setApiKey("");
      toast.success({
        title: remove ? "Credential removed" : "Credential saved",
        description: user.name || user.email,
      });
    } catch (err) {
      toast.error({
        title: "Couldn't save credential",
        description: getErrorMessage(err, "Request failed"),
      });
    }
  }

  const status = credential
    ? [
        credential.hasApiKey ? "Key set" : "No key",
        credential.baseUrl ? `own endpoint ${credential.baseUrl}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "Not set up";

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
          <Input
            id={inputId}
            aria-label={`API key for ${who}`}
            type="password"
            autoComplete="off"
            placeholder={credential?.hasApiKey ? "New API key (empty keeps the current one)" : "API key"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <Input
            aria-label={`Endpoint for ${who}`}
            placeholder={`Endpoint (default ${defaultBaseUrl})`}
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
          {credential && (
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
            aria-label={`${credential ? "Change" : "Set up"} credential for ${who}`}
            onClick={startEditing}
          >
            {credential ? "Change" : "Set up"}
          </Button>
        </div>
      )}
    </SettingsRow>
  );
}
