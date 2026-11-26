"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
      title={t("models.userCredentials.title")}
      description={t("models.userCredentials.description")}
    >
      {error && (
        <SettingsNotice tone="error">
          {getErrorMessage(error, t("models.userCredentials.loadError"))}
        </SettingsNotice>
      )}
      {!ready && !error && (
        <SettingsNotice>{t("models.userCredentials.loading")}</SettingsNotice>
      )}
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
  const { t } = useTranslation();
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
        title: removing
          ? t("models.userCredentials.removedTitle")
          : t("models.userCredentials.savedTitle"),
        description: who,
      });
    } catch (err) {
      toast.error({
        title: t("models.userCredentials.saveErrorTitle"),
        description: getErrorMessage(
          err,
          t("models.userCredentials.saveErrorFallback"),
        ),
      });
    }
  }

  const status =
    credential?.apiKey && credential?.baseUrl
      ? t("models.userCredentials.statusOwnBoth", {
          maskedKey: maskKey(credential.apiKey),
          baseUrl: credential.baseUrl,
        })
      : credential?.apiKey
        ? t("models.userCredentials.statusOwnKey", {
            maskedKey: maskKey(credential.apiKey),
          })
        : credential?.baseUrl
          ? t("models.userCredentials.statusOwnEndpoint", {
              baseUrl: credential.baseUrl,
            })
          : t("models.userCredentials.statusDefault");

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
            aria-label={t("models.userCredentials.apiKeyLabel", { who })}
            autoComplete="new-password"
            placeholder={t("models.userCredentials.apiKeyPlaceholder")}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <Input
            aria-label={t("models.userCredentials.endpointLabel", { who })}
            placeholder={t("models.userCredentials.endpointPlaceholder", {
              baseUrl: defaultBaseUrl,
            })}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>
              {t("models.deleteDialog.cancel")}
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={setMut.isPending}
              aria-label={t("models.userCredentials.saveLabel", { who })}
            >
              {t("models.userCredentials.save")}
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
              aria-label={t("models.userCredentials.removeLabel", { who })}
              onClick={() => void save(true)}
            >
              {t("models.userCredentials.remove")}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={
              hasOwn
                ? t("models.userCredentials.changeLabel", { who })
                : t("models.userCredentials.setUpLabel", { who })
            }
            onClick={startEditing}
          >
            {hasOwn
              ? t("models.userCredentials.change")
              : t("models.userCredentials.setUp")}
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
