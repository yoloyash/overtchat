"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  CustomImageOptionsSchema,
  customImageOptions,
} from "@/lib/model-config/image-options";
import { SettingsNotice, SettingsRow, SettingsSection } from "../SettingsRows";

export function CustomImageFields({
  value,
  onChange,
  onError,
}: {
  value: Record<string, unknown> | null;
  onChange: (value: Record<string, unknown>) => void;
  onError: (error: boolean) => void;
}) {
  const { t } = useTranslation();
  const options = customImageOptions(value);
  const [extraText, setExtraText] = useState(() =>
    Object.keys(options.extraBody).length
      ? JSON.stringify(options.extraBody, null, 2)
      : "",
  );
  const [error, setError] = useState("");
  return (
    <SettingsSection
      title={t("models.customImage.title")}
      description={t("models.customImage.description")}
    >
      <SettingsRow
        title={t("models.customImage.generationSizeTitle")}
        htmlFor="p-image-size"
        description={t("models.customImage.generationSizeDescription")}
      >
        <Input
          id="p-image-size"
          placeholder={t("models.customImage.generationSizePlaceholder")}
          value={options.size === "auto" ? "" : options.size}
          maxLength={64}
          onChange={(e) =>
            onChange({ ...options, size: e.target.value.trim() || "auto" })
          }
        />
      </SettingsRow>
      <SettingsRow
        title={t("models.customImage.responseFormatTitle")}
        htmlFor="p-image-response-format"
        description={t("models.customImage.responseFormatDescription")}
      >
        <select
          id="p-image-response-format"
          className="w-full rounded-md border bg-background p-2 text-sm"
          value={options.responseFormat}
          onChange={(e) =>
            onChange({ ...options, responseFormat: e.target.value })
          }
        >
          <option value="b64_json">
            {t("models.customImage.responseFormatBase64")}
          </option>
          <option value="url">
            {t("models.customImage.responseFormatUrl")}
          </option>
        </select>
      </SettingsRow>
      <SettingsRow
        title={t("models.customImage.supportsEditingTitle")}
        description={t("models.customImage.supportsEditingDescription")}
        layout="toggle"
      >
        <Switch
          aria-label={t("models.customImage.supportsEditingTitle")}
          checked={options.supportsEditing}
          onCheckedChange={(supportsEditing) =>
            onChange({ ...options, supportsEditing })
          }
        />
      </SettingsRow>
      {options.supportsEditing && (
        <SettingsRow
          title={t("models.customImage.editingSizeTitle")}
          htmlFor="p-image-edit-size"
          description={t("models.customImage.editingSizeDescription")}
        >
          <Input
            id="p-image-edit-size"
            placeholder={t("models.customImage.editingSizePlaceholder")}
            value={options.editSize ?? ""}
            maxLength={64}
            onChange={(e) =>
              onChange({
                ...options,
                editSize: e.target.value.trim() || undefined,
              })
            }
          />
        </SettingsRow>
      )}
      <SettingsRow
        title={t("models.customImage.extraParamsTitle")}
        htmlFor="p-image-extra"
        description={t("models.customImage.extraParamsDescription")}
      >
        <Textarea
          id="p-image-extra"
          className="font-mono text-xs"
          rows={5}
          value={extraText}
          // eslint-disable-next-line i18next/no-literal-string -- JSON example placeholder
          placeholder={'{"seed": 7}'}
          onChange={(e) => {
            const text = e.target.value;
            setExtraText(text);
            try {
              const parsed = CustomImageOptionsSchema.safeParse({
                ...options,
                extraBody: text.trim() ? JSON.parse(text) : {},
              });
              if (!parsed.success)
                throw new Error(
                  parsed.error.issues[0]?.message ??
                    t("models.customImage.invalidJsonObject"),
                );
              onChange(parsed.data);
              setError("");
              onError(false);
            } catch (err) {
              setError(
                err instanceof Error
                  ? err.message
                  : t("models.customImage.invalidValidJsonObject"),
              );
              onError(true);
            }
          }}
        />
      </SettingsRow>
      {error && <SettingsNotice tone="error">{error}</SettingsNotice>}
    </SettingsSection>
  );
}
