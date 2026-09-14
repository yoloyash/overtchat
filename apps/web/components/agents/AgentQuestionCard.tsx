"use client";

import { useId, useRef, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import type { AgentInteractionValue } from "@overtchat/agent-bridge";
import {
  agentQuestionFields,
  initialQuestionValues,
  interactionFormComplete,
  normalizeFormValues,
  questionOptions,
  questionResponse,
  dismissQuestion,
  questionAnswerValues,
  toggleQuestionOption,
  type InteractionFormField,
  type AgentQuestionRequest,
  type AgentQuestionResponse,
} from "@overtchat/shared/agent-interaction";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

// Layout and pagination reference:
// https://github.com/getpaseo/paseo/blob/d1b705a/packages/app/src/components/question-form-card.tsx
// Keep serialization shared so web and native preserve the same provider values.
export function AgentQuestionCard({
  request,
  pending,
  error,
  onRespond,
}: {
  request: AgentQuestionRequest;
  pending: boolean;
  error?: string;
  onRespond: (response: AgentQuestionResponse) => void;
}) {
  const fields = agentQuestionFields(request);
  const [values, setValues] = useState(() => initialQuestionValues(fields));
  const [index, setIndex] = useState(0);
  const [customTexts, setCustomTexts] = useState<Record<string, string>>({});
  const id = useId();
  const heading = useRef<HTMLParagraphElement>(null);
  const field = fields[index];
  const answers = questionAnswerValues(fields, values, customTexts);
  const normalized = normalizeFormValues(fields, answers);
  const answered = (at: number) =>
    !!fields[at] && interactionFormComplete([fields[at]], normalized);
  const last = index === fields.length - 1;
  const complete =
    fields.length > 0 && interactionFormComplete(fields, normalized);
  const disabled = pending || (last ? !complete : !answered(index));
  function navigate(next: number) {
    setIndex(next);
    // Keep keyboard focus in the card when single-choice selection changes pages.
    heading.current?.focus({ preventScroll: true });
  }
  function change(value: AgentInteractionValue) {
    if (pending) return;
    setCustomTexts((current) => ({ ...current, [field.id]: "" }));
    setValues((current) => ({ ...current, [field.id]: value }));
  }
  function changeText(text: string) {
    if (pending) return;
    if (field.type === "select" || field.type === "multiselect") {
      setCustomTexts((current) => ({ ...current, [field.id]: text }));
      setValues((current) => ({ ...current, [field.id]: "" }));
    } else change(text);
  }
  function primary() {
    if (disabled) return;
    if (last) onRespond(questionResponse(request, fields, answers));
    else navigate(index + 1);
  }
  const value = field ? values[field.id] : undefined;
  return (
    <form
      data-testid="agent-question-card"
      aria-label="Agent questions"
      aria-busy={pending}
      className="space-y-3 rounded-lg border bg-card p-3 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        primary();
      }}
    >
      {fields.length > 1 && (
        <div
          role="tablist"
          aria-label="Questions"
          className="flex flex-wrap gap-1 px-3"
        >
          {fields.map((item, at) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`${id}-tab-${at}`}
              aria-label={`Question ${at + 1} of ${fields.length}: ${item.label}`}
              aria-selected={at === index}
              aria-controls={`${id}-panel`}
              tabIndex={at === index ? 0 : -1}
              disabled={pending}
              onClick={() => navigate(at)}
              onKeyDown={(event) => {
                const next =
                  event.key === "ArrowRight"
                    ? (at + 1) % fields.length
                    : event.key === "ArrowLeft"
                      ? (at + fields.length - 1) % fields.length
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? fields.length - 1
                          : null;
                if (next === null) return;
                event.preventDefault();
                setIndex(next);
                document.getElementById(`${id}-tab-${next}`)?.focus();
              }}
              className={cn(
                "flex min-h-7 items-center gap-1 rounded-md border px-2 py-1 text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring",
                at === index &&
                  "border-muted-foreground bg-muted text-foreground",
              )}
            >
              {answered(at) && (
                <Check className="size-3" aria-label="Answered" />
              )}
              {item.label}
            </button>
          ))}
        </div>
      )}
      <div
        id={`${id}-panel`}
        role={fields.length > 1 ? "tabpanel" : undefined}
        aria-labelledby={fields.length > 1 ? `${id}-tab-${index}` : undefined}
        className="space-y-2"
      >
        <p
          ref={heading}
          tabIndex={-1}
          className="px-3 pb-1 leading-[22px] whitespace-pre-wrap outline-none"
          aria-live="polite"
        >
          {field?.description ||
            field?.label ||
            "The agent did not provide any answer fields."}
        </p>
        {field && (
          <div key={field.id} className="space-y-2">
            <QuestionOptions
              field={field}
              value={value}
              disabled={pending}
              onChange={(next, advance) => {
                change(next);
                if (advance && !last) navigate(index + 1);
              }}
            />
            {(field.type === "text" ||
              field.type === "number" ||
              field.allowOther) &&
              (() => {
                const inputProps = {
                  "aria-label": field.description || field.label,
                  value:
                    field.type === "select" || field.type === "multiselect"
                      ? (customTexts[field.id] ?? "")
                      : String(value ?? ""),
                  placeholder:
                    field.placeholder ||
                    (field.options.length
                      ? "Other (type your answer)"
                      : "Type your answer"),
                  disabled: pending,
                  className:
                    "w-full rounded-lg border bg-muted px-3 py-3 outline-none focus:border-ring focus-visible:ring-1 focus-visible:ring-ring",
                  onChange: (
                    event: React.ChangeEvent<
                      HTMLInputElement | HTMLTextAreaElement
                    >,
                  ) => changeText(event.target.value),
                };
                return request.method === "editor" && !field.secret ? (
                  <textarea {...inputProps} rows={5} />
                ) : (
                  <input
                    {...inputProps}
                    type={
                      field.secret
                        ? "password"
                        : field.type === "number"
                          ? "number"
                          : "text"
                    }
                    min={field.minimum}
                    max={field.maximum}
                    step={field.type === "number" ? "any" : undefined}
                  />
                );
              })()}
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className="px-3 text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <button
          type="button"
          disabled={pending}
          onClick={() => onRespond(dismissQuestion(request, fields))}
          className="flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-muted-foreground hover:bg-muted disabled:opacity-50"
        >
          <X className="size-3.5" />
          {typeof request.dismissLabel === "string"
            ? request.dismissLabel
            : "Dismiss"}
        </button>
        <button
          type="submit"
          disabled={disabled}
          className="flex items-center justify-center gap-2 rounded-md border border-primary bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50"
        >
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Check className="size-3.5" />
          )}
          {last ? "Submit" : "Next"}
        </button>
      </div>
    </form>
  );
}

