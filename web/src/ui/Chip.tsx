import type { HTMLAttributes } from "react";
import { cn } from "./cn";

export type ChipTone = "neutral" | "primary" | "warning" | "success" | "measured";

const TONES: Record<ChipTone, string> = {
  neutral: "bg-secondary text-secondary-foreground",
  primary: "bg-primary text-primary-foreground",
  warning: "bg-warning text-warning-foreground",
  success: "bg-success text-primary-foreground",
  measured: "bg-measured text-primary-foreground",
};

export function Chip({ tone = "neutral", className, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: ChipTone }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-bold", TONES[tone], className)}
      {...rest}
    />
  );
}
