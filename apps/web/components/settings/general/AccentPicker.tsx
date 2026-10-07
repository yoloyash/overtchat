"use client";

import { Radio } from "@base-ui/react/radio";
import { Check } from "lucide-react";
import { ACCENT_OPTIONS, DEFAULT_ACCENT_ID, resolveAccentId } from "@overtchat/shared";
import { RadioGroup } from "@/components/ui/radio-group";
import { ACCENT_STORAGE_KEY } from "@/lib/accent";
import { useLocalStorage } from "@/lib/useLocalStorage";

export function AccentPicker() {
  const [accent, setAccent] = useLocalStorage(ACCENT_STORAGE_KEY, DEFAULT_ACCENT_ID);
  return (
    <div className="@container/accent w-full">
      <RadioGroup
        aria-label="Accent color"
        value={resolveAccentId(accent)}
        onValueChange={(value) => setAccent(resolveAccentId(value))}
        className="grid w-full grid-cols-2 gap-2 @xs/accent:grid-cols-4"
      >
        {ACCENT_OPTIONS.map(({ id, label, swatch }) => (
          <Radio.Root
            key={id}
            value={id}
            className="relative flex min-h-16 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-transparent p-2 text-xs text-muted-foreground motion-colors outline-hidden hover:bg-accent focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring data-checked:border-ring data-checked:bg-accent data-checked:text-accent-foreground forced-colors:focus-visible:outline-[Highlight]"
          >
            <Radio.Indicator aria-hidden="true" className="absolute right-1 top-1">
              <Check className="size-3" />
            </Radio.Indicator>
            <span
              aria-hidden="true"
              className="size-5 rounded-full"
              style={{ backgroundColor: swatch }}
            />
            {label}
          </Radio.Root>
        ))}
      </RadioGroup>
    </div>
  );
}
