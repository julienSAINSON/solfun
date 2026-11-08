import { GameUI } from "./game-ui.js";
import { SpeechRecognitionService } from "./speech-recognition.js";
import { VoskRecognitionService } from "./vosk-recognition.js";
import { generateRoundNotes, TREBLE_NOTES, BASS_NOTES } from "./note-generator.js";
import { ContinuousReadingSession } from "./continuous-reading-session.js";
import { extractBestNoteTokenSequence, normalizeSpeechText, NOTE_ALIAS_MAP } from "./voice-note-matcher.js";

const DEFAULT_TOTAL_NOTES = 10;
const MIN_TOTAL_NOTES = 5;
const MAX_TOTAL_NOTES = 20;
const DEFAULT_PRACTICE_MODE = "static";
const DEFAULT_DYNAMIC_TEMPO_BPM = 90;
const DYNAMIC_BEAT_WINDOW_RATIO = 0.78;
const DYNAMIC_TIMING_BAR_BASE_X = 218;
const DYNAMIC_TIMING_BAR_NOTE_WIDTH_SHIFT = 24;
const DYNAMIC_TIMING_BAR_X = DYNAMIC_TIMING_BAR_BASE_X + DYNAMIC_TIMING_BAR_NOTE_WIDTH_SHIFT;
const NOTE_WORDS = ["DO", "RE", "MI", "FA", "SOL", "LA", "SI", "UT"];
const WEB_SPEECH_HINTS = NOTE_WORDS.flatMap((note) => [note, note.toLowerCase()]);
const DEFAULT_CLEF = "treble";
const DEFAULT_RANGE_BY_CLEF = {
  treble: { minNoteId: "C4", maxNoteId: "B4" },
  bass: { minNoteId: "C3", maxNoteId: "B3" },
};

const VOSK_MODEL_URL = "assets/models/vosk-model-small-fr/model.tar.gz";
const APP_VERSION_URL = "assets/app-version.json";
const VOSK_GRAMMAR_PHRASES = [
  ...Array.from(
    new Set(
      Object.values(NOTE_ALIAS_MAP)
        .flat()
        .map((alias) => String(alias ?? "").toLowerCase().trim())
        .filter(Boolean)
    )
  ),
  "[unk]",
];
const VOSK_FINAL_DEDUP_WINDOW_MS = 900;
const VOSK_SILENT_FALLBACK_MS = 3600;

const ui = new GameUI();
const speechService = new SpeechRecognitionService("fr-FR");
const voskService = new VoskRecognitionService({
  modelUrl: VOSK_MODEL_URL,
  sampleRate: 16000,
  grammarPhrases: VOSK_GRAMMAR_PHRASES,
});

let speechDebugEnabled = false;
let exerciseSession = null;
let exerciseActive = false;
let selectedClef = DEFAULT_CLEF;
let practiceMode = DEFAULT_PRACTICE_MODE;
let dynamicTempoBpm = DEFAULT_DYNAMIC_TEMPO_BPM;
let selectedEngine = "vosk";
let gameStartInProgress = false;
let micPressActive = false;
let micStartInProgress = false;
let micPressToken = 0;
let firstSoundAtMs = null;
let secondSoundAtMs = null;
let voskPreloadInFlight = false;
let liveTokenCursor = 0;
let lastLoggedVoskPartial = "";
let lastAcceptedVoskFinalText = "";
let lastAcceptedVoskFinalAtMs = 0;
let exerciseFirstCapturedAtMs = null;
let exerciseLastCapturedAtMs = null;
let dynamicTimeline = null;
let voskSilentWatchdogId = null;
let voskReceivedSpeechSignal = false;

const processedWebSpeechFinalChunkIds = new Set();

