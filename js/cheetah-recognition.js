export class CheetahRecognitionService {
  constructor({
    accessKey = "",
    modelBase64 = "",
    language = "fr",
  } = {}) {
    this.accessKey = String(accessKey ?? "").trim();
    this.modelBase64 = String(modelBase64 ?? "").trim();
    this.language = String(language ?? "fr").trim() || "fr";

    this.debugHandler = null;
    this.started = false;

    this.worker = null;
    this.mediaStream = null;
    this.audioContext = null;
    this.sourceNode = null;
    this.processorNode = null;
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
      source: "cheetah",
      timestamp: new Date().toISOString(),
      ...payload,
    });
  }

  hasConfiguration() {
    return Boolean(this.accessKey) && Boolean(this.modelBase64);
  }

  async isSupported() {
    if (!navigator?.mediaDevices?.getUserMedia || !(window.AudioContext || window.webkitAudioContext)) {
      return false;
    }

    try {
      const module = await import("https://cdn.jsdelivr.net/npm/@picovoice/cheetah-web@latest/+esm");
      return Boolean(module?.CheetahWorker);
    } catch (error) {
      this.emitDebug("cheetah-module-load-failed", { error: String(error) });
      return false;
    }
  }

  async startContinuous({ onPartial, onFinal, onError, onReady } = {}) {
    if (this.started) {
      return { ok: false, reason: "busy" };
    }

    if (!this.hasConfiguration()) {
      return { ok: false, reason: "missing-config" };
    }

    let CheetahWorker;
    try {
      const module = await import("https://cdn.jsdelivr.net/npm/@picovoice/cheetah-web@latest/+esm");
      CheetahWorker = module?.CheetahWorker;
    } catch (error) {
      this.emitDebug("cheetah-module-load-failed", { error: String(error) });
      return { ok: false, reason: "module-load-failed", error };
    }

    if (!CheetahWorker) {
      return { ok: false, reason: "unsupported" };
    }

    try {
      this.worker = await CheetahWorker.create(
        this.accessKey,
        (result) => {
          const text = String(result?.transcript ?? "").trim();
          const isEndpoint = Boolean(result?.isEndpoint);
          if (!text) {
            return;
          }

          this.emitDebug(isEndpoint ? "cheetah-final" : "cheetah-partial", { text });
          onPartial?.({ text, raw: result });
          if (isEndpoint) {
            onFinal?.({ text, raw: result });
          }
        },
        {
          base64: this.modelBase64,
          enableAutomaticPunctuation: false,
          language: this.language,
        }
      );
    } catch (error) {
      this.emitDebug("cheetah-init-failed", { error: String(error) });
      return { ok: false, reason: "init-failed", error };
    }

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
      });
    } catch (error) {
      this.emitDebug("cheetah-mic-failed", { error: String(error) });
      this.stop();
      return { ok: false, reason: "mic-permission-failed", error };
    }

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioCtx({ sampleRate: 16000 });
      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }

      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.processorNode = this.audioContext.createScriptProcessor(512, 1, 1);

      this.processorNode.onaudioprocess = (event) => {
        if (!this.worker) {
          return;
        }

        const input = event.inputBuffer.getChannelData(0);
        const int16 = new Int16Array(input.length);
        for (let i = 0; i < input.length; i += 1) {
          const sample = Math.max(-1, Math.min(1, input[i]));
          int16[i] = sample < 0 ? sample * 32768 : sample * 32767;
        }

        this.worker.process(int16).catch((error) => {
          this.emitDebug("cheetah-process-failed", { error: String(error) });
          onError?.({ reason: "process-failed", error });
        });
      };

      this.sourceNode.connect(this.processorNode);
      this.processorNode.connect(this.audioContext.destination);
      this.started = true;
      this.emitDebug("cheetah-started");
      onReady?.();
      return { ok: true };
    } catch (error) {
      this.emitDebug("cheetah-start-failed", { error: String(error) });
      this.stop();
      return { ok: false, reason: "start-failed", error };
    }
  }

  stop() {
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

    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.worker) {
      this.worker.release().catch(() => {});
      this.worker = null;
    }

    this.emitDebug("cheetah-stop");
  }
}
