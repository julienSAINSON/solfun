export class VoskRecognitionService {
  constructor({ modelUrl, sampleRate = 16000, grammarPhrases = [] } = {}) {
    this.modelUrl = modelUrl;
    this.sampleRate = sampleRate;
    this.grammarPhrases = Array.isArray(grammarPhrases) ? grammarPhrases : [];

    this.model = null;
    this.recognizer = null;
    this.audioContext = null;
    this.processorNode = null;
    this.sourceNode = null;
    this.mediaStream = null;
    this.started = false;
    this.debugHandler = null;
    this.modelLoadPromise = null;
  }

  setDebugHandler(handler) {
    this.debugHandler = typeof handler === "function" ? handler : null;
  }

  emitDebug(event, payload = {}) {
    if (!this.debugHandler) {
      return;
    }

    this.debugHandler({
      event,
      timestamp: new Date().toISOString(),
      source: "vosk",
      ...payload,
    });
  }

  isSupported() {
    const supported = Boolean(window.Vosk) && Boolean(navigator?.mediaDevices?.getUserMedia) && Boolean(window.AudioContext || window.webkitAudioContext);
    this.emitDebug("vosk-support-check", {
      supported,
      hasVoskGlobal: Boolean(window.Vosk),
      hasGetUserMedia: Boolean(navigator?.mediaDevices?.getUserMedia),
      hasAudioContext: Boolean(window.AudioContext || window.webkitAudioContext),
    });
    return supported;
  }

  async checkModelUrl() {
    try {
      const response = await fetch(this.modelUrl, {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        this.emitDebug("vosk-model-fetch-failed", { status: response.status });
        return { ok: false, reason: "model-not-found", status: response.status };
      }

      this.emitDebug("vosk-model-fetch-ok", { status: response.status });
      return { ok: true };
    } catch (error) {
      this.emitDebug("vosk-model-fetch-error", { error: String(error) });
      return { ok: false, reason: "model-fetch-error", error };
    }
  }

  async ensureModelLoaded() {
    if (!this.isSupported()) {
      return { ok: false, reason: "unsupported" };
    }

    if (this.model) {
      return { ok: true };
    }

    if (this.modelLoadPromise) {
      return this.modelLoadPromise;
    }

    if (!this.modelUrl) {
      return { ok: false, reason: "missing-model-url" };
    }

    this.modelLoadPromise = (async () => {
      this.emitDebug("vosk-model-load-start", { modelUrl: this.modelUrl });

      const modelCheck = await this.checkModelUrl();
      if (!modelCheck.ok) {
        return modelCheck;
      }

      try {
        this.model = await window.Vosk.createModel(this.modelUrl);
        this.emitDebug("vosk-model-load-success", { modelUrl: this.modelUrl });
        return { ok: true };
      } catch (error) {
        this.emitDebug("vosk-model-load-failed", { error: String(error) });
        return { ok: false, reason: "model-load-failed", error };
      }
    })();

    const result = await this.modelLoadPromise;
    if (!result.ok) {
      this.modelLoadPromise = null;
    }

    return result;
  }

  isModelReady() {
    return Boolean(this.model);
  }

  async startContinuous({ onPartial, onFinal, onError, onReady } = {}) {
    if (this.started) {
      return { ok: false, reason: "busy" };
    }

    const modelResult = await this.ensureModelLoaded();
    if (!modelResult.ok) {
      return modelResult;
    }

    try {
      this.emitDebug("vosk-mic-request-start");
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
          sampleRate: this.sampleRate,
        },
      });
      this.emitDebug("vosk-mic-request-success");
    } catch (error) {
      this.emitDebug("vosk-mic-request-failed", { error: String(error) });
      return { ok: false, reason: "mic-permission-failed", error };
    }

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioCtx();

      const grammar = this.grammarPhrases.length > 0 ? JSON.stringify(this.grammarPhrases) : undefined;
      this.recognizer = new this.model.KaldiRecognizer(this.sampleRate, grammar);
      this.emitDebug("vosk-recognizer-created", {
        sampleRate: this.sampleRate,
        grammarApplied: Boolean(grammar),
      });

      this.recognizer.on("partialresult", (message) => {
        const text = message?.result?.partial ?? "";
        this.emitDebug("vosk-partial", { text });
        onPartial?.({ text, raw: message });
      });

      this.recognizer.on("result", (message) => {
        const text = message?.result?.text ?? "";
        const words = Array.isArray(message?.result?.result) ? message.result.result : [];
        this.emitDebug("vosk-final", { text, wordsCount: words.length });
        onFinal?.({ text, words, raw: message });
      });

      this.recognizer.on("error", (message) => {
        this.emitDebug("vosk-recognizer-error", { message: JSON.stringify(message) });
        onError?.({ reason: "vosk-error", raw: message });
      });

      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);

      this.processorNode.onaudioprocess = (event) => {
        if (!this.recognizer) {
          return;
        }

        try {
          this.recognizer.acceptWaveform(event.inputBuffer);
        } catch (error) {
          this.emitDebug("vosk-accept-waveform-failed", { error: String(error) });
          onError?.({ reason: "accept-waveform-failed", error });
        }
      };

      this.sourceNode.connect(this.processorNode);
      this.processorNode.connect(this.audioContext.destination);
      this.started = true;
      this.emitDebug("vosk-started");
      onReady?.();
      return { ok: true };
    } catch (error) {
      this.emitDebug("vosk-start-failed", { error: String(error) });
      this.stop();
      return { ok: false, reason: "start-failed", error };
    }
  }

  stop() {
    this.emitDebug("vosk-stop");
    this.started = false;

    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode.onaudioprocess = null;
      this.processorNode = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.recognizer) {
      try {
        this.recognizer.remove();
      } catch (error) {
        // Ignore cleanup errors.
      }
      this.recognizer = null;
    }

    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => {
        track.stop();
      });
      this.mediaStream = null;
    }
  }

  terminateModel() {
    if (this.model) {
      try {
        this.model.terminate();
      } catch (error) {
        // Ignore termination errors.
      }
      this.model = null;
    }
  }
}