function formatDebugClock(isoTimestamp) {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) {
    return "--:--:--";
  }

  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function writeSpeechDebugEvent(event) {
  if (!speechDebugEnabled) {
    return;
  }

  if (event.event === "vosk-partial") {
    const normalizedPartial = normalizeSpeechText(event.text ?? "");
    if (normalizedPartial && normalizedPartial === lastLoggedVoskPartial) {
      return;
    }
    lastLoggedVoskPartial = normalizedPartial;
  }

  if (["vosk-final", "vosk-started", "vosk-stop"].includes(event.event)) {
    lastLoggedVoskPartial = "";
  }

  const clock = formatDebugClock(event.timestamp);
  const linesByEvent = {
    start: `[${clock}] start (lang=${event.lang})`,
    "result-interim": `[${clock}] interim: \"${event.text ?? ""}\"`,
    "result-final": `[${clock}] final: \"${event.text ?? ""}\"`,
    nomatch: `[${clock}] nomatch`,
    end: `[${clock}] end`,
    "abort-requested": `[${clock}] abort-requested`,
    error: `[${clock}] error: ${event.reason ?? "error"} (raw=${event.rawError ?? "unknown"})`,
    "start-failed": `[${clock}] start-failed`,
    capabilities: `[${clock}] capabilities: impl=${event.implementation ?? "unknown"}, phrases=${event.supportsPhrases ? "yes" : "no"}, maxAlternatives=${event.supportsMaxAlternatives ? "yes" : "no"}, navigatorLang=${event.navigatorLanguage ?? "unknown"}`,
    "phrases-applied": `[${clock}] phrases-applied`,
    "phrases-unsupported": `[${clock}] phrases-unsupported`,
    "phrases-failed": `[${clock}] phrases-failed`,
    "continuous-restart": `[${clock}] continuous-restart`,
    "continuous-restart-failed": `[${clock}] continuous-restart-failed`,
    "vosk-support-check": `[${clock}] vosk-support: supported=${event.supported ? "yes" : "no"}, Vosk=${event.hasVoskGlobal ? "yes" : "no"}, getUserMedia=${event.hasGetUserMedia ? "yes" : "no"}, AudioContext=${event.hasAudioContext ? "yes" : "no"}`,
    "vosk-model-load-start": `[${clock}] vosk-model-load-start: ${event.modelUrl ?? ""}`,
    "vosk-model-fetch-ok": `[${clock}] vosk-model-fetch-ok (status=${event.status ?? "?"})`,
    "vosk-model-fetch-failed": `[${clock}] vosk-model-fetch-failed (status=${event.status ?? "?"})`,
    "vosk-model-fetch-error": `[${clock}] vosk-model-fetch-error`,
    "vosk-model-load-success": `[${clock}] vosk-model-load-success`,
    "vosk-model-load-failed": `[${clock}] vosk-model-load-failed`,
    "vosk-mic-request-start": `[${clock}] vosk-mic-request-start`,
    "vosk-mic-request-success": `[${clock}] vosk-mic-request-success`,
    "vosk-mic-request-failed": `[${clock}] vosk-mic-request-failed`,
    "vosk-mic-track-settings": `[${clock}] vosk-mic-track-settings (sampleRate=${event.sampleRate ?? "?"}, channels=${event.channelCount ?? "?"}, ec=${event.echoCancellation ?? "?"}, ns=${event.noiseSuppression ?? "?"}, agc=${event.autoGainControl ?? "?"})`,
    "vosk-grammar-disabled-mobile": `[${clock}] vosk-grammar-disabled-mobile`,
    "vosk-recognizer-created": `[${clock}] vosk-recognizer-created (grammar=${event.grammarApplied ? "yes" : "no"})`,
    "vosk-partial": `[${clock}] vosk-partial: "${event.text ?? ""}"`,
    "vosk-final": `[${clock}] vosk-final: "${event.text ?? ""}"`,
    "vosk-recognizer-error": `[${clock}] vosk-recognizer-error`,
    "vosk-accept-waveform-failed": `[${clock}] vosk-accept-waveform-failed`,
    "vosk-started": `[${clock}] vosk-started`,
    "vosk-start-failed": `[${clock}] vosk-start-failed`,
    "vosk-stop": `[${clock}] vosk-stop`,
  };

  ui.appendSpeechDebugLine(linesByEvent[event.event] ?? `[${clock}] ${event.event}`);

  if (["result-interim", "result-final"].includes(event.event) && Array.isArray(event.alternatives)) {
    event.alternatives.forEach((alt) => {
      const confidence = typeof alt.confidence === "number" ? alt.confidence.toFixed(3) : "n/a";
      ui.appendSpeechDebugLine(`  - alt#${alt.rank ?? "?"}: \"${alt.text ?? ""}\" (conf=${confidence})`);
    });
  }
}

function toggleSpeechDebugMode() {
  speechDebugEnabled = !speechDebugEnabled;
  ui.setSpeechDebugMode(speechDebugEnabled);

  if (speechDebugEnabled) {
    lastLoggedVoskPartial = "";
    ui.clearSpeechDebugLog();
    ui.appendSpeechDebugLine("Mode debug actif");
    speechService.setDebugHandler(writeSpeechDebugEvent);
    voskService.setDebugHandler(writeSpeechDebugEvent);
    return;
  }

  lastLoggedVoskPartial = "";
  speechService.setDebugHandler(null);
  voskService.setDebugHandler(null);
}

function updateEngineStatus() {
  if (selectedEngine === "vosk") {
    const voskAvailable = Boolean(window.Vosk);
    const modelState = voskService.isModelReady() ? "modele pret" : "modele non charge";
    ui.setEngineStatus(`Moteur: Vosk prototype (modele: ${VOSK_MODEL_URL}) - lib=${voskAvailable ? "ok" : "absente"}, ${modelState}`);
    return;
  }

  ui.setEngineStatus("Moteur: Web Speech du navigateur");
}

function setAppVersionBadge(versionLabel) {
  const badge = document.getElementById("app-version-badge");
  if (!badge) {
    return;
  }

  badge.textContent = `Version ${versionLabel}`;
}

