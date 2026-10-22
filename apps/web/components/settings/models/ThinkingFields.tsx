"use client";

import {
  REASONING_EFFORTS,
  type ModelReasoningControls,
  type LocalReasoningMapping,
} from "@overtchat/shared";
import { Button } from "@/components/ui/button";
import { SettingsRow, SettingsSection } from "../SettingsRows";

interface Props {
  detected?: ModelReasoningControls;
  value: ModelReasoningControls | null;
  onChange: (value: ModelReasoningControls | null) => void;
  detectionMessage?: string;
  onDetect: () => void;
  detecting: boolean;
}

const selectClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

export function ThinkingFields({
  detected,
  value,
  onChange,
  detectionMessage,
  onDetect,
  detecting,
}: Props) {
  const automatic = value === null;
  const controls = value ?? detected ?? { toggle: false };
  const mapping = controls.requestMapping ?? {
    toggleParameter: "enable_thinking",
    effortParameter: "reasoning_effort",
  };
  function update(next: Partial<ModelReasoningControls>) {
    onChange({
      ...controls,
      defaultLevel: undefined,
      requestMapping: {
        ...mapping,
        ...(next.efforts?.length && !mapping.effortParameter
          ? { effortParameter: "reasoning_effort" }
          : {}),
      },
      ...next,
    });
  }
  function updateMapping(next: Partial<LocalReasoningMapping>) {
    update({
      requestMapping: {
        ...mapping,
        ...next,
        ...(next.toggleParameter === undefined && !mapping.effortParameter
          ? { effortParameter: "reasoning_effort" }
          : {}),
      },
    });
  }
  return (
    <SettingsSection
      title="Thinking"
      description="Choose the thinking controls available in chat. Server default sends no thinking override."
    >
      <SettingsRow
        title="Configuration"
        htmlFor="thinking-configuration"
        description={
          detectionMessage ??
          (detected
            ? "Saved detection is available. Detect again after changing the model server or template."
            : "Thinking controls haven't been detected. Use server defaults or configure them manually.")
        }
      >
        <div className="space-y-2">
          <select
            id="thinking-configuration"
            className={selectClass}
            value={automatic ? "automatic" : "custom"}
            onChange={(event) =>
              onChange(
                event.target.value === "automatic"
                  ? null
                  : { ...controls, requestMapping: mapping },
              )
            }
          >
            <option value="automatic">Automatic</option>
            <option value="custom">Custom</option>
          </select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onDetect}
            disabled={detecting}
          >
            {detecting ? "Detecting…" : "Detect again"}
          </Button>
        </div>
      </SettingsRow>
      <SettingsRow
        title="Available controls"
        description={
          automatic
            ? "Detected values are prefilled. Select Custom to edit them."
            : "Enable only controls supported by this model. Leave all unchecked to hide the thinking selector."
        }
      >
        <fieldset
          disabled={automatic}
          className="space-y-3 disabled:opacity-60"
          aria-label="Available thinking controls"
        >
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={controls.toggle}
              onChange={(event) => update({ toggle: event.target.checked })}
            />
            On / Off
          </label>
          <div className="flex flex-wrap gap-3">
            {REASONING_EFFORTS.map((effort) => (
              <label
                key={effort}
                className="flex items-center gap-2 text-sm capitalize"
              >
                <input
                  type="checkbox"
                  aria-label={`Thinking effort ${effort}`}
                  checked={controls.efforts?.includes(effort) ?? false}
                  onChange={(event) =>
                    update({
                      efforts: REASONING_EFFORTS.filter((item) =>
                        item === effort
                          ? event.target.checked
                          : controls.efforts?.includes(item),
                      ),
                    })
                  }
                />
                {effort}
              </label>
            ))}
          </div>
          {controls.toggle && (
            <label className="block space-y-1 text-sm">
              <span>Thinking toggle parameter</span>
              <select
                className={selectClass}
                aria-label="Thinking toggle parameter"
                value={mapping.toggleParameter ?? "none"}
                onChange={(event) =>
                  updateMapping({
                    toggleParameter:
                      event.target.value === "none"
                        ? undefined
                        : (event.target
                            .value as LocalReasoningMapping["toggleParameter"]),
                  })
                }
              >
                <option value="enable_thinking">
                  chat_template_kwargs.enable_thinking
                </option>
                <option value="thinking">chat_template_kwargs.thinking</option>
                <option value="none">
                  Use reasoning effort (none disables thinking)
                </option>
              </select>
            </label>
          )}
          {(Boolean(controls.efforts?.length) ||
            (controls.toggle && !mapping.toggleParameter)) && (
            <label className="block space-y-1 text-sm">
              <span>Thinking effort parameter</span>
              <select
                className={selectClass}
                aria-label="Thinking effort parameter"
                value={mapping.effortParameter ?? "reasoning_effort"}
                onChange={(event) =>
                  updateMapping({
                    effortParameter: event.target
                      .value as LocalReasoningMapping["effortParameter"],
                  })
                }
              >
                <option value="reasoning_effort">reasoning_effort</option>
                <option value="chat_template_kwargs.reasoning_effort">
                  chat_template_kwargs.reasoning_effort
                </option>
              </select>
            </label>
          )}
        </fieldset>
      </SettingsRow>
    </SettingsSection>
  );
}
