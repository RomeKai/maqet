import { useCallback, useState } from "react";
import { DEFAULT_LOCALE, getStrings, type Locale, type StringKey } from "./i18n";
import { IntakeScreen } from "./intake/IntakeScreen";
import { shouldAutoExpandMaquette, captureStepFromScene } from "./intake/captureSteps";
import { Header } from "./shell/Header";
import { STAGES, Stepper } from "./shell/Stepper";
import { SceneView } from "./view3d/SceneView";
import { MaquetteSheet } from "./view3d/MaquetteSheet";
import { ChatSheet } from "./agent/ChatSheet";
import { ProBanner } from "./agent/ProBanner";
import { VariantTabs } from "./agent/VariantTabs";
import { DeliverView } from "./deliver/DeliverView";
import { sendTurn } from "./agent/agentApi";
import type { AgentStage } from "./agent/agentApi";
import type { ChatMessage } from "./agent/agentTypes";
import type { OpRecordIn, Scene } from "./scene/types";

const STAGE_TO_AGENT: Partial<Record<StringKey, AgentStage>> = {
  "stage.reform": "reform",
  "stage.design": "design",
  "stage.present": "present",
};

interface AppProps {
  initialLocale?: Locale;
  initialScene?: Scene | null;
}

export function App({ initialLocale = DEFAULT_LOCALE, initialScene = null }: AppProps) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [stage, setStage] = useState<StringKey>("stage.capture");
  const [scaleConfirmed, setScaleConfirmed] = useState(initialScene?.scale_confirmed === true);
  const [hasPhoto, setHasPhoto] = useState(false);
  const [intakeScene, setIntakeScene] = useState<Scene | null>(initialScene);
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);
  const [arSession, setArSession] = useState(false);

  // Agent wiring
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [professionalFlags, setProfessionalFlags] = useState<string[]>([]);
  const [history, setHistory] = useState<OpRecordIn[]>([]);
  const [agentError, setAgentError] = useState<string | null>(null);

  const t = getStrings(locale);

  function handleIntakeScene(scene: Scene): void {
    setIntakeScene(scene);
    setScaleConfirmed(scene.scale_confirmed === true);
    if (scene.professional_flags) setProfessionalFlags(scene.professional_flags);
  }

  const agentStage = STAGE_TO_AGENT[stage] ?? null;

  const handleSend = useCallback(
    async (text: string) => {
      if (!intakeScene || !agentStage) return;
      const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: "user", text };
      setMessages((m) => [...m, userMsg]);
      setPending(true);
      setAgentError(null);
      try {
        const selected = selectedWallId ? { kind: "wall", id: selectedWallId } : null;
        const res = await sendTurn({
          scene: intakeScene,
          message: text,
          stage: agentStage,
          history,
          selected,
        });
        setIntakeScene(res.scene);
        setHistory(res.history);
        setProfessionalFlags(res.professional_flags);
        // Map ops_applied -> ToolEvent (ok:true, no errors) for chips
        const toolEvents = res.ops_applied.map((op) => ({
          name: op.name,
          arguments: (op.arguments as Record<string, unknown>) ?? {},
          ok: true as const,
          errors: [] as { code: string; message: string }[],
          warnings: [] as string[],
          flags: op.flags ?? [],
        }));
        setMessages((m) => [
          ...m,
          { id: `a-${Date.now()}`, role: "assistant", text: res.reply, toolEvents },
        ]);
      } catch (err) {
        setAgentError(err instanceof Error ? err.message : String(err));
      } finally {
        setPending(false);
      }
    },
    [intakeScene, agentStage, history, selectedWallId],
  );

  const handleAudio = useCallback(
    async (audio: Blob) => {
      // Transcribe then send as text
      try {
        const form = new FormData();
        form.append("audio", audio, "clip.webm");
        const res = await fetch("/api/transcribe", { method: "POST", body: form });
        if (!res.ok) throw new Error(`transcribe ${res.status}`);
        const body = (await res.json()) as { text?: string };
        if (body.text) await handleSend(body.text);
      } catch (err) {
        setAgentError(err instanceof Error ? err.message : String(err));
      }
    },
    [handleSend],
  );

  const stageIndex = STAGES.indexOf(stage);
  const wallsCount = intakeScene?.walls?.length ?? 0;
  const captureStep = captureStepFromScene(intakeScene ?? undefined);
  const maquetteExpanded = shouldAutoExpandMaquette(captureStep);
  const isAgentStage = agentStage !== null;
  const isReform = stage === "stage.reform";
  const isDeliver = stage === "stage.deliver";

  return (
    <div className={arSession ? "app ar-session" : "app"}>
      <Header
        locale={locale}
        onLocaleChange={setLocale}
        scaleConfirmed={scaleConfirmed}
        onBack={stageIndex > 0 ? () => setStage(STAGES[stageIndex - 1] ?? "stage.capture") : null}
      />
      <Stepper locale={locale} stage={stage} onSelect={setStage} />

      <ProBanner flags={professionalFlags} locale={locale} />

      {stage === "stage.capture" ? (
        <main className="viewport viewport-capture" aria-label={t["app.name"]}>
          {wallsCount === 0 && (
            <div className="viewport-placeholder">
              <p className="viewport-hint">{t["sheet.hint"]}</p>
            </div>
          )}
          <div className="capture-editor">
            <IntakeScreen
              locale={locale}
              initialScene={initialScene ?? undefined}
              onSceneChange={handleIntakeScene}
              onPhotoChange={setHasPhoto}
              onArSessionChange={setArSession}
            />
          </div>
          {intakeScene !== null && wallsCount > 0 && (
            <MaquetteSheet key={captureStep} scene={intakeScene} locale={locale} selectedWallId={selectedWallId} onSelectWall={setSelectedWallId} initialExpanded={maquetteExpanded} />
          )}
        </main>
      ) : isDeliver ? (
        <main className="viewport viewport-deliver" aria-label={t["app.name"]}>
          <DeliverView scene={intakeScene} takeoff={null} locale={locale} />
        </main>
      ) : (
        <main className="viewport" aria-label={t["app.name"]}>
          {intakeScene !== null && wallsCount > 0 ? (
            <SceneView scene={intakeScene} selectedWallId={selectedWallId} onSelectWall={setSelectedWallId} />
          ) : (
            <div className="viewport-placeholder">
              <p className="viewport-hint">{t["sheet.hint"]}</p>
            </div>
          )}
        </main>
      )}

      <section className="sheet" aria-label={t["app.name"]}>
        {isReform && <VariantTabs onSceneChange={handleIntakeScene} locale={locale} />}

        {isAgentStage ? (
          <div className="agent-stage">
            <ChatSheet messages={messages} locale={locale} onSend={handleSend} onAudio={handleAudio} pending={pending} />
            {agentError ? <p className="agent-error">{agentError}</p> : null}
          </div>
        ) : (
          <>
            {stage === "stage.capture" && !hasPhoto && <p className="receipt">{t["sheet.receipt"]}</p>}
            <div className="inputrow">
              <input className="prompt" type="text" placeholder={t["sheet.placeholder"]} aria-label={t["sheet.placeholder"]} disabled />
              <button type="button" className="mic" aria-label={t["sheet.mic"]}>
                🎙
              </button>
            </div>
          </>
        )}

        <div className="sheet-foot">
          <span className="preliminary">{t["notice.preliminary"]}</span>
        </div>
      </section>
    </div>
  );
}