async function loadAndRenderAppVersion() {
  try {
    const cacheBuster = `ts=${Date.now()}`;
    const response = await fetch(`${APP_VERSION_URL}?${cacheBuster}`, {
      method: "GET",
      cache: "no-store",
    });

    if (!response.ok) {
      setAppVersionBadge("dev");
      return;
    }

    const payload = await response.json();
    const version = String(payload?.version ?? "").trim();
    setAppVersionBadge(version || "dev");
  } catch (error) {
    setAppVersionBadge("dev");
  }
}

async function preloadVoskModelInBackground() {
  if (selectedEngine !== "vosk") {
    return;
  }

  if (!voskService.isSupported() || voskService.isModelReady() || voskPreloadInFlight) {
    updateEngineStatus();
    return;
  }

  voskPreloadInFlight = true;
  ui.setEngineStatus("Moteur: Vosk prototype - prechargement du modele...");

  const preloadResult = await voskService.ensureModelLoaded();
  voskPreloadInFlight = false;

  if (!preloadResult.ok) {
    ui.setEngineStatus(`Vosk non charge (${preloadResult.reason ?? "erreur"}). Attendu: ${VOSK_MODEL_URL}`);
    return;
  }

  ui.setEngineStatus("Moteur: Vosk prototype - modele precharge (pret)");
}

function stopAllRecognition() {
  clearVoskSilentWatchdog();
  speechService.stop();
  voskService.stop();
  ui.setListening(false);
}

function clearVoskSilentWatchdog() {
  if (voskSilentWatchdogId === null) {
    return;
  }

  window.clearTimeout(voskSilentWatchdogId);
  voskSilentWatchdogId = null;
}

function armVoskSilentWatchdog() {
  clearVoskSilentWatchdog();
  voskReceivedSpeechSignal = false;

  voskSilentWatchdogId = window.setTimeout(() => {
    voskSilentWatchdogId = null;

    if (!exerciseActive || !micPressActive || selectedEngine !== "vosk") {
      return;
    }

    if (voskReceivedSpeechSignal) {
      return;
    }

    ui.appendSpeechDebugLine("Aucun resultat Vosk detecte: bascule auto Web Speech.");

    if (!speechService.isSupported()) {
      ui.setFeedback("Vosk muet sur cet appareil et Web Speech indisponible.", "error");
      return;
    }

    selectedEngine = "webspeech";
    ui.setSelectedEngine("webspeech");
    ui.setEngineStatus("Bascule auto vers Web Speech (Vosk muet sur cet appareil)");

    stopAllRecognition();
    ui.setListening(true);
    const switched = startWebSpeechContinuous();
    if (switched) {
      ui.setFeedback("Bascule auto Web Speech active. Continue de parler.", "success");
    } else {
      ui.setFeedback("Echec de la bascule auto vers Web Speech.", "error");
    }
  }, VOSK_SILENT_FALLBACK_MS);
}

function resetSoundTiming() {
  firstSoundAtMs = null;
  secondSoundAtMs = null;
  ui.setSoundIntervalText("Intervalle 1er-2e son: --");
}

function resetLiveValidationState() {
  liveTokenCursor = 0;
}

function resetVoskFinalDedupState() {
  lastAcceptedVoskFinalText = "";
  lastAcceptedVoskFinalAtMs = 0;
}

function registerDetectedSound(rawText) {
  if (!micPressActive) {
    return;
  }

  const normalized = normalizeSpeechText(rawText ?? "");
  if (!normalized) {
    return;
  }

  const now = performance.now();

  if (firstSoundAtMs === null) {
    firstSoundAtMs = now;
    ui.setSoundIntervalText("Intervalle 1er-2e son: en attente du 2e son...");
    return;
  }

  if (secondSoundAtMs === null) {
    secondSoundAtMs = now;
    const delta = Math.max(0, Math.round(secondSoundAtMs - firstSoundAtMs));
    ui.setSoundIntervalText(`Intervalle 1er-2e son: ${delta} ms`);
  }
}

function updateSequenceUI() {
  if (!exerciseSession) {
    return;
  }

  const renderOptions = { layoutMode: "fit" };
  if (practiceMode === "dynamic") {
    renderOptions.layoutMode = "dynamic";
    renderOptions.dynamicSpacing = dynamicTimeline?.dynamicSpacing ?? 58;
    renderOptions.dynamicLeadIn = dynamicTimeline?.dynamicLeadIn ?? 92;
    renderOptions.timingBarX = dynamicTimeline?.timingBarX ?? DYNAMIC_TIMING_BAR_X;

    if (dynamicTimeline) {
    const elapsedMs = Math.max(0, performance.now() - dynamicTimeline.startAtMs);
    const beatsProgress = elapsedMs / dynamicTimeline.beatMs;
      renderOptions.motionOffsetX = beatsProgress * dynamicTimeline.dynamicSpacing;
    } else {
      renderOptions.motionOffsetX = 0;
    }
  }

  renderOptions.clef = selectedClef;

  ui.updateSequenceState({
    notes: exerciseSession.notes,
    states: exerciseSession.states,
    currentIndex: exerciseSession.currentIndex,
    processedCount: exerciseSession.getProcessedCount(),
    totalCount: exerciseSession.getTotalCount(),
    correctCount: exerciseSession.correctCount,
    renderOptions,
  });
}

