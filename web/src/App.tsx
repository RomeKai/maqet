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
import { captureGuideImages } from "./view3d/GuideCapture";
import { renderRealLifeViews } from "./design/realLifeViews";
import { getDesignStrings } from "./design/design.i18n";
import { ReformScreen } from "./agent/ReformScreen";
import { DesignScreen, type DesignEditResult } from "./design/DesignScreen";
import { EMPTY_REAL_LIFE, type RealLifeState, type StyleId } from "./design/RealLifeCard";
import { chatKey, toConversation } from "./agent/conversation";
import { DeliverView } from "./deliver/DeliverView";
import { parseTakeoff } from "./deliver/takeoffFormat";
import type { Takeoff } from "./deliver/takeoffTypes";
import { AgentCancelledError, sendEdit, sendTurn } from "./agent/agentApi";
import type { EditCall } from "./agent/editCall";
import { splitToolNotes } from "./agent/toolNotes";
import { useVariants } from "./agent/VariantTabs";
import { getAgentStrings } from "./agent/agent.i18n";
import { AgentErrorNotice } from "./agent/AgentErrorNotice";
import { describeAgentError, plainAgentError, type AgentErrorInfo } from "./agent/agentError";
import type { AgentStage } from "./agent/agentApi";
import type { ChatMessage } from "./agent/agentTypes";
import type { OpRecordIn, Scene } from "./scene/types";
import { clearProject, saveProject, type ProjectSnapshot } from "./persist/projectStore";

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
  /** Project read from the phone's storage on load; wins over `initialScene`. */
  restored?: ProjectSnapshot | null;
  /** Start a new project (the parent drops the stored one and remounts). */
  onNewProject?: () => void;
}

