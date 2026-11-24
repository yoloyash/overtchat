"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsRow } from "@/components/settings/SettingsRows";

export type Pair = { id: string; key: string; value: string };

export function rowId() {
  return crypto.randomUUID();
}

/** Editor rows for a string map. `blankRow` keeps one empty row to type into. */
export function pairs(value: Record<string, string>, blankRow = true): Pair[] {
  const entries = Object.entries(value).map(([key, item]) => ({
    id: rowId(),
    key,
    value: item,
  }));
  return entries.length || !blankRow
    ? entries
    : [{ id: rowId(), key: "", value: "" }];
}

export function RepeatablePairs({
  label,
  description,
  rows,
  keyPlaceholder,
  valuePlaceholder,
  addLabel,
  allowEmpty = false,
  error,
  onChange,
}: {
  label: string;
  description?: React.ReactNode;
  rows: Pair[];
  keyPlaceholder: string;
  valuePlaceholder: string;
  addLabel: string;
  /** Lets the last row be removed, for lists that start with no rows. */
  allowEmpty?: boolean;
  error?: string;
  onChange(rows: Pair[]): void;
}) {
  return (
    <SettingsRow title={label} description={description} align="start">
      <div className="space-y-3">
        {rows.map((row, index) => (
          <div
            key={row.id}
            className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2"
          >
            <Input
              value={row.key}
              aria-label={`${label} key ${index + 1}`}
              onChange={(event) =>
                onChange(
                  rows.map((item) =>
                    item.id === row.id
                      ? { ...item, key: event.target.value }
                      : item,
                  ),
                )
              }
              placeholder={keyPlaceholder}
              autoComplete="off"
              className="font-mono"
            />
            <Input
              value={row.value}
              aria-label={`${label} value ${index + 1}`}
              onChange={(event) =>
                onChange(
                  rows.map((item) =>
                    item.id === row.id
                      ? { ...item, value: event.target.value }
                      : item,
                  ),
                )
              }
              placeholder={valuePlaceholder}
              autoComplete="off"
              className="font-mono"
            />
            <RemoveButton
              label={`Remove ${label.toLowerCase()} row`}
              disabled={
                !allowEmpty &&
                rows.length === 1 &&
                row.key === "" &&
                row.value === ""
              }
              onClick={() =>
                onChange(rows.filter((item) => item.id !== row.id))
              }
            />
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          onClick={() =>
            onChange([...rows, { id: rowId(), key: "", value: "" }])
          }
        >
          <Plus /> {addLabel}
        </Button>
        {error && (
          <p role="alert" className="break-words text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    </SettingsRow>
  );
}

export function RemoveButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick(): void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="text-muted-foreground hover:text-destructive"
    >
      <Trash2 />
    </Button>
  );
}
