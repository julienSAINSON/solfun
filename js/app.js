import { GameUI } from "./game-ui.js";
import { SpeechRecognitionService } from "./speech-recognition.js";
import { VoskRecognitionService } from "./vosk-recognition.js";
import { generateRoundNotes, TREBLE_NOTES } from "./note-generator.js";
import { ContinuousReadingSession } from "./continuous-reading-session.js";
import { extractBestNoteTokenSequence, normalizeSpeechText, NOTE_ALIAS_MAP } from "./voice-note-matcher.js";

const DEFAULT_TOTAL_NOTES = 10;
const MIN_TOTAL_NOTES = 5;
const MAX_TOTAL_NOTES = 20;
const NOTE_WORDS = ["DO", "RE", "MI", "FA", "SOL", "LA", "SI", "UT"];
const WEB_SPEECH_HINTS = NOTE_WORDS.flatMap((note) => [note, note.toLowerCase()]);
const DEFAULT_MIN_NOTE_ID = "C4";
const DEFAULT_MAX_NOTE_ID = "B4";

const VOSK_MODEL_URL = "assets/models/vosk-model-small-fr/model.tar.gz";
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
const MIC_RELEASE_GRACE_MS = 280;
const VOSK_FINAL_DEDUP_WINDOW_MS = 900;

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
let pendingMicStopTimeoutId = null;
let lastAcceptedVoskFinalText = "";
let lastAcceptedVoskFinalAtMs = 0;
let exerciseFirstCapturedAtMs = null;
let exerciseLastCapturedAtMs = null;

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
  speechService.stop();
  voskService.stop();
  ui.setListening(false);
}

function clearPendingMicStop() {
  if (pendingMicStopTimeoutId === null) {
    return;
  }

  window.clearTimeout(pendingMicStopTimeoutId);
  pendingMicStopTimeoutId = null;
}

function isSelectedEngineRunning() {
  if (selectedEngine === "vosk") {
    return Boolean(voskService.started);
  }

  return Boolean(speechService.isActive);
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

  ui.updateSequenceState({
    notes: exerciseSession.notes,
    states: exerciseSession.states,
    currentIndex: exerciseSession.currentIndex,
    processedCount: exerciseSession.getProcessedCount(),
    totalCount: exerciseSession.getTotalCount(),
    correctCount: exerciseSession.correctCount,
  });
}

function resetExerciseTimingMetrics() {
  exerciseFirstCapturedAtMs = null;
  exerciseLastCapturedAtMs = null;
}

function registerCapturedNoteTimestamp() {
  const nowMs = performance.now();
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

async function startPushToTalk() {
  if (!exerciseActive || micPressActive || micStartInProgress) {
    return;
  }

  clearPendingMicStop();

  if (isSelectedEngineRunning()) {
    micPressActive = true;
    ui.setListening(true);
    ui.setFeedback("Micro repris. Parle en gardant le bouton appuye.", "neutral");
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
  }
}

function stopPushToTalk() {
  if (!micPressActive && !micStartInProgress) {
    return;
  }

  micPressToken += 1;
  micPressActive = false;
  ui.setFeedback("Micro coupe. Maintiens le bouton pour reprendre.", "neutral");

  clearPendingMicStop();
  pendingMicStopTimeoutId = window.setTimeout(() => {
    pendingMicStopTimeoutId = null;

    if (micPressActive || micStartInProgress) {
      return;
    }

    stopAllRecognition();
  }, MIC_RELEASE_GRACE_MS);
}

async function startGame() {
  if (gameStartInProgress) {
    return;
  }

  gameStartInProgress = true;

  try {
    selectedEngine = ui.getSelectedEngine();
    updateEngineStatus();
    ui.clearSpeechDebugLog();
    ui.clearDiagnosticLog();
    clearPendingMicStop();

    stopAllRecognition();
    ui.showScreen("game");
    ui.enableMicMode();
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
    const effectivePool = selectedPool.length > 0 ? selectedPool : TREBLE_NOTES;
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

    ui.setContinuousMicMode(true);
    resetSoundTiming();
    ui.setFeedback("Maintiens le bouton micro pendant que tu lis les notes.", "neutral");
    updateSequenceUI();
  } finally {
    gameStartInProgress = false;
  }
}

function noopDiagnosticAction() {
  ui.setFeedback("Le mode diagnostic detaille est desactive dans l'exercice continu.", "neutral");
}

function boot() {
  const defaultMinIndex = Math.max(0, TREBLE_NOTES.findIndex((note) => note.id === DEFAULT_MIN_NOTE_ID));
  const defaultMaxIndexRaw = TREBLE_NOTES.findIndex((note) => note.id === DEFAULT_MAX_NOTE_ID);
  const defaultMaxIndex = defaultMaxIndexRaw >= defaultMinIndex ? defaultMaxIndexRaw : TREBLE_NOTES.length - 1;
  ui.setupNoteRange({
    notes: TREBLE_NOTES,
    defaultMinIndex,
    defaultMaxIndex,
  });
  ui.setupNoteCount({
    min: MIN_TOTAL_NOTES,
    max: MAX_TOTAL_NOTES,
    value: DEFAULT_TOTAL_NOTES,
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
    onMicPress: startPushToTalk,
    onMicRelease: stopPushToTalk,
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
