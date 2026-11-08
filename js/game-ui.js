import { renderStaffNote, renderStaffSequence } from "./score-renderer.js";

const AUDIO_CONTEXT = window.AudioContext || window.webkitAudioContext;

export class GameUI {
  constructor() {
    this.screens = {
      home: document.getElementById("home-screen"),
      game: document.getElementById("game-screen"),
      result: document.getElementById("result-screen"),
    };

    this.playButton = document.getElementById("play-btn");
    this.replayButton = document.getElementById("replay-btn");
    this.engineSelect = document.getElementById("engine-select");
    this.engineStatus = document.getElementById("engine-status");
    this.clefSelect = document.getElementById("clef-select");
    this.clefInputs = Array.from(document.querySelectorAll('input[name="clef-mode"]'));
    this.practiceModeSelect = document.getElementById("practice-mode-select");
    this.tempoSelector = document.getElementById("tempo-selector");
    this.tempoInput = document.getElementById("tempo-input");
    this.tempoValue = document.getElementById("tempo-value");
    this.rangeSelector = document.getElementById("range-selector");
    this.rangeStaffPanel = document.getElementById("range-staff-panel");
    this.rangeMinInput = document.getElementById("range-min-note");
    this.rangeMaxInput = document.getElementById("range-max-note");
    this.rangeSummary = document.getElementById("range-summary");
    this.rangeStaffSvg = document.getElementById("range-staff-svg");
    this.noteCountInput = document.getElementById("note-count-input");
    this.noteCountValue = document.getElementById("note-count-value");
    this.micButton = document.getElementById("mic-btn");
    this.micToggleInput = document.getElementById("mic-toggle-input");
    this.micToggleCaption = document.getElementById("mic-toggle-caption");
    this.micToggleWrap = this.micToggleInput?.closest(".mic-toggle-wrap") ?? null;
    this.replayInlineButton = document.getElementById("replay-inline-btn");
    this.debugToggleButton = document.getElementById("debug-toggle-btn");
    this.diagnosticToggleButton = document.getElementById("diagnostic-toggle-btn");
    this.diagnosticPanel = document.getElementById("diagnostic-panel");
    this.diagnosticNoteSelect = document.getElementById("diagnostic-note-select");
    this.diagnosticListenButton = document.getElementById("diagnostic-listen-btn");
    this.diagnosticResetButton = document.getElementById("diagnostic-reset-btn");
    this.diagnosticCorrectCount = document.getElementById("diagnostic-correct-count");
    this.diagnosticIncorrectCount = document.getElementById("diagnostic-incorrect-count");
    this.diagnosticLastVerdict = document.getElementById("diagnostic-last-verdict");
    this.diagnosticLog = document.getElementById("diagnostic-log");
    this.listeningIndicator = document.getElementById("listening-indicator");
    this.soundInterval = document.getElementById("sound-interval");
    this.speechDebugPanel = document.getElementById("speech-debug-panel");
    this.speechDebugLog = document.getElementById("speech-debug-log");
    this.fallbackPanel = document.getElementById("fallback-panel");
    this.feedback = document.getElementById("feedback");
    this.roundLabel = document.getElementById("round-label");
    this.scoreLabel = document.getElementById("score-label");
    this.progressFill = document.getElementById("progress-fill");
    this.progressTrack = document.querySelector(".progress-track");
    this.staffSvg = document.getElementById("staff-svg");
    this.resultScreen = document.getElementById("result-screen");
    this.resultMood = document.getElementById("result-mood");
    this.resultScore = document.getElementById("result-score");
    this.resultCorrect = document.getElementById("result-correct");
    this.resultRate = document.getElementById("result-rate");
    this.resultSpeed = document.getElementById("result-speed");
    this.resultTime = document.getElementById("result-time");

    this.audioContext = AUDIO_CONTEXT ? new AUDIO_CONTEXT() : null;
    this.rangeNotes = [];
    this.rangeInitialized = false;
    this.noteCountInitialized = false;
    this.practiceModeInitialized = false;
  }

  setupPracticeMode({ defaultMode = "static", defaultTempo = 90 } = {}) {
    if (!this.practiceModeSelect) {
      return;
    }

    const mode = defaultMode === "dynamic" ? "dynamic" : "static";
    this.practiceModeSelect.value = mode;

    if (this.tempoInput) {
      const tempo = Number.isFinite(defaultTempo) ? Math.max(40, Math.min(180, Math.round(defaultTempo))) : 90;
      this.tempoInput.min = "40";
      this.tempoInput.max = "180";
      this.tempoInput.step = "1";
      this.tempoInput.value = String(tempo);
    }

    if (!this.practiceModeInitialized) {
      this.practiceModeSelect.addEventListener("change", () => {
        this.refreshPracticeModeUI();
      });

      this.tempoInput?.addEventListener("input", () => {
        this.refreshPracticeModeUI();
      });

      this.practiceModeInitialized = true;
    }

    this.refreshPracticeModeUI();
  }