function QuestionOptions({
  field,
  value,
  disabled,
  onChange,
}: {
  field: InteractionFormField;
  value: AgentInteractionValue | undefined;
  disabled: boolean;
  onChange: (value: AgentInteractionValue, advance: boolean) => void;
}) {
  const labelId = useId();
  const navigating = useRef(false);
  const options = questionOptions(field);
  if (!options.length) return null;
  const multi = field.type === "multiselect";
  const selectedValue = field.type === "boolean" ? String(value ?? "") : value;
  const rows = options.map((option, index) => {
    const selected = multi
      ? Array.isArray(value) && value.includes(option.value)
      : selectedValue === option.value;
    return (
      <label
        key={option.value}
        className={cn(
          "flex cursor-pointer items-start gap-2 rounded-md px-3 py-2 text-muted-foreground hover:bg-muted",
          selected && "bg-muted text-foreground",
          disabled && "cursor-default opacity-50",
        )}
      >
        {multi ? (
          <input
            type="checkbox"
            checked={selected}
            disabled={disabled}
            aria-label={option.label}
            className="mt-0.5 size-[18px] shrink-0 accent-primary"
            onChange={() =>
              onChange(toggleQuestionOption(field, value, option.value), false)
            }
          />
        ) : (
          <RadioGroupItem
            value={option.value}
            aria-labelledby={`${labelId}-${index}`}
            className="mt-0.5 size-[18px] shrink-0"
          />
        )}
        <span className="min-w-0 space-y-1 leading-[22px] wrap-anywhere">
          <span id={`${labelId}-${index}`} className="block">
            {option.label}
          </span>
          {option.description && (
            <span className="block leading-5 text-muted-foreground">
              {option.description}
            </span>
          )}
        </span>
      </label>
    );
  });
  return multi ? (
    <div
      role="group"
      aria-label={`Choices for ${field.description || field.label}`}
      className="space-y-1"
    >
      {rows}
    </div>
  ) : (
    <RadioGroup
      value={selectedValue ?? ""}
      disabled={disabled}
      aria-label={`Choices for ${field.description || field.label}`}
      className="gap-1"
      onKeyDownCapture={(event) => {
        navigating.current = event.key.startsWith("Arrow");
      }}
      onKeyUpCapture={() => {
        navigating.current = false;
      }}
      onPointerDownCapture={() => {
        navigating.current = false;
      }}
      onValueChange={(next: string) => {
        // Base UI selects on focus via a synthetic click during arrow navigation.
        onChange(
          field.type === "boolean" ? next === "true" : next,
          !navigating.current,
        );
      }}
    >
      {rows}
    </RadioGroup>
  );
}
