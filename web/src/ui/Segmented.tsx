import type { ReactNode } from "react";
import { cn } from "./cn";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  aria?: string;
}

export interface SegmentedProps<T extends string> {
  value: T;
  onChange: (v: T) => void;
  options: SegmentedOption<T>[];
  label: string;
  className?: string;
}

export function Segmented<T extends string>({ value, onChange, options, label, className }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("flex gap-1 rounded-2xl bg-secondary p-1", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          aria-label={o.aria}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex min-h-12 flex-1 items-center justify-center rounded-xl px-2 text-[15px] font-bold",
            value === o.value ? "bg-foreground text-background" : "text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