function getClefPool(clef) {
  return clef === "bass" ? BASS_NOTES : TREBLE_NOTES;
}

function configureNoteRangeForClef(clef) {
  const safeClef = clef === "bass" ? "bass" : "treble";
  const pool = getClefPool(safeClef);
  const defaults = DEFAULT_RANGE_BY_CLEF[safeClef] ?? DEFAULT_RANGE_BY_CLEF.treble;
  const defaultMinIndex = Math.max(0, pool.findIndex((note) => note.id === defaults.minNoteId));
  const defaultMaxIndexRaw = pool.findIndex((note) => note.id === defaults.maxNoteId);
  const defaultMaxIndex = defaultMaxIndexRaw >= defaultMinIndex ? defaultMaxIndexRaw : pool.length - 1;

  ui.setupNoteRange({
    notes: pool,
    defaultMinIndex,
    defaultMaxIndex,
  });
}

function stopDynamicTimeline() {
  if (!dynamicTimeline) {
    return;
  }

  if (dynamicTimeline.rafId !== null) {
    window.cancelAnimationFrame(dynamicTimeline.rafId);
  }

  dynamicTimeline = null;
}

function findNextPendingIndex(startIndex = 0, maxIndex = Number.POSITIVE_INFINITY) {
  if (!exerciseSession) {
    return -1;
  }

  const clampedStart = Math.max(0, Math.min(startIndex, exerciseSession.notes.length - 1));
  const clampedMax = Math.max(clampedStart, Math.min(maxIndex, exerciseSession.notes.length - 1));

  for (let index = clampedStart; index <= clampedMax; index += 1) {
    if (exerciseSession.states[index] === "pending") {
      return index;
    }
  }

  return -1;
}

function getDynamicBeatsProgress(nowMs = performance.now()) {
  if (!dynamicTimeline) {
    return 0;
  }

  const elapsedMs = Math.max(0, nowMs - dynamicTimeline.startAtMs);
  return elapsedMs / dynamicTimeline.beatMs;
}

function evaluateDynamicNoteAtIndex(index) {
  if (!exerciseSession || !dynamicTimeline) {
    return;
  }

  const expectedLabel = String(exerciseSession.getNoteAt(index)?.label ?? "").toUpperCase();
  if (!expectedLabel) {
    return;
  }

  const targetBeat = dynamicTimeline.barOffsetBeats + index;
  const windowStart = targetBeat - dynamicTimeline.hitWindowHalfBeats;
  const windowEnd = targetBeat + dynamicTimeline.hitWindowHalfBeats;

  const candidates = dynamicTimeline.captureEvents.filter(
    (event) => !event.used && event.beatsProgress >= windowStart && event.beatsProgress <= windowEnd
  );

  const exactMatch = candidates.find((event) => event.token === expectedLabel) ?? null;

  let verdict = null;
  if (exactMatch) {
    exactMatch.used = true;
    verdict = exerciseSession.markRecognizedAtIndex(index, exactMatch.token);
    if (verdict) {
      registerCapturedNoteTimestamp(exactMatch.atMs);
      ui.setFeedback(`OK ${verdict.actualLabel}`, "success");
    }
  } else if (candidates.length > 0) {
    const nearest = candidates.reduce((best, current) => {
      const bestDelta = Math.abs(best.beatsProgress - targetBeat);
      const currentDelta = Math.abs(current.beatsProgress - targetBeat);
      return currentDelta < bestDelta ? current : best;
    });
    nearest.used = true;
    verdict = exerciseSession.markRecognizedAtIndex(index, nearest.token);
    if (verdict) {
      registerCapturedNoteTimestamp(nearest.atMs);
      ui.setFeedback(`Non: attendu ${verdict.expectedLabel}, entendu ${verdict.actualLabel}`, "error");
    }
  } else {
    verdict = exerciseSession.markTimeoutAtIndex(index);
    if (verdict) {
      ui.setFeedback(`Trop tard: attendu ${verdict.expectedLabel}`, "error");
    }
  }
}

function resolveDynamicEvaluations() {
  if (!exerciseSession || !dynamicTimeline) {
    return;
  }

  const beatsProgress = getDynamicBeatsProgress();
  const resolvedThrough = Math.floor(beatsProgress - dynamicTimeline.barOffsetBeats - dynamicTimeline.hitWindowHalfBeats);

  if (resolvedThrough <= dynamicTimeline.lastEvaluatedIndex) {
    return;
  }

  const endIndex = Math.min(resolvedThrough, exerciseSession.notes.length - 1);
  for (let index = dynamicTimeline.lastEvaluatedIndex + 1; index <= endIndex; index += 1) {
    evaluateDynamicNoteAtIndex(index);
  }

  dynamicTimeline.lastEvaluatedIndex = endIndex;
}

