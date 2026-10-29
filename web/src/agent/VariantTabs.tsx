import { useCallback, useEffect, useState } from "react";
import type { Scene, VariantsOut } from "../scene/types";
import { chooseVariant, fetchVariants, forkVariant, undoVariant } from "./agentApi";

interface VariantTabsProps {
  onSceneChange: (scene: Scene) => void;
  locale: string;
}

export function VariantTabs({ onSceneChange, locale }: VariantTabsProps): React.JSX.Element {
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
      <div className="variant-tabs" aria-busy="true">
        {error ? <p className="variant-error">{error}</p> : <p className="variant-loading">Loading variants…</p>}
      </div>
    );
  }

  return (
    <div className="variant-tabs" data-testid="variant-tabs">
      <div className="variant-tablist" role="tablist" aria-label={locale === "es-AR" ? "Variantes" : "Variants"}>
        {data.variants.map((v) => (
          <button
            key={v.label}
            type="button"
            role="tab"
            aria-selected={data.chosen === v.label}
            className={data.chosen === v.label ? "chip chip-active" : "chip"}
            onClick={() => void handleChoose(v.label)}
            disabled={busy}
          >
            {v.label}
          </button>
        ))}
        <button type="button" className="chip" onClick={() => void handleFork()} disabled={busy} aria-label="Fork variant">
          + Fork
        </button>
      </div>
      <div className="variant-actions">
        <button type="button" className="chip" onClick={() => void handleUndo()} disabled={busy}>
          Undo
        </button>
      </div>
      {error ? <p className="variant-error">{error}</p> : null}
    </div>
  );
}