export function App({ initialLocale = DEFAULT_LOCALE, initialScene: seededScene = null, initialView, arSupported, restored = null, onNewProject }: AppProps) {
  const initialScene = restored?.scene ?? seededScene;
  const [locale, setLocale] = useState<Locale>(restored?.locale ?? initialLocale);
  const [stage, setStage] = useState<StringKey>(restored?.stage ?? "stage.capture");
  const [hasPhoto, setHasPhoto] = useState(false);
  const [intakeScene, setIntakeScene] = useState<Scene | null>(initialScene);
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);
  const [arSession, setArSession] = useState(false);
  const [view, setView] = useState<CaptureView>(initialView ?? (initialScene ? "work" : "home"));
  // The capture workspace mounts on first entry and then stays mounted (hidden)
  // so going back to Home or the method list never drops the scene.
  const [workMounted, setWorkMounted] = useState(view === "work");
  const [startInAr, setStartInAr] = useState(false);
  const [captureStep, setCaptureStep] = useState<CaptureStepKey>(restored?.captureStep ?? (initialScene?.walls?.length ? captureStepFromScene(initialScene) : "photo"));
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
  // One conversation per variant (and one for Design): switching variants switches the chat.
  const [chats, setChats] = useState<Record<string, ChatMessage[]>>(restored?.chats ?? {});
  const [pending, setPending] = useState(false);
  const [professionalFlags, setProfessionalFlags] = useState<string[]>(restored?.professionalFlags ?? []);
  const [history, setHistory] = useState<OpRecordIn[]>(restored?.history ?? []);
  const [agentError, setAgentError] = useState<AgentErrorInfo | null>(null);

  const t = getStrings(locale);

  // An error belongs to the stage that raised it: "Try again" would resend its message to another stage's agent.
  useEffect(() => {
    setAgentError(null);
  }, [stage]);

  function handleIntakeScene(scene: Scene): void {
    setIntakeScene(scene);
    if (scene.professional_flags) setProfessionalFlags(scene.professional_flags);
  }

  const agentStage = STAGE_TO_AGENT[stage] ?? null;

  // Now baseline: the Scene when Reform started (read-only; A/B/C hold the edits).
  const baseSceneRef = useRef<Scene | null>(restored?.baseScene ?? null);
  useEffect(() => {
    if (stage !== "stage.reform") baseSceneRef.current = null;
    else if (baseSceneRef.current === null && intakeScene) baseSceneRef.current = intakeScene;
  }, [stage, intakeScene]);
  // One store of (Scene, ops) per variant: the response of its last turn/edit replaces it,
  // so switching A -> B -> A never shows a Scene older than the last result (bug W).
  const variantStore = useRef<Record<string, { scene: Scene; ops: OpRecordIn[] }>>(restored?.variants ?? {});
  const activeVariantRef = useRef<string | null>(null);
  const variants = useVariants(
    (scene, ops, label) => {
      variantStore.current[label] = { scene, ops };
      setIntakeScene(scene);
      setHistory(ops);
      setProfessionalFlags(scene.professional_flags ?? []);
    },
    () => baseSceneRef.current,
    (label) => variantStore.current[label] ?? null,
  );
  activeVariantRef.current = variants.active;

  // Reform start: align the server's variants with this baseline (new baseline = clean store).
  // A restored Reform session keeps its server variants: do not re-start them from the baseline.
  const startedFor = useRef<Scene | null>(restored?.baseScene ?? null);
  useEffect(() => {
    const base = baseSceneRef.current;
    if (stage !== "stage.reform" || base === null || startedFor.current === base) return;
    startedFor.current = base;
    variantStore.current = {};
    void variants.start(base);
  }, [stage, intakeScene, variants]);
  useEffect(() => {
    if (stage !== "stage.reform") startedFor.current = null;
  }, [stage]);
  // Persist the project on the phone so a reload resumes where it was (try/catch inside saveProject).
  useEffect(() => {
    if (intakeScene === null || !intakeScene.walls?.length) return;
    saveProject({
      v: 1,
      locale,
      stage,
      captureStep,
      scene: intakeScene,
      baseScene: baseSceneRef.current,
      variants: variantStore.current,
      history,
      chats,
      professionalFlags,
    });
  }, [locale, stage, captureStep, intakeScene, history, chats, professionalFlags]);
  const readOnlyMessage = getAgentStrings(locale)["variants.nowReadOnly"];
  const activeKey = chatKey(stage, variants.active);
  const messages = chats[activeKey] ?? [];
  const addMessage = useCallback((key: string, message: ChatMessage) => {
    setChats((c) => ({ ...c, [key]: [...(c[key] ?? []), message] }));
  }, []);

  // The turn in flight: Cancel aborts it, and a reply for any other turn is ignored (never touches Scene or chat).
  const turnRef = useRef<{ id: number; text: string; controller: AbortController } | null>(null);
  const turnCounter = useRef(0);

  const handleSend = useCallback(
    async (text: string, retry = false) => {
      if (!intakeScene || !agentStage) return;
      if (stage === "stage.reform" && variants.active === null) {
        setAgentError(plainAgentError(readOnlyMessage));
        return;
      }
      const key = activeKey; // a late reply lands in the chat it was asked in
      // A retry resends the failed message without a second bubble or a duplicate in the memory.
      const last = messages[messages.length - 1];
      const dropLast = retry && last?.role === "user" && last.text === text;
      const conversation = toConversation(dropLast ? messages.slice(0, -1) : messages);
      if (!dropLast) addMessage(key, { id: `u-${Date.now()}`, role: "user", text });
      const turn = { id: ++turnCounter.current, text, controller: new AbortController() };
      turnRef.current = turn;
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
          conversation,
        }, { signal: turn.controller.signal });
        if (turnRef.current?.id !== turn.id) return; // cancelled while the reply was in flight
        if (stage === "stage.reform" && variants.active !== null) {
          variantStore.current[variants.active] = { scene: res.scene, ops: res.history };
        }
        // A reply for a variant the user already left must not replace the Scene on screen.
        if (stage !== "stage.reform" || activeVariantRef.current === variants.active) {
          setIntakeScene(res.scene);
          setHistory(res.history);
          setProfessionalFlags(res.professional_flags);
        }
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
        const notes = splitToolNotes(res.reply, res.tool_errors, res.tool_warnings, getAgentStrings(locale)["chat.errorFallback"]);
        addMessage(key, {
          id: `a-${Date.now()}`,
          role: "assistant",
          text: notes.text,
          details: notes.details,
          spoken: res.reply,
          toolEvents,
        });
      } catch (err) {
        if (err instanceof AgentCancelledError || turnRef.current?.id !== turn.id) return;
        setAgentError(describeAgentError(err, locale, text));
      } finally {
        if (turnRef.current?.id === turn.id) {
          turnRef.current = null;
          setPending(false);
        }
      }
    },
    [intakeScene, agentStage, history, selectedWallId, stage, variants, readOnlyMessage, activeKey, messages, addMessage, locale],
  );

  const handleCancel = useCallback((): void => {
    const turn = turnRef.current;
    if (turn === null) return;
    turnRef.current = null; // from here on the turn's reply, if any, is ignored
    turn.controller.abort();
    setPending(false);
    setAgentError({ ...plainAgentError(getAgentStrings(locale)["chat.cancelled"]), retryText: turn.text });
  }, [locale]);

  const handleRetry = useCallback((): void => {
    if (agentError?.retryText) void handleSend(agentError.retryText, true);
  }, [agentError, handleSend]);

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
        if (variants.active !== null) variantStore.current[variants.active] = { scene: res.scene, ops: res.history };
        void variants.reload();
        if (activeVariantRef.current === variants.active) {
          setIntakeScene(res.scene);
          setHistory(res.history);
          setProfessionalFlags(res.professional_flags);
        }
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    },
    [intakeScene, history, variants, readOnlyMessage],
  );

  const handleDesignEdit = useCallback(
    async (call: EditCall): Promise<DesignEditResult> => {
      if (!intakeScene) return { error: "No scene", warnings: [] };
      try {
        const res = await sendEdit({ scene: intakeScene, tool: call.tool, args: call.args, history, variant: null });
        setIntakeScene(res.scene);
        setHistory(res.history);
        setProfessionalFlags(res.professional_flags);
        return { error: null, warnings: res.tool_warnings ?? [] };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err), warnings: [] };
      }
    },
    [intakeScene, history],
  );

  const [realLife, setRealLife] = useState<RealLifeState>(EMPTY_REAL_LIFE);
  const handleRealLife = useCallback(
    async (roomId: string, style: StyleId): Promise<void> => {
      if (!intakeScene || realLife.pending) return;
      setRealLife((s) => ({ ...s, pending: true, error: null }));
      try {
        // Fixed captures of the Design scene keep the layout from each angle; no capture falls back to text-only.
        const guides = await captureGuideImages(intakeScene, roomId);
        const { images, failed, firstError } = await renderRealLifeViews(guides, async (guide) => {
          const res = await fetch(`${baseUrl()}/render/real-life`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ scene: intakeScene, room_id: roomId, style, guide_image_b64: guide }),
          });
          if (!res.ok) throw new Error((await res.text().catch(() => "")) || `render ${res.status}`);
          const body = (await res.json()) as { image_b64: string };
          return `data:image/png;base64,${body.image_b64}`;
        });
        if (images.length === 0) throw new Error(firstError ?? "render failed");
        const partial = failed > 0 ? getDesignStrings(locale)["real.partial"].replace("{n}", String(failed)) : null;
        setRealLife({ images, pending: false, error: partial });
      } catch (err) {
        setRealLife((s) => ({ ...s, pending: false, error: err instanceof Error ? err.message : String(err) }));
      }
    },
    [intakeScene, realLife.pending, locale],
  );

  const handleAudio = useCallback(
    async (audio: Blob) => {
      // Transcribe then send as text
      try {
        const text = await transcribeClip(audio, locale);
        if (text) await handleSend(text);
      } catch (err) {
        setAgentError(describeAgentError(err, locale, null));
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
  const isDesign = stage === "stage.design";
  const isDeliver = stage === "stage.deliver";
  const isPresent = stage === "stage.present";

  return (
    <div className={arSession ? "app ar-session" : "app"}>
      <Header
        locale={locale}
        onLocaleChange={setLocale}
        scene={intakeScene}
        onBack={canGoBack ? goBack : null}
      />
      <Stepper locale={locale} stage={stage} onSelect={setStage} />

      <ProBanner flags={professionalFlags} locale={locale} compact />

      {onCapture && view === "home" && (
        <HomeScreen
          locale={locale}
          captured={wallsCount > 0}
          onStart={() => setView("method")}
          onContinue={() => enterWork(false)}
          onNewProject={() => {
            if (onNewProject) onNewProject();
            else {
              clearProject();
              setView("method");
            }
          }}
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
          realLife={realLife}
          onRealLife={(r, st) => void handleRealLife(r, st)}
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
          onRetry={handleRetry}
          onCancel={handleCancel}
          onNext={() => setStage(STAGES[stageIndex + 1] ?? "stage.deliver")}
          onEdit={handleEdit}
          variants={variants}
        />
      ) : isDesign ? (
        <DesignScreen
          scene={intakeScene}
          locale={locale}
          selectedWallId={selectedWallId}
          onSelectWall={setSelectedWallId}
          messages={messages}
          onSend={handleSend}
          onAudio={handleAudio}
          pending={pending}
          agentError={agentError}
          onRetry={handleRetry}
          onCancel={handleCancel}
          onNext={() => setStage(STAGES[stageIndex + 1] ?? "stage.deliver")}
          onEdit={handleDesignEdit}
          realLife={realLife}
          onRealLife={(r, st) => void handleRealLife(r, st)}
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
            <SceneView scene={intakeScene} selectedWallId={selectedWallId} onSelectWall={setSelectedWallId} wallNumbers={isAgentStage} />
          ) : (
            <div className="viewport-placeholder">
              <p className="viewport-hint">{t["sheet.hint"]}</p>
            </div>
          )}
        </main>
      )}

      <section className="sheet" aria-label={t["app.name"]}>
        {(showWork || (isAgentStage && !isReform && !isDesign)) && (<>

        {isAgentStage ? (
          <div className="agent-stage">
            <ChatSheet messages={messages} locale={locale} onSend={handleSend} onAudio={handleAudio} pending={pending} onCancel={handleCancel} suggestions suggestionStage="design" />
            {agentError ? <AgentErrorNotice error={agentError} locale={locale} onRetry={handleRetry} busy={pending} /> : null}
          </div>
        ) : (
          stage === "stage.capture" && !hasPhoto && wallsCount === 0 && <p className="receipt">{t["sheet.receipt"]}</p>
        )}
        </>)}

        <div className="sheet-foot">
          <span className="preliminary">{t["notice.preliminary"]}</span>
        </div>
      </section>
    </div>
  );
}