function pruneDynamicCaptureEvents() {
  if (!dynamicTimeline) {
    return;
  }

  const minKeepBeat = dynamicTimeline.lastEvaluatedIndex + dynamicTimeline.barOffsetBeats - 2;
  dynamicTimeline.captureEvents = dynamicTimeline.captureEvents.filter(
    (event) => !event.used && event.beatsProgress >= minKeepBeat
  );
}

function startDynamicTimeline() {
  stopDynamicTimeline();

  if (!exerciseSession || !exerciseActive) {
    return;
  }

  const beatMs = 60000 / Math.max(40, dynamicTempoBpm);
  dynamicTimeline = {
    startAtMs: performance.now(),
    beatMs,
    dynamicSpacing: 58,
    dynamicLeadIn: 92,
    timingBarX: DYNAMIC_TIMING_BAR_X,
    rafId: null,
    barOffsetBeats: 92 / 58,
    hitWindowHalfBeats: DYNAMIC_BEAT_WINDOW_RATIO / 2,
    captureEvents: [],
    lastEvaluatedIndex: -1,
  };

  const tick = () => {
    if (!dynamicTimeline || !exerciseSession || !exerciseActive) {
      return;
    }

    resolveDynamicEvaluations();
    pruneDynamicCaptureEvents();

    const beatsProgress = getDynamicBeatsProgress();
    const barRelative = beatsProgress - dynamicTimeline.barOffsetBeats;
    const currentSlot = Math.max(0, Math.min(Math.round(barRelative), exerciseSession.notes.length));
    const highlightIndex = findNextPendingIndex(Math.max(0, currentSlot - 1), exerciseSession.notes.length - 1);
    exerciseSession.setCurrentIndex(highlightIndex >= 0 ? highlightIndex : currentSlot);
    updateSequenceUI();

    if (exerciseSession.isFinished()) {
      finishExercise();
      return;
    }

    dynamicTimeline.rafId = window.requestAnimationFrame(tick);
  };

  dynamicTimeline.rafId = window.requestAnimationFrame(tick);
}

function applyRecognizedNotesInDynamicMode(noteTokens) {
  if (!exerciseSession || !exerciseActive || !dynamicTimeline || !Array.isArray(noteTokens) || noteTokens.length === 0) {
    return;
  }

  const nowMs = performance.now();
  const beatsProgress = getDynamicBeatsProgress(nowMs);

  noteTokens.forEach((tokenValue) => {
    const token = String(tokenValue ?? "").toUpperCase();
    if (!token) {
      return;
    }

    dynamicTimeline.captureEvents.push({
      token,
      beatsProgress,
      atMs: nowMs,
      used: false,
    });
  });

  resolveDynamicEvaluations();
  pruneDynamicCaptureEvents();
  updateSequenceUI();

  if (exerciseSession.isFinished()) {
    finishExercise();
  }
}

function resetExerciseTimingMetrics() {
  exerciseFirstCapturedAtMs = null;
  exerciseLastCapturedAtMs = null;
}

function registerCapturedNoteTimestamp(atMs = performance.now()) {
  const nowMs = Number.isFinite(atMs) ? atMs : performance.now();
  if (exerciseFirstCapturedAtMs === null) {
    exerciseFirstCapturedAtMs = nowMs;
  }
  exerciseLastCapturedAtMs = nowMs;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, value));
}

function computePerformanceSummary(session) {
  const totalNotes = session.getTotalCount();
  const correctAnswers = session.correctCount;
  const mistakes = session.incorrectCount;
  const successRate = session.getSuccessRate();

  const elapsedMs =
    exerciseFirstCapturedAtMs !== null && exerciseLastCapturedAtMs !== null
      ? Math.max(0, exerciseLastCapturedAtMs - exerciseFirstCapturedAtMs)
      : 0;
  const readingDurationSec = elapsedMs / 1000;
  const effectiveDurationSec = Math.max(1.2, readingDurationSec || 0);
  const speedNotesPerSec = totalNotes > 0 ? totalNotes / effectiveDurationSec : 0;

  const speedTargetNps = 2.2;
  const speedScore = clampScore(Math.round((speedNotesPerSec / speedTargetNps) * 100));
  const baseScore = Math.round(successRate * 0.68 + speedScore * 0.32);
  const mistakesPenalty = mistakes * 7;
  const performanceScore = clampScore(baseScore - mistakesPenalty);

  let tier = "rough";
  let mood = "On reprend en rythme !";
  if (performanceScore >= 80) {
    tier = "great";
    mood = "Tempo de star !";
  } else if (performanceScore >= 55) {
    tier = "ok";
    mood = "Bien joue, encore un effort !";
  }

  return {
    totalNotes,
    correctAnswers,
    mistakes,
    successRate,
    readingDurationSec,
    speedNotesPerSec,
    performanceScore,
    tier,
    mood,
  };
}

