"use client";

import { useState } from "react";
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
  const options = customImageOptions(value);
  const [extraText, setExtraText] = useState(() =>
    Object.keys(options.extraBody).length
      ? JSON.stringify(options.extraBody, null, 2)
      : "",
  );
  const [error, setError] = useState("");
  return (
    <SettingsSection
      title="Image API settings"
      description="Connect an OpenAI-compatible Images API and configure generation and editing."
    >
      <SettingsRow
        title="Generation size"
        htmlFor="p-image-size"
        description="Use a size supported by your backend, such as 512x512. Leave blank to use its default. Chat suggestions cannot override this size."
      >
        <Input
          id="p-image-size"
          placeholder="Backend default"
          value={options.size === "auto" ? "" : options.size}
          maxLength={64}
          onChange={(e) =>
            onChange({ ...options, size: e.target.value.trim() || "auto" })
          }
        />
      </SettingsRow>
      <SettingsRow
        title="Response format"
        htmlFor="p-image-response-format"
        description="URL responses must contain an inline image data URL."
      >
        <select
          id="p-image-response-format"
          className="w-full rounded-md border bg-background p-2 text-sm"
          value={options.responseFormat}
          onChange={(e) =>
            onChange({ ...options, responseFormat: e.target.value })
          }
        >
          <option value="b64_json">Base64 (b64_json)</option>
          <option value="url">Data URL (url)</option>
        </select>
      </SettingsRow>
      <SettingsRow
        title="Supports image editing"
        description="Enable to edit uploaded or generated images. Requires a backend and model that support /images/edits."
        layout="toggle"
      >
        <Switch
          aria-label="Supports image editing"
          checked={options.supportsEditing}
          onCheckedChange={(supportsEditing) =>
            onChange({ ...options, supportsEditing })
          }
        />
      </SettingsRow>
      {options.supportsEditing && (
        <SettingsRow
          title="Editing size"
          htmlFor="p-image-edit-size"
          description="Override the generation size for edits, such as 512x512. Leave blank to use the generation size, or enter auto to use the backend default."
        >
          <Input
            id="p-image-edit-size"
            placeholder="Same as generation"
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
        title="Extra request parameters"
        htmlFor="p-image-extra"
        description={
          'Optional JSON object, such as {"seed": 7}. Use this for backend-specific quality or sampling settings. Model, prompt, size, response format, and image count are managed separately.'
        }
      >
        <Textarea
          id="p-image-extra"
          className="font-mono text-xs"
          rows={5}
          value={extraText}
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
                  parsed.error.issues[0]?.message ?? "Enter a JSON object.",
                );
              onChange(parsed.data);
              setError("");
              onError(false);
            } catch (err) {
              setError(
                err instanceof Error
                  ? err.message
                  : "Enter a valid JSON object.",
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
