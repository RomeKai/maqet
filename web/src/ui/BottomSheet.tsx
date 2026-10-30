import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  closeLabel: string;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * The backdrop closes the sheet only for a tap that STARTED on it. A sheet
 * opened on pointerup (one-tap opening placement) otherwise receives that
 * same tap's trailing click on its fresh backdrop and closes instantly.
 */
export function backdropShouldClose(pointerDownOnBackdrop: boolean): boolean {
  return pointerDownOnBackdrop;
}

export function BottomSheet({ open, onClose, title, closeLabel, children, footer }: BottomSheetProps) {
  const downOnBackdrop = useRef(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  const node = (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div
        className="animate-fade-in absolute inset-0 bg-foreground/55"
        onPointerDown={() => { downOnBackdrop.current = true; }}
        onClick={() => {
          const close = backdropShouldClose(downOnBackdrop.current);
          downOnBackdrop.current = false;
          if (close) onClose();
        }}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="animate-sheet-up relative mx-auto flex max-h-[70dvh] w-full max-w-[430px] flex-col rounded-t-3xl border-t-2 border-foreground bg-card"
      >
        <div className="mx-auto mt-2 h-1.5 w-12 shrink-0 rounded-full bg-border" aria-hidden />
        <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-2">
          <h2 className="text-xl font-extrabold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="flex size-12 shrink-0 items-center justify-center rounded-full bg-secondary"
          >
            <X className="size-6" />
          </button>
        </div>
        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-3"
          onFocusCapture={(e) => {
            const el = e.target as HTMLElement;
            // Keep the focused input visible above the on-screen keyboard.
            window.setTimeout(() => el.scrollIntoView?.({ block: "center", behavior: "smooth" }), 250);
          }}
        >{children}</div>
        {footer ? <div className="shrink-0 border-t border-border px-4 pb-4 pt-3">{footer}</div> : null}
      </div>
    </div>
  );
  // Portal to <body>: never positioned or clipped by the scrolled editor.
  return typeof document === "undefined" ? node : createPortal(node, document.body);
}
