import { useCallback, useEffect, useState } from "react";
import type { Scene, VariantsOut } from "../scene/types";
import { getStrings, type Locale } from "../i18n";
import { Segmented } from "../ui";
import { chooseVariant, fetchVariants, forkVariant, undoVariant } from "./agentApi";

interface VariantTabsProps {
  onSceneChange: (scene: Scene) => void;
  locale: Locale;
}

export function VariantTabs({ onSceneChange, locale }: VariantTabsProps): React.JSX.Element {
  const t = getStrings(locale);
  const [data, setData] = useState<VariantsOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const raw = (await fetchVariants()) as VariantsOut;
      setData(raw);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleFork(): Promise<void> {
    if (!data) return;
    const existing = new Set(data.variants.map((v) => v.label));
    // Next label: B, C, D… (A already exists as base)
    const next = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").find((l) => !existing.has(l)) ?? `V${data.variants.length + 1}`;
    setBusy(true);
    try {
      const raw = (await forkVariant(next, data.chosen)) as VariantsOut;
      setData(raw);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleChoose(label: string): Promise<void> {
    setBusy(true);
    try {
      const raw = (await chooseVariant(label)) as VariantsOut;
      setData(raw);
      const chosen = raw.variants.find((v) => v.label === raw.chosen);
      if (chosen) onSceneChange(chosen.scene);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleUndo(): Promise<void> {
    if (!data) return;
    setBusy(true);
    try {
      await undoVariant(data.chosen);
      const raw = (await fetchVariants()) as VariantsOut;
      setData(raw);
      const chosen = raw.variants.find((v) => v.label === raw.chosen);
      if (chosen) onSceneChange(chosen.scene);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

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

  return (
    <div className="space-y-2 px-3 py-2 font-sans" data-testid="variant-tabs">
      <Segmented<string>
        label={t["variants.label"]}
        value={data.chosen}
        onChange={(label) => void handleChoose(label)}
        options={data.variants.map((v) => ({ value: v.label, label: v.label }))}
      />
      <div className="flex gap-2">
        <button
          type="button"
          className="min-h-12 flex-1 rounded-xl border-2 border-foreground bg-card px-3 text-[15px] font-bold disabled:opacity-50"
          onClick={() => void handleFork()}
          disabled={busy}
          aria-label={t["variants.fork"]}
        >
          {t["variants.forkShort"]}
        </button>
        <button
          type="button"
          className="min-h-12 flex-1 rounded-xl border-2 border-border bg-card px-3 text-[15px] font-bold disabled:opacity-50"
          onClick={() => void handleUndo()}
          disabled={busy}
        >
          {t["variants.undo"]}
        </button>
      </div>
      {error ? <p className="text-[15px] font-semibold text-danger">{error}</p> : null}
    </div>
  );
}