function finishExercise() {
  if (!exerciseSession) {
    return;
  }

  const performance = computePerformanceSummary(exerciseSession);

  exerciseActive = false;
  stopDynamicTimeline();
  stopAllRecognition();
  ui.setInlineReplayVisible(false);
  ui.showResult(performance);
}

function applyRecognizedNotesInOrder(noteTokens) {
  if (!exerciseSession || exerciseSession.isFinished()) {
    return;
  }

  for (let index = 0; index < noteTokens.length; index += 1) {
    const token = noteTokens[index];
    const verdict = exerciseSession.consumeRecognizedNote(token);

    if (!verdict) {
      return;
    }

    registerCapturedNoteTimestamp();

    if (verdict.isCorrect) {
      ui.setFeedback(`OK ${verdict.actualLabel}`, "success");
    } else {
      ui.setFeedback(`Non: attendu ${verdict.expectedLabel}, entendu ${verdict.actualLabel}`, "error");
    }

    updateSequenceUI();

    if (verdict.isFinished) {
      finishExercise();
      return;
    }
  }
}

function applyExpectedNotePrefix(noteTokens) {
  if (!exerciseSession || exerciseSession.isFinished()) {
    return;
  }

  let nextCursor = liveTokenCursor;

  while (nextCursor < noteTokens.length) {
    const token = String(noteTokens[nextCursor] ?? "").toUpperCase();
    const expected = exerciseSession.getExpectedNote();
    const expectedLabel = String(expected?.label ?? "").toUpperCase();

    if (!expectedLabel || token !== expectedLabel) {
      break;
    }

    const verdict = exerciseSession.consumeRecognizedNote(token);
    if (!verdict) {
      break;
    }

    registerCapturedNoteTimestamp();

    ui.setFeedback(`OK ${verdict.actualLabel}`, "success");
    updateSequenceUI();
    nextCursor += 1;

    if (verdict.isFinished) {
      finishExercise();
      break;
    }
  }

  liveTokenCursor = nextCursor;
}

function handleRecognitionPayload(payload, options = {}) {
  if (!exerciseActive || !exerciseSession) {
    return;
  }

  const { isFinal = false } = options;

  const extraction = extractBestNoteTokenSequence(payload);
  const tokens = extraction.tokens;

  if (practiceMode === "dynamic") {
    if (tokens.length > 0) {
      applyRecognizedNotesInDynamicMode(tokens);
    }
    return;
  }

  if (tokens.length === 0) {
    if (isFinal) {
      resetLiveValidationState();
    }
    return;
  }

  if (!isFinal) {
    applyExpectedNotePrefix(tokens);
    return;
  }

  const remainingTokens = tokens.slice(liveTokenCursor);
  if (remainingTokens.length > 0) {
    applyRecognizedNotesInOrder(remainingTokens);
  }

  resetLiveValidationState();
}

function handleWebSpeechChunk(chunk) {
  if (!exerciseActive) {
    return;
  }

  if (!chunk?.isFinal) {
    const interimNormalized = normalizeSpeechText(chunk?.text ?? "");
    if (interimNormalized) {
      registerDetectedSound(interimNormalized);
      ui.setFeedback(`J'entends: ${interimNormalized}`, "neutral");
    }

    handleRecognitionPayload({
      text: chunk?.text ?? "",
      alternatives: chunk?.alternatives,
    });

    return;
  }

  registerDetectedSound(chunk?.text ?? "");

  if (chunk.chunkId && processedWebSpeechFinalChunkIds.has(chunk.chunkId)) {
    return;
  }

  if (chunk.chunkId) {
    processedWebSpeechFinalChunkIds.add(chunk.chunkId);
    if (processedWebSpeechFinalChunkIds.size > 200) {
      const firstKey = processedWebSpeechFinalChunkIds.values().next().value;
      processedWebSpeechFinalChunkIds.delete(firstKey);
    }
  }

  handleRecognitionPayload({
    text: chunk.text,
    alternatives: chunk.alternatives,
  }, { isFinal: true });
}

function handleWebSpeechError(error) {
  const hardFailureReasons = ["not-allowed", "service-not-allowed", "audio-capture", "restart-failed"];
  if (hardFailureReasons.includes(error.reason)) {
    exerciseActive = false;
    ui.setFeedback("Micro indisponible pour l'exercice continu.", "error");
    ui.showVoiceFallback("Mode boutons active.");
    return;
  }

  if (error.reason === "no-speech") {
    ui.setFeedback("Pause detectee. Continue la lecture des notes.", "neutral");
  }
}

