import { useState } from "react";
import { Sparkles } from "lucide-react";
import type { Scene } from "../scene/types";
import type { Locale } from "../i18n";
import { getDesignStrings } from "./design.i18n";

export const STYLE_IDS = ["minimalist", "modern", "cozy", "rustic", "industrial"] as const;
export type StyleId = (typeof STYLE_IDS)[number];

export interface RealLifeState {
  image: string | null;
  pending: boolean;
  error: string | null;
}

export const EMPTY_REAL_LIFE: RealLifeState = { image: null, pending: false, error: null };

interface RealLifeCardProps {
  scene: Scene | null;
  locale: Locale;
  state: RealLifeState;
  /** Explicit tap only: one image, about $0.01. */
  onGenerate: (roomId: string, style: StyleId) => void;
  /** Present uses "See it in real life". */
  variant?: "design" | "present";
  /** Inline strip for the Design screen: horizontally scrolling chips, no image (the screen shows it in a sheet). */
  compact?: boolean;
}

const btn =
  "flex min-h-12 items-center justify-center gap-2 rounded-xl border-2 border-border px-3 text-[15px] font-bold disabled:opacity-40";

/** Style picker + "In real life" button + image. No extra label on the image (human decision); the global preliminary footer stays. */
export function RealLifeCard({ scene, locale, state, onGenerate, variant = "design", compact = false }: RealLifeCardProps): React.JSX.Element {
  const t = getDesignStrings(locale);
  const rooms = scene?.rooms ?? [];
  const [style, setStyle] = useState<StyleId>("modern");
  const [roomId, setRoomId] = useState("");
  const room = rooms.find((r) => r.id === roomId)?.id ?? rooms[0]?.id ?? "";
  return (
    <section className={compact ? "mx-3 mt-2 space-y-1 rounded-2xl border-2 border-foreground bg-card p-2" : "space-y-2"} aria-label={t["real.title"]} data-testid="real-life-card">
      {compact ? null : <h3 className="text-[15px] font-bold">{t["real.title"]}</h3>}
      {rooms.length > 1 ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label={t["design.room"]}>
          {rooms.map((r) => (
            <button key={r.id} type="button" aria-pressed={r.id === room} className={`${btn} ${r.id === room ? "bg-foreground text-background" : ""}`} onClick={() => setRoomId(r.id)}>
              {r.name}
            </button>
          ))}
        </div>
      ) : null}
      <div className={compact ? "flex gap-2 overflow-x-auto" : "flex flex-wrap gap-2"} role="radiogroup" aria-label={t["real.style"]}>
        {STYLE_IDS.map((id) => (
          <button key={id} type="button" role="radio" aria-checked={style === id} className={`${btn} ${style === id ? "bg-foreground text-background" : ""}`} onClick={() => setStyle(id)}>
            {t[`real.style.${id}`]}
          </button>
        ))}
      </div>
      <button type="button" className={`${btn} w-full`} disabled={state.pending || room === ""} onClick={() => onGenerate(room, style)}>
        <Sparkles className="size-5" aria-hidden />
        {state.pending ? t["real.pending"] : variant === "present" ? t["real.seeIt"] : t["real.button"]}
      </button>
      <p className="text-sm">{t["real.cost"]}</p>
      {state.error !== null ? (
        <p role="alert" className="text-sm font-bold">
          {state.error}
        </p>
      ) : null}
      {!compact && state.image !== null ? <img src={state.image} alt="" className="w-full rounded-xl border-2 border-foreground" /> : null}
    </section>
  );
}
