"use client";

import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@/components/ui/radio-group";

export function SettingsChoiceGroup({
  label,
  value,
  onValueChange,
  options,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: React.ReactNode }>;
}) {
  return (
    <RadioGroup
      aria-label={label}
      value={value}
      onValueChange={onValueChange}
      className="grid min-h-10 w-full auto-cols-fr grid-flow-col gap-1 rounded-lg border bg-muted/30 p-1"
    >
      {options.map((option) => (
        <Radio.Root
          key={option.value}
          value={option.value}
          className="flex min-h-7 min-w-0 cursor-pointer items-center justify-center gap-2 rounded-md px-2 py-1 text-sm font-medium text-muted-foreground motion-colors outline-none select-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-checked:bg-background data-checked:text-foreground data-checked:shadow-xs [&_svg]:size-3.5 [&_svg]:shrink-0"
        >
          {option.label}
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}