  refreshPracticeModeUI() {
    const mode = this.getSelectedPracticeMode();
    const isDynamic = mode === "dynamic";

    if (this.tempoSelector) {
      this.tempoSelector.hidden = !isDynamic;
    }

    if (this.tempoValue) {
      this.tempoValue.textContent = `${this.getSelectedTempoBpm()} BPM`;
    }
  }

  getSelectedPracticeMode() {
    if (!this.practiceModeSelect) {
      return "static";
    }

    return this.practiceModeSelect.value === "dynamic" ? "dynamic" : "static";
  }

  getSelectedTempoBpm() {
    if (!this.tempoInput) {
      return 90;
    }

    const raw = Number(this.tempoInput.value);
    if (!Number.isFinite(raw)) {
      return 90;
    }

    return Math.max(40, Math.min(180, Math.round(raw)));
  }

  getSelectedClef() {
    if (this.clefInputs.length > 0) {
      const selected = this.clefInputs.find((input) => input.checked);
      return selected?.value === "bass" ? "bass" : "treble";
    }

    if (!this.clefSelect) {
      return "treble";
    }

    return this.clefSelect.value === "bass" ? "bass" : "treble";
  }

  setupNoteCount({ min = 5, max = 20, value = 10 } = {}) {
    if (!this.noteCountInput) {
      return;
    }

    const safeMin = Number.isFinite(min) ? Math.max(1, Math.floor(min)) : 5;
    const safeMax = Number.isFinite(max) ? Math.max(safeMin, Math.floor(max)) : 20;
    const safeValue = Number.isFinite(value)
      ? Math.min(safeMax, Math.max(safeMin, Math.floor(value)))
      : 10;

    this.noteCountInput.min = String(safeMin);
    this.noteCountInput.max = String(safeMax);
    this.noteCountInput.step = "1";
    this.noteCountInput.value = String(safeValue);

    if (!this.noteCountInitialized) {
      this.noteCountInput.addEventListener("input", () => {
        this.updateNoteCountLabel();
      });
      this.noteCountInitialized = true;
    }

    this.updateNoteCountLabel();
  }

  getSelectedNoteCount() {
    if (!this.noteCountInput) {
      return 10;
    }

    const raw = Number(this.noteCountInput.value);
    const min = Number(this.noteCountInput.min);
    const max = Number(this.noteCountInput.max);

    if (!Number.isFinite(raw) || !Number.isFinite(min) || !Number.isFinite(max)) {
      return 10;
    }

    return Math.min(max, Math.max(min, Math.round(raw)));
  }

  updateNoteCountLabel() {
    if (!this.noteCountValue) {
      return;
    }

    const count = this.getSelectedNoteCount();
    this.noteCountValue.textContent = `${count} notes`;
  }

  setupNoteRange({ notes = [], defaultMinIndex = 0, defaultMaxIndex = 0 } = {}) {
    if (!this.rangeMinInput || !this.rangeMaxInput || !this.rangeStaffSvg) {
      return;
    }

    this.rangeNotes = Array.isArray(notes) ? notes : [];
    if (this.rangeNotes.length === 0) {
      this.rangeMinInput.disabled = true;
      this.rangeMaxInput.disabled = true;
      return;
    }

    const minLimit = 0;
    const maxLimit = this.rangeNotes.length - 1;
    const clampedMin = Math.min(maxLimit, Math.max(minLimit, defaultMinIndex));
    const clampedMax = Math.max(clampedMin, Math.min(maxLimit, defaultMaxIndex));

    this.rangeMinInput.min = String(minLimit);
    this.rangeMinInput.max = String(maxLimit);
    this.rangeMaxInput.min = String(minLimit);
    this.rangeMaxInput.max = String(maxLimit);
    this.rangeMinInput.value = String(clampedMin);
    this.rangeMaxInput.value = String(clampedMax);

    if (!this.rangeInitialized) {
      this.rangeMinInput.addEventListener("input", () => {
        const minIndex = Number(this.rangeMinInput.value);
        const maxIndex = Number(this.rangeMaxInput.value);
        if (Number.isFinite(minIndex) && Number.isFinite(maxIndex) && minIndex > maxIndex) {
          this.rangeMaxInput.value = String(minIndex);
        }
        this.refreshNoteRangePreview();
      });

      this.rangeMaxInput.addEventListener("input", () => {
        const minIndex = Number(this.rangeMinInput.value);
        const maxIndex = Number(this.rangeMaxInput.value);
        if (Number.isFinite(minIndex) && Number.isFinite(maxIndex) && maxIndex < minIndex) {
          this.rangeMinInput.value = String(maxIndex);
        }
        this.refreshNoteRangePreview();
      });

      this.rangeInitialized = true;
    }

    this.refreshNoteRangePreview();
  }