function handleVoskPartial(payload) {
  if (!exerciseActive) {
    return;
  }

  voskReceivedSpeechSignal = true;
  clearVoskSilentWatchdog();

  const partial = normalizeSpeechText(payload?.text ?? "");
  if (partial) {
    registerDetectedSound(partial);
    ui.setFeedback(`J'entends: ${partial}`, "neutral");
  }

  handleRecognitionPayload({
    text: payload?.text ?? "",
    alternatives: [{ rank: 1, text: payload?.text ?? "", confidence: null }],
  });
}

function handleVoskFinal(payload) {
  if (!exerciseActive) {
    return;
  }

  voskReceivedSpeechSignal = true;
  clearVoskSilentWatchdog();

  const normalizedFinal = normalizeSpeechText(payload?.text ?? "");
  if (!normalizedFinal) {
    return;
  }

  const nowMs = performance.now();
  const isDuplicateFinal =
    normalizedFinal === lastAcceptedVoskFinalText &&
    nowMs - lastAcceptedVoskFinalAtMs <= VOSK_FINAL_DEDUP_WINDOW_MS;

  if (isDuplicateFinal) {
    return;
  }

  lastAcceptedVoskFinalText = normalizedFinal;
  lastAcceptedVoskFinalAtMs = nowMs;

  registerDetectedSound(payload?.text ?? "");

  handleRecognitionPayload({
    text: payload?.text ?? "",
    alternatives: [{ rank: 1, text: payload?.text ?? "", confidence: null }],
  }, { isFinal: true });
}

function handleVoskError(error) {
  clearVoskSilentWatchdog();
  const hardFailureReasons = ["mic-permission-failed", "accept-waveform-failed", "vosk-error", "start-failed"];
  if (hardFailureReasons.includes(error.reason)) {
    exerciseActive = false;
    ui.setFeedback("Erreur Vosk pendant l'ecoute continue.", "error");
    ui.showVoiceFallback("Mode boutons active.");
  }
}

function startWebSpeechContinuous() {
  ui.setListening(true);

  const result = speechService.startContinuous({
    phraseHints: WEB_SPEECH_HINTS,
    onChunk: handleWebSpeechChunk,
    onError: handleWebSpeechError,
    onReady: () => {
      if (!exerciseActive || !micPressActive) {
        return;
      }

      ui.setFeedback("Micro pret. Parle maintenant.", "success");
    },
  });

  if (!result.ok) {
    ui.setListening(false);
    ui.setFeedback("Impossible de demarrer Web Speech en continu.", "error");
    if (["unsupported", "start-failed"].includes(result.reason)) {
      ui.showVoiceFallback("Mode boutons active.");
    }
    return false;
  }

  return true;
}

async function startVoskContinuous() {
  ui.setListening(true);
  ui.setFeedback(voskService.isModelReady() ? "Activation du micro Vosk..." : "Chargement du modele Vosk...", "neutral");

  const result = await voskService.startContinuous({
    onPartial: handleVoskPartial,
    onFinal: handleVoskFinal,
    onError: handleVoskError,
    onReady: () => {
      if (!exerciseActive || !micPressActive) {
        return;
      }

      ui.setFeedback("Micro pret. Parle maintenant.", "success");
    },
  });

  if (!result.ok) {
    clearVoskSilentWatchdog();
    ui.setListening(false);

    if (["model-load-failed", "model-not-found", "model-fetch-error"].includes(result.reason)) {
      ui.setFeedback("Modele Vosk introuvable. Installe le modele local.", "error");
      ui.setEngineStatus(`Vosk non charge. Attendu: ${VOSK_MODEL_URL}`);
      ui.appendSpeechDebugLine("Aide: lance scripts/install-vosk-model-fr.ps1 puis relance.");
      return false;
    }

    if (result.reason === "unsupported") {
      ui.setFeedback("Vosk non supporte sur ce navigateur.", "error");
      return false;
    }

    ui.setFeedback("Impossible de demarrer Vosk.", "error");
    return false;
  }

  armVoskSilentWatchdog();
  ui.setFeedback("Lis les notes de gauche a droite.", "neutral");
  return true;
}

async function startActiveEngineContinuous() {
  if (!exerciseActive) {
    return false;
  }

  if (selectedEngine === "vosk") {
    return startVoskContinuous();
  }

  return startWebSpeechContinuous();
}

