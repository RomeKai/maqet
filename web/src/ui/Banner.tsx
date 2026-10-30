import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { cn } from "./cn";

export type BannerTone = "info" | "warning" | "danger" | "success";

const TONES: Record<BannerTone, string> = {
  info: "border-measured/40 bg-measured-soft",
  warning: "border-warning bg-warning-soft",
  danger: "border-danger bg-danger-soft",
  success: "border-success/40 bg-success-soft",
};
const ICONS = { info: Info, warning: TriangleAlert, danger: CircleAlert, success: CircleCheck } as const;

export interface BannerProps {
  tone?: BannerTone;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function Banner({ tone = "info", title, children, action, className }: BannerProps) {
  const Icon = ICONS[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-xl border-2 p-3 text-foreground", TONES[tone], className)}
    >
      <Icon className="mt-0.5 size-6 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-base font-bold leading-snug">{title}</p>
        {children ? <div className="mt-0.5 text-[15px] leading-snug">{children}</div> : null}
        {action ? <div className="mt-2 flex flex-wrap gap-2">{action}</div> : null}
      </div>
    </div>
  );
}