  getSelectedNotePool() {
    if (!this.rangeMinInput || !this.rangeMaxInput || this.rangeNotes.length === 0) {
      return [];
    }

    const minLimit = 0;
    const maxLimit = this.rangeNotes.length - 1;
    const minIndex = Math.min(maxLimit, Math.max(minLimit, Number(this.rangeMinInput.value)));
    const maxIndex = Math.min(maxLimit, Math.max(minIndex, Number(this.rangeMaxInput.value)));

    return this.rangeNotes.slice(minIndex, maxIndex + 1);
  }

  refreshNoteRangePreview() {
    if (!this.rangeStaffSvg || this.rangeNotes.length === 0) {
      return;
    }

    const selectedPool = this.getSelectedNotePool();
    if (this.rangeSelector) {
      this.rangeSelector.style.width = "";
      this.rangeSelector.style.maxWidth = "";
    }

    renderStaffSequence(this.rangeStaffSvg, selectedPool, [], -1, "expand", {
      clef: this.getSelectedClef(),
    });

    if (!this.rangeSummary) {
      return;
    }

    const first = selectedPool[0];
    const last = selectedPool[selectedPool.length - 1];
    if (!first || !last) {
      this.rangeSummary.textContent = "Selection vide";
      return;
    }

    this.rangeSummary.textContent = `De ${first.label} (${first.id}) a ${last.label} (${last.id})`;
  }

  bindEvents({
    onPlay,
    onReplay,
    onEngineChange,
    onClefChange,
    onMicToggle,
    onFallbackAnswer,
    onToggleDebug,
    onToggleDiagnostic,
    onDiagnosticListen,
    onDiagnosticReset,
  }) {
    this.playButton.addEventListener("click", onPlay);
    this.replayButton.addEventListener("click", onReplay);
    this.replayInlineButton?.addEventListener("click", onReplay);
    this.engineSelect?.addEventListener("change", onEngineChange);
    if (typeof onClefChange === "function") {
      this.clefInputs.forEach((input) => {
        input.addEventListener("change", onClefChange);
      });
      this.clefSelect?.addEventListener("change", onClefChange);
    }
    if (this.micToggleWrap) {
      this.micToggleWrap.addEventListener("click", (event) => {
        event.preventDefault();

        if (!this.micToggleInput || this.micToggleInput.disabled) {
          return;
        }

        const nextState = !this.micToggleInput.checked;
        this.micToggleInput.checked = nextState;
        onMicToggle(nextState);
      });
    } else if (this.micToggleInput) {
      this.micToggleInput.addEventListener("change", () => {
        onMicToggle(this.micToggleInput.checked);
      });
    }

    if (this.micButton) {
      this.micButton.addEventListener("click", (event) => {
        event.preventDefault();
        onMicToggle();
      });
      this.micButton.addEventListener("keydown", (event) => {
        if (event.repeat) {
          return;
        }

        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          onMicToggle();
        }
      });
    }
    this.debugToggleButton.addEventListener("click", onToggleDebug);
    this.diagnosticToggleButton.addEventListener("click", onToggleDiagnostic);
    this.diagnosticListenButton.addEventListener("click", onDiagnosticListen);
    this.diagnosticResetButton.addEventListener("click", onDiagnosticReset);