async function toggleMicListening(shouldEnable) {
  if (!exerciseActive || micStartInProgress) {
    return;
  }

  const targetEnable = typeof shouldEnable === "boolean" ? shouldEnable : !micPressActive;

  if (!targetEnable) {
    micPressToken += 1;
    micPressActive = false;
    stopAllRecognition();
    ui.setContinuousMicMode(false);
    ui.setFeedback("Micro en pause. Active le micro pour reprendre.", "neutral");
    return;
  }

  micPressActive = true;
  micStartInProgress = true;
  const localToken = ++micPressToken;

  resetSoundTiming();
  resetLiveValidationState();
  resetVoskFinalDedupState();
  ui.setListening(true);
  ui.setFeedback("Activation du micro... attends le message 'Micro pret'.", "neutral");

  const started = await startActiveEngineContinuous();
  micStartInProgress = false;

  if (!micPressActive || localToken !== micPressToken) {
    stopAllRecognition();
    return;
  }

  if (!started) {
    micPressActive = false;
    ui.setListening(false);
    ui.setContinuousMicMode(false);
    return;
  }

  ui.setContinuousMicMode(true);
  ui.setFeedback("Micro actif. Parle maintenant.", "success");

  if (practiceMode === "dynamic" && !dynamicTimeline) {
    startDynamicTimeline();
    ui.setFeedback(`Mode dynamique (${dynamicTempoBpm} BPM): suis la barre bleue.`, "neutral");
  }
}

async function startGame() {
  if (gameStartInProgress) {
    return;
  }

  gameStartInProgress = true;

  try {
    selectedEngine = ui.getSelectedEngine();
    selectedClef = ui.getSelectedClef();
    practiceMode = ui.getSelectedPracticeMode();
    dynamicTempoBpm = ui.getSelectedTempoBpm();
    updateEngineStatus();
    ui.clearSpeechDebugLog();
    ui.clearDiagnosticLog();
    stopDynamicTimeline();

    stopAllRecognition();
    ui.showScreen("game");
    ui.enableMicMode();
    ui.setContinuousMicMode(false);
    ui.setInlineReplayVisible(false);

    if (selectedEngine === "webspeech" && !speechService.isSupported()) {
      ui.showVoiceFallback("Ton navigateur ne supporte pas Web Speech en continu.");
      return;
    }

    if (selectedEngine === "vosk" && !voskService.isSupported()) {
      ui.showVoiceFallback("Vosk non supporte ici. Essaie Web Speech.");
      return;
    }

    const selectedPool = ui.getSelectedNotePool();
    const effectivePool = selectedPool.length > 0 ? selectedPool : getClefPool(selectedClef);
    const selectedNoteCount = ui.getSelectedNoteCount();
    const notes = generateRoundNotes(selectedNoteCount, effectivePool);
    exerciseSession = new ContinuousReadingSession(notes);
    exerciseActive = true;
    micPressActive = false;
    micStartInProgress = false;
    micPressToken += 1;
    processedWebSpeechFinalChunkIds.clear();
    resetLiveValidationState();
    resetVoskFinalDedupState();
    resetExerciseTimingMetrics();
    exerciseSession.setCurrentIndex(0);

    ui.setContinuousMicMode(false);
    resetSoundTiming();
    if (practiceMode === "dynamic") {
      ui.setFeedback(`Mode dynamique (${dynamicTempoBpm} BPM): suis la barre bleue.`, "neutral");
    } else {
      ui.setFeedback("Active l'interrupteur micro pour lancer ou couper l'ecoute.", "neutral");
    }
    updateSequenceUI();
  } finally {
    gameStartInProgress = false;
  }
}

function noopDiagnosticAction() {
  ui.setFeedback("Le mode diagnostic detaille est desactive dans l'exercice continu.", "neutral");
}

function boot() {
  loadAndRenderAppVersion();

  selectedClef = ui.getSelectedClef();
  configureNoteRangeForClef(selectedClef);
  ui.setupNoteCount({
    min: MIN_TOTAL_NOTES,
    max: MAX_TOTAL_NOTES,
    value: DEFAULT_TOTAL_NOTES,
  });
  ui.setupPracticeMode({
    defaultMode: DEFAULT_PRACTICE_MODE,
    defaultTempo: DEFAULT_DYNAMIC_TEMPO_BPM,
  });

  selectedEngine = ui.getSelectedEngine();
  updateEngineStatus();
  ui.setSpeechDebugMode(speechDebugEnabled);
  ui.setDiagnosticMode(false);
  resetSoundTiming();

  ui.bindEvents({
    onPlay: startGame,
    onReplay: startGame,
    onEngineChange: () => {
      selectedEngine = ui.getSelectedEngine();
      updateEngineStatus();
      preloadVoskModelInBackground();
    },
    onClefChange: () => {
      selectedClef = ui.getSelectedClef();
      configureNoteRangeForClef(selectedClef);
      ui.refreshNoteRangePreview();
    },
    onMicToggle: toggleMicListening,
    onToggleDebug: toggleSpeechDebugMode,
    onToggleDiagnostic: noopDiagnosticAction,
    onDiagnosticListen: noopDiagnosticAction,
    onDiagnosticReset: noopDiagnosticAction,
    onFallbackAnswer: (answer) => {
      if (!exerciseSession || exerciseSession.isFinished()) {
        return;
      }
      applyRecognizedNotesInOrder([String(answer ?? "").toUpperCase()]);
    },
  });

  preloadVoskModelInBackground();
}

boot();
