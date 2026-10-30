import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_LOCALE, getStrings, type Locale, type StringKey } from "./i18n";
import { IntakeScreen } from "./intake/IntakeScreen";
import { captureStepFromScene, shouldAutoExpandMaquette, type CaptureStepKey } from "./intake/captureSteps";
import { HomeScreen } from "./home/HomeScreen";
import { MethodScreen } from "./home/MethodScreen";
import { isARSupported } from "./measure/xrAdapter";
import { PresentView } from "./present/PresentView";
import { Banner } from "./ui";
import { Header } from "./shell/Header";
import { STAGES, Stepper } from "./shell/Stepper";
import { SceneView } from "./view3d/SceneView";
import { MaquetteSheet } from "./view3d/MaquetteSheet";
import { ChatSheet } from "./agent/ChatSheet";
import { transcribeClip } from "./agent/transcribe";
import { ProBanner } from "./agent/ProBanner";
import { ReformScreen } from "./agent/ReformScreen";
import { DeliverView } from "./deliver/DeliverView";
import { parseTakeoff } from "./deliver/takeoffFormat";
import type { Takeoff } from "./deliver/takeoffTypes";
import { sendEdit, sendTurn } from "./agent/agentApi";
import type { EditCall } from "./agent/editCall";
import { useVariants } from "./agent/VariantTabs";
import { getAgentStrings } from "./agent/agent.i18n";
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

  // Deliver takeoff (fetched when the Deliver stage opens)
  const [takeoff, setTakeoff] = useState<Takeoff | null>(null);
  const [takeoffLoading, setTakeoffLoading] = useState(false);
  const [takeoffError, setTakeoffError] = useState<string | null>(null);

  function baseUrl(): string {
    const v: unknown = (import.meta as unknown as Record<string, unknown>).env
      ? (import.meta as unknown as { env: Record<string, unknown> }).env.VITE_API_URL
      : undefined;
    return typeof v === "string" && v.length > 0 ? v : "/api";
  }

  useEffect(() => {
    if (stage !== "stage.deliver" || !intakeScene) return;
    let cancelled = false;
    setTakeoffLoading(true);
    setTakeoffError(null);
    const payload = { scene: intakeScene };
    fetch(`${baseUrl()}/export/takeoff`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.text().catch(() => "")) || `takeoff ${res.status}`);
        return res.json() as Promise<unknown>;
      })
      .then((raw) => {
        if (cancelled) return;
        try {
          setTakeoff(parseTakeoff(raw));
        } catch (err) {
          setTakeoffError(err instanceof Error ? err.message : String(err));
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setTakeoffError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setTakeoffLoading(false);
      });
    return () => { cancelled = true; };
  }, [stage, intakeScene]);

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

  // Now baseline: the Scene when Reform started (read-only; A/B/C hold the edits).
  const baseSceneRef = useRef<Scene | null>(null);
  useEffect(() => {
    if (stage !== "stage.reform") baseSceneRef.current = null;
    else if (baseSceneRef.current === null && intakeScene) baseSceneRef.current = intakeScene;
  }, [stage, intakeScene]);
  const variants = useVariants(
    (scene, ops) => {
      setIntakeScene(scene);
      setHistory(ops);
      setProfessionalFlags(scene.professional_flags ?? []);
    },
    () => baseSceneRef.current,
  );
  const readOnlyMessage = getAgentStrings(locale)["variants.nowReadOnly"];

  const handleSend = useCallback(
    async (text: string) => {
      if (!intakeScene || !agentStage) return;
      if (stage === "stage.reform" && variants.active === null) {
        setAgentError(readOnlyMessage);
        return;
      }
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
          variant: stage === "stage.reform" ? variants.active : null,
          baseScene: baseSceneRef.current,
        });
        setIntakeScene(res.scene);
        setHistory(res.history);
        setProfessionalFlags(res.professional_flags);
        void variants.reload();
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
    [intakeScene, agentStage, history, selectedWallId, stage, variants, readOnlyMessage],
  );

  const handleEdit = useCallback(
    async (call: EditCall): Promise<string | null> => {
      if (!intakeScene) return "No scene";
      if (variants.active === null) return readOnlyMessage;
      try {
        const res = await sendEdit({
          scene: intakeScene,
          tool: call.tool,
          args: call.args,
          history,
          variant: variants.active,
          baseScene: baseSceneRef.current,
        });
        void variants.reload();
        setIntakeScene(res.scene);
        setHistory(res.history);
        setProfessionalFlags(res.professional_flags);
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    },
    [intakeScene, history, variants, readOnlyMessage],
  );

  const handleAudio = useCallback(
    async (audio: Blob) => {
      // Transcribe then send as text
      try {
        const text = await transcribeClip(audio, locale);
        if (text) await handleSend(text);
      } catch (err) {
        setAgentError(err instanceof Error ? err.message : String(err));
      }
    },
    [handleSend, locale],
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
  const isPresent = stage === "stage.present";

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
      ) : isPresent ? (
        <PresentView
          scene={intakeScene}
          locale={locale}
          selectedWallId={selectedWallId}
          onSelectWall={setSelectedWallId}
          onSceneChange={handleIntakeScene}
        />
      ) : isReform ? (
        <ReformScreen
          scene={intakeScene}
          locale={locale}
          selectedWallId={selectedWallId}
          onSelectWall={setSelectedWallId}
          onSceneChange={handleIntakeScene}
          messages={messages}
          onSend={handleSend}
          onAudio={handleAudio}
          pending={pending}
          agentError={agentError}
          onNext={() => setStage(STAGES[stageIndex + 1] ?? "stage.deliver")}
          onEdit={handleEdit}
          variants={variants}
        />
      ) : isDeliver ? (
        <main className="flex min-h-0 flex-1 flex-col" aria-label={t["app.name"]}>
          {takeoffLoading ? (
            <div className="px-3 pt-3"><Banner tone="info" title={t["deliver.loading"]} /></div>
          ) : takeoffError ? (
            <div className="px-3 pt-3"><Banner tone="danger" title={t["deliver.takeoffError"]}>{takeoffError}</Banner></div>
          ) : null}
          <DeliverView scene={intakeScene} takeoff={takeoff} locale={locale} />
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
        {(showWork || (isAgentStage && !isReform)) && (<>

        {isAgentStage ? (
          <div className="agent-stage">
            <ChatSheet messages={messages} locale={locale} onSend={handleSend} onAudio={handleAudio} pending={pending} />
            {agentError ? <p className="agent-error">{agentError}</p> : null}
          </div>
        ) : (
          stage === "stage.capture" && !hasPhoto && <p className="receipt">{t["sheet.receipt"]}</p>
        )}
        </>)}

        <div className="sheet-foot">
          <span className="preliminary">{t["notice.preliminary"]}</span>
        </div>
      </section>
    </div>
  );
}