    document.querySelectorAll("[data-answer]").forEach((button) => {
      button.addEventListener("click", () => {
        onFallbackAnswer(button.dataset.answer);
      });
    });
  }

  showScreen(screenName) {
    Object.entries(this.screens).forEach(([name, element]) => {
      element.classList.toggle("screen-active", name === screenName);
    });
  }

  getSelectedEngine() {
    return this.engineSelect?.value ?? "vosk";
  }

  setSelectedEngine(engine) {
    if (!this.engineSelect) {
      return;
    }

    const nextEngine = engine === "webspeech" ? "webspeech" : "vosk";
    this.engineSelect.value = nextEngine;
  }

  setEngineStatus(message) {
    if (!this.engineStatus) {
      return;
    }

    this.engineStatus.textContent = message;
  }

  showVoiceFallback(message) {
    this.fallbackPanel.hidden = false;
    if (this.micToggleInput) {
      this.micToggleInput.checked = false;
      this.micToggleInput.disabled = true;
    }
    if (this.micButton) {
      this.micButton.disabled = true;
      this.micButton.textContent = "Micro indisponible";
    }
    if (this.micToggleCaption) {
      this.micToggleCaption.textContent = "Analyse vocale indisponible";
    }
    this.micToggleWrap?.classList.remove("listening");
    this.setFeedback(message, "neutral");
  }

  enableMicMode() {
    this.fallbackPanel.hidden = false;
    if (this.micToggleInput) {
      this.micToggleInput.disabled = false;
      this.micToggleInput.checked = false;
    }
    if (this.micButton) {
      this.micButton.disabled = false;
      this.micButton.textContent = "🎤 Micro: OFF (appuie pour activer)";
    }
    if (this.micToggleCaption) {
      this.micToggleCaption.textContent = "Analyse vocale: OFF";
    }
    this.micToggleWrap?.classList.remove("listening");
  }

  setContinuousMicMode(isEnabled) {
    if (this.micToggleInput) {
      this.micToggleInput.disabled = false;
      this.micToggleInput.checked = Boolean(isEnabled);
    }
    if (this.micButton) {
      this.micButton.disabled = false;
      this.micButton.textContent = isEnabled ? "🎤 Micro: ON (appuie pour couper)" : "🎤 Micro: OFF (appuie pour activer)";
    }
    if (this.micToggleCaption) {
      this.micToggleCaption.textContent = isEnabled ? "Analyse vocale: ON" : "Analyse vocale: OFF";
    }
    this.micToggleWrap?.classList.toggle("listening", Boolean(isEnabled));
  }

  setMicPendingMode() {
    if (this.micToggleInput) {
      this.micToggleInput.disabled = false;
      this.micToggleInput.checked = true;
    }
    if (this.micButton) {
      this.micButton.disabled = false;
      this.micButton.textContent = "🎤 Micro: activation...";
    }
    if (this.micToggleCaption) {
      this.micToggleCaption.textContent = "Analyse vocale: activation...";
    }
    this.micToggleWrap?.classList.add("listening");
  }

  setInlineReplayVisible(isVisible) {
    if (!this.replayInlineButton) {
      return;
    }

    this.replayInlineButton.hidden = !isVisible;
  }

  setHandsFreeMode(isEnabled) {
    this.handsfreeToggleButton.textContent = isEnabled ? "Mode mains libres : ON" : "Mode mains libres : OFF";
  }

  setSpeechDebugMode(isEnabled) {
    this.speechDebugPanel.hidden = !isEnabled;
    this.debugToggleButton.textContent = isEnabled ? "Desactiver debug micro" : "Activer debug micro";
  }

  setDiagnosticMode(isEnabled) {
    this.diagnosticPanel.hidden = !isEnabled;
    this.diagnosticToggleButton.textContent = isEnabled ? "Desactiver mode diagnostic" : "Activer mode diagnostic";
  }

  getDiagnosticSelectedNote() {
    return this.diagnosticNoteSelect.value;
  }

  setDiagnosticStats({ correct, incorrect }) {
    this.diagnosticCorrectCount.textContent = String(correct);
    this.diagnosticIncorrectCount.textContent = String(incorrect);
  }

  setDiagnosticVerdict(message, tone = "neutral") {
    this.diagnosticLastVerdict.textContent = message;
    this.diagnosticLastVerdict.classList.remove("success", "error", "neutral");
    this.diagnosticLastVerdict.classList.add(tone);
  }

  clearDiagnosticLog() {
    this.diagnosticLog.textContent = "";
  }

  appendDiagnosticLogLine(line) {
    const safeLine = String(line ?? "").trim();
    if (!safeLine) {
      return;
    }

    const current = this.diagnosticLog.textContent;
    this.diagnosticLog.textContent = current ? `${current}\n${safeLine}` : safeLine;
    this.diagnosticLog.scrollTop = this.diagnosticLog.scrollHeight;
  }

  clearSpeechDebugLog() {
    this.speechDebugLog.textContent = "";
  }

  appendSpeechDebugLine(line) {
    const safeLine = String(line ?? "").trim();
    if (!safeLine) {
      return;
    }

    const current = this.speechDebugLog.textContent;
    this.speechDebugLog.textContent = current ? `${current}\n${safeLine}` : safeLine;
    this.speechDebugLog.scrollTop = this.speechDebugLog.scrollHeight;
  }

  setRound({ roundNumber, totalRounds, note }) {
    this.roundLabel.textContent = `Note ${roundNumber}/${totalRounds}`;
    const progress = (roundNumber / totalRounds) * 100;
    this.progressFill.style.width = `${progress}%`;
    this.progressTrack.setAttribute("aria-valuenow", String(roundNumber));
    renderStaffNote(this.staffSvg, note);
  }

  setSequence({ notes, states, currentIndex, processedCount, totalCount, correctCount, renderOptions = {} }) {
    this.roundLabel.textContent = `Lecture ${processedCount}/${totalCount}`;
    this.scoreLabel.textContent = `Bonnes : ${correctCount}`;
    const progress = totalCount > 0 ? (processedCount / totalCount) * 100 : 0;
    this.progressFill.style.width = `${progress}%`;
    this.progressTrack.setAttribute("aria-valuenow", String(processedCount));
    this.progressTrack.setAttribute("aria-valuemax", String(totalCount));
    renderStaffSequence(this.staffSvg, notes, states, currentIndex, renderOptions.layoutMode ?? "fit", {
      ...renderOptions,
      clef: renderOptions.clef ?? this.getSelectedClef(),
    });
  }

  updateSequenceState({ notes, states, currentIndex, processedCount, totalCount, correctCount, renderOptions = {} }) {
    this.setSequence({ notes, states, currentIndex, processedCount, totalCount, correctCount, renderOptions });
  }

  setScore(score) {
    this.scoreLabel.textContent = `Score : ${score}`;
  }

  setListening(isListening) {
    this.listeningIndicator.hidden = !isListening;
    this.micToggleWrap?.classList.toggle("listening", Boolean(isListening));
    if (this.micButton) {
      this.micButton.classList.toggle("listening", Boolean(isListening));
    }
  }

  setSoundIntervalText(value) {
    if (!this.soundInterval) {
      return;
    }

    this.soundInterval.textContent = value;
  }

  setFeedback(message, tone = "neutral") {
    this.feedback.textContent = message;
    this.feedback.classList.remove("success", "error", "neutral");
    this.feedback.classList.add(tone);

    if (tone === "success") {
      this.feedback.classList.remove("celebrate");
      void this.feedback.offsetWidth;
      this.feedback.classList.add("celebrate");
      this.playSuccessSound();
    }
  }

  showResult({ performanceScore, mood, tier, correctAnswers, totalNotes, mistakes, successRate, speedNotesPerSec, readingDurationSec }) {
    const tierClassMap = {
      great: "result-tier-great",
      ok: "result-tier-ok",
      rough: "result-tier-rough",
    };

    if (this.resultScreen) {
      this.resultScreen.classList.remove("result-tier-great", "result-tier-ok", "result-tier-rough");
      this.resultScreen.classList.add(tierClassMap[tier] ?? "result-tier-rough");
    }

    if (this.resultMood) {
      this.resultMood.textContent = mood ?? "Resultat";
    }

    const safeScore = Number.isFinite(performanceScore) ? Math.round(performanceScore) : 0;
    const safeSpeed = Number.isFinite(speedNotesPerSec) ? speedNotesPerSec : 0;
    const safeDuration = Number.isFinite(readingDurationSec) ? Math.max(0, readingDurationSec) : 0;

    this.resultScore.textContent = `${safeScore} / 100`;
    this.resultCorrect.textContent = `${correctAnswers} bonne${correctAnswers > 1 ? "s" : ""} reponse${correctAnswers > 1 ? "s" : ""} sur ${totalNotes}`;
    this.resultRate.textContent = `Fautes : ${mistakes} | Reussite : ${successRate}%`;
    this.resultSpeed.textContent = `Vitesse : ${safeSpeed.toFixed(2)} note${safeSpeed >= 2 ? "s" : ""}/s`;
    this.resultTime.textContent = `Temps lecture : ${safeDuration.toFixed(2)} s`;
    this.showScreen("result");
  }

  playSuccessSound() {
    if (!this.audioContext) {
      return;
    }

    const now = this.audioContext.currentTime;
    const oscillator = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();

    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(523.25, now);
    oscillator.frequency.exponentialRampToValueAtTime(783.99, now + 0.18);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.14, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

    oscillator.connect(gain);
    gain.connect(this.audioContext.destination);

    oscillator.start(now);
    oscillator.stop(now + 0.24);
  }
}
