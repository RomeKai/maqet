import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import type { OpRecordIn, Scene, VariantsOut } from "../scene/types";
import { getStrings, type Locale } from "../i18n";
import { Segmented } from "../ui";
import { chooseVariant, fetchVariants, forkVariant, startVariants, undoVariant } from "./agentApi";
import { getAgentStrings } from "./agent.i18n";
import { floorAreaM2 } from "./floorArea";

/** "now" = the read-only baseline: the home as it was when Reform started. */
export const NOW = "now";

/** The variant edits apply to, or null while Now (read-only) is showing. */
export function activeVariant(selected: string, chosen: string | undefined): string | null {
  const label = selected === "" ? (chosen ?? null) : selected;
  return label === NOW ? null : label;
}

type VariantWithOps = { label: string; ops?: OpRecordIn[] };

export interface VariantsState {
  data: VariantsOut | null;
  error: string | null;
  busy: boolean;
  /** Selected tab: NOW or a variant label. */
  selected: string;
  /** Variant that agent turns and edits are persisted into; null on Now (read-only). */
  active: string | null;
  reload: () => Promise<void>;
  fork: () => Promise<void>;
  choose: (label: string) => Promise<void>;
  undo: () => Promise<void>;
  /** Align the server's variants with the Reform baseline and show its chosen variant. */
  start: (base: Scene) => Promise<void>;
}

/** Variants API state shared by the tabs and the 3D card's Undo button. */
export function useVariants(
  onSceneChange: (scene: Scene, ops: OpRecordIn[], label: string) => void,
  getBase: () => Scene | null = () => null,
  /** The client's own latest Scene + ops of a variant (the response of its last turn or edit). */
  getLocal: (label: string) => { scene: Scene; ops: OpRecordIn[] } | null = () => null,
): VariantsState {
  const [data, setData] = useState<VariantsOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string>("");

  const load = useCallback(async () => {
    try {
      setData((await fetchVariants()) as VariantsOut);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(work: () => Promise<void>): Promise<void> {
    setBusy(true);
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function applyChosen(raw: VariantsOut, preferLocal: boolean = true): void {
    setData(raw);
    const local = preferLocal ? getLocal(raw.chosen) : null;
    if (local) {
      onSceneChange(local.scene, local.ops, raw.chosen);
      return;
    }
    const chosen = raw.variants.find((v) => v.label === raw.chosen);
    if (chosen) onSceneChange(chosen.scene, (chosen as VariantWithOps).ops ?? [], raw.chosen);
  }

  return {
    data,
    error,
    busy,
    selected: selected === "" ? (data?.chosen ?? NOW) : selected,
    active: activeVariant(selected, data?.chosen),
    reload: load,
    start: (base: Scene) =>
      run(async () => {
        setSelected("");
        applyChosen((await startVariants(base)) as VariantsOut);
      }),
    fork: () =>
      run(async () => {
        if (!data) return;
        const existing = new Set(data.variants.map((v) => v.label));
        // Next label: B, C, D… (A already exists as base)
        const next = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").find((l) => !existing.has(l)) ?? `V${data.variants.length + 1}`;
        setData((await forkVariant(next, data.chosen)) as VariantsOut);
      }),
    choose: (label: string) =>
      run(async () => {
        setSelected(label);
        if (label === NOW) {
          const base = getBase();
          if (base) onSceneChange(base, [], NOW);
          return;
        }
        applyChosen((await chooseVariant(label)) as VariantsOut);
      }),
    undo: () =>
      run(async () => {
        if (!data) return;
        await undoVariant(data.chosen);
        applyChosen((await fetchVariants()) as VariantsOut, false); // undo: the server just changed it
      }),
  };
}

function formatArea(m2: number | null, locale: Locale): string {
  if (m2 === null) return "";
  const fixed = m2.toFixed(1);
  return `${locale === "es-AR" ? fixed.replace(".", ",") : fixed} m²`;
}

interface VariantTabsProps {
  state: VariantsState;
  locale: Locale;
}

/** Segmented Now / A / B / C with "+ Fork" inside the control and a one-line caption. */
export function VariantTabs({ state, locale }: VariantTabsProps): React.JSX.Element {
  const t = getStrings(locale);
  const a = getAgentStrings(locale);
  const { data, error, busy, selected } = state;

  if (!data) {
    return (
      <div className="px-3 py-2 font-sans" aria-busy="true">
        {error ? (
          <p className="text-[15px] font-semibold text-danger">{error}</p>
        ) : (
          <p className="text-[15px] text-muted-foreground">{t["variants.loading"]}</p>
        )}
      </div>
    );
  }

  const variant = data.variants.find((v) => v.label === selected);
  const readOnly = selected === NOW;
  const caption = variant
    ? a["variants.optionCaption"].replace("{label}", variant.label).replace("{area}", formatArea(floorAreaM2(variant.scene), locale))
    : a["variants.nowCaption"];

  return (
    <div className="space-y-1 px-3 py-2 font-sans" data-testid="variant-tabs">
      <div className="flex items-center gap-1">
        <Segmented<string>
          className="flex-1"
          label={t["variants.label"]}
          value={selected}
          onChange={(label) => void state.choose(label)}
          options={[
            { value: NOW, label: a["variants.now"] },
            ...data.variants.map((v) => ({ value: v.label, label: v.label })),
          ]}
        />
        <button
          type="button"
          className="flex min-h-12 shrink-0 items-center gap-1 rounded-xl border-2 border-foreground bg-card px-2 text-[14px] font-bold disabled:opacity-50"
          onClick={() => void state.fork()}
          disabled={busy}
          aria-label={t["variants.fork"]}
        >
          <Plus className="size-4" aria-hidden />
          {t["variants.forkShort"].replace(/^\+\s*/, "")}
        </button>
      </div>
      <p className="variant-caption min-h-5 truncate text-center text-[15px] font-semibold" aria-live="polite">
        {caption}
      </p>
      {error ? <p className="text-[15px] font-semibold text-danger">{error}</p> : null}
      {readOnly ? <p className="text-center text-[14px] text-muted-foreground">{a["variants.nowReadOnly"]}</p> : null}
    </div>
  );
}

export { formatArea };

/** Self-contained tabs (Present stage): own variants state plus an Undo button. */
export function ConnectedVariantTabs({ onSceneChange, locale }: { onSceneChange: (scene: Scene) => void; locale: Locale }): React.JSX.Element {
  const state = useVariants(onSceneChange);
  const t = getStrings(locale);
  return (
    <div>
      <VariantTabs state={state} locale={locale} />
      {state.data ? (
        <div className="px-3">
          <button
            type="button"
            className="min-h-12 w-full rounded-xl border-2 border-border bg-card px-3 text-[15px] font-bold disabled:opacity-50"
            onClick={() => void state.undo()}
            disabled={state.busy}
          >
            {t["variants.undo"]}
          </button>
        </div>
      ) : null}
    </div>
  );
}

