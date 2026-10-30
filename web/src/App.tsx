import { useCallback, useEffect, useState } from "react";
import { DEFAULT_LOCALE, getStrings, type Locale, type StringKey } from "./i18n";
import { IntakeScreen } from "./intake/IntakeScreen";
import { captureStepFromScene, shouldAutoExpandMaquette, type CaptureStepKey } from "./intake/captureSteps";
import { HomeScreen } from "./home/HomeScreen";
import { MethodScreen } from "./home/MethodScreen";
import { isARSupported } from "./measure/xrAdapter";
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

type CaptureView = "home" | "method" | "work";

interface AppProps {
  initialLocale?: Locale;
  /** Start inside the capture workspace instead of Home. A seeded scene implies it. */
  initialView?: CaptureView;
  /** Test seam: skip WebXR detection. */
  arSupported?: boolean;
  initialScene?: Scene | null;
}

export function App({ initialLocale = DEFAULT_LOCALE, initialScene = null, initialView, arSupported }: AppProps) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [stage, setStage] = useState<StringKey>("stage.capture");
  const [scaleConfirmed, setScaleConfirmed] = useState(initialScene?.scale_confirmed === true);
  const [hasPhoto, setHasPhoto] = useState(false);
  const [intakeScene, setIntakeScene] = useState<Scene | null>(initialScene);
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);
  const [arSession, setArSession] = useState(false);
  const [view, setView] = useState<CaptureView>(initialView ?? (initialScene ? "work" : "home"));
  // The capture workspace mounts on first entry and then stays mounted (hidden)
  // so going back to Home or the method list never drops the scene.
  const [workMounted, setWorkMounted] = useState(view === "work");
  const [startInAr, setStartInAr] = useState(false);
  const [captureStep, setCaptureStep] = useState<CaptureStepKey>(initialScene?.walls?.length ? captureStepFromScene(initialScene) : "photo");
  const [arAvailable, setArAvailable] = useState(arSupported ?? false);

  useEffect(() => {
    if (arSupported !== undefined) return;
    let cancelled = false;
    void isARSupported().then((ok) => {
      if (!cancelled) setArAvailable(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [arSupported]);

  function enterWork(ar: boolean): void {
    setStartInAr(ar);
    setWorkMounted(true);
    setView("work");
  }

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
  const onCapture = stage === "stage.capture";
  const showWork = onCapture && view === "work";

  function goBack(): void {
    if (onCapture && view === "work") setView("method");
    else if (onCapture && view === "method") setView("home");
    else if (stageIndex > 0) setStage(STAGES[stageIndex - 1] ?? "stage.capture");
  }
  const canGoBack = !(onCapture && view === "home");
  const wallsCount = intakeScene?.walls?.length ?? 0;
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
        onBack={canGoBack ? goBack : null}
      />
      <Stepper locale={locale} stage={stage} onSelect={setStage} />

      <ProBanner flags={professionalFlags} locale={locale} />

      {onCapture && view === "home" && (
        <HomeScreen
          locale={locale}
          captured={wallsCount > 0}
          onStart={() => setView("method")}
          onContinue={() => enterWork(false)}
          onNewProject={() => setView("method")}
        />
      )}
      {onCapture && view === "method" && (
        <MethodScreen locale={locale} arSupported={arAvailable} onPhoto={() => enterWork(false)} onAr={() => enterWork(true)} />
      )}
      {onCapture ? (
        workMounted && (
        <main className="viewport viewport-capture" aria-label={t["app.name"]} style={showWork ? undefined : { display: "none" }}>
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
              startInAr={startInAr}
              hideScaleBadge
              onStepChange={setCaptureStep}
              onLooksRight={() => setStage("stage.reform")}
            />
          </div>
          {intakeScene !== null && wallsCount > 0 && (
            <MaquetteSheet key={captureStep} scene={intakeScene} locale={locale} selectedWallId={selectedWallId} onSelectWall={setSelectedWallId} initialExpanded={maquetteExpanded} />
          )}
        </main>
        )
      ) : isDeliver ? (
        <main className="flex min-h-0 flex-1 flex-col" aria-label={t["app.name"]}>
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
        {(showWork || !onCapture) && (<>
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
        </>)}

        <div className="sheet-foot">
          <span className="preliminary">{t["notice.preliminary"]}</span>
        </div>
      </section>
    </div>
  );
}
