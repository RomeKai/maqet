import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground",
  secondary: "border-2 border-foreground bg-card text-foreground",
  ghost: "bg-transparent text-foreground",
  danger: "bg-danger text-danger-foreground",
};

/** 48 px minimum touch target in every variant. */
export function Button({ variant = "primary", className, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex min-h-12 select-none items-center justify-center gap-2 rounded-xl px-4 text-base font-bold active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        className,
      )}
      {...rest}
    />
  );
}
