export class SpeechRecognitionService {
  constructor(language = "fr-FR") {
    const RecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.language = language;
    this.RecognitionClass = RecognitionClass;
    this.recognition = null;
    this.isActive = false;
    this.debugHandler = null;
    this.capabilities = null;
    this.continuousSession = null;
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
      ...payload,
    });
  }

  isSupported() {
    return Boolean(this.RecognitionClass);
  }

  getCapabilities() {
    if (this.capabilities) {
      return this.capabilities;
    }

    if (!this.isSupported()) {
      this.capabilities = {
        supported: false,
        implementation: "none",
        supportsPhrases: false,
        supportsSpeechGrammarList: Boolean(window.SpeechGrammarList || window.webkitSpeechGrammarList),
        navigatorLanguage: navigator.language || "unknown",
      };
      return this.capabilities;
    }

    let supportsPhrases = false;
    let supportsMaxAlternatives = false;

    try {
      const probe = new this.RecognitionClass();
      supportsPhrases = "phrases" in probe;
      supportsMaxAlternatives = "maxAlternatives" in probe;
      if (typeof probe.abort === "function") {
        probe.abort();
      }
    } catch (error) {
      supportsPhrases = false;
      supportsMaxAlternatives = false;
    }

    this.capabilities = {
      supported: true,
      implementation: window.SpeechRecognition ? "SpeechRecognition" : "webkitSpeechRecognition",
      supportsPhrases,
      supportsMaxAlternatives,
      supportsSpeechGrammarList: Boolean(window.SpeechGrammarList || window.webkitSpeechGrammarList),
      navigatorLanguage: navigator.language || "unknown",
    };

    return this.capabilities;
  }

  stop() {
    if (this.continuousSession) {
      this.continuousSession.active = false;
      this.continuousSession = null;
    }

    if (this.recognition && this.isActive) {
      this.recognition.abort();
      this.emitDebug("abort-requested");
    }
    this.isActive = false;
  }

  async startOnce(options = {}) {
    if (!this.isSupported()) {
      return { ok: false, reason: "unsupported" };
    }

    if (this.isActive) {
      return { ok: false, reason: "busy" };
    }

    const recognition = new this.RecognitionClass();
    this.recognition = recognition;
    recognition.lang = this.language;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 5;

    const phraseHints = Array.isArray(options.phraseHints) ? options.phraseHints.filter((value) => typeof value === "string" && value.trim()) : [];
    const capabilities = this.getCapabilities();

    if (capabilities.supportsPhrases && phraseHints.length > 0) {
      try {
        recognition.phrases = phraseHints;
        this.emitDebug("phrases-applied", { phraseHints });
      } catch (error) {
        this.emitDebug("phrases-failed", { error: String(error) });
      }
    } else if (phraseHints.length > 0) {
      this.emitDebug("phrases-unsupported", {
        implementation: capabilities.implementation,
      });
    }

    this.isActive = true;

    return new Promise((resolve) => {
      let settled = false;

      const finish = (payload) => {
        if (settled) {
          return;
        }
        settled = true;
        this.isActive = false;
        this.emitDebug("finish", payload);
        resolve(payload);
      };

      recognition.onresult = (event) => {
        const result = event.results?.[event.resultIndex];
        const alternatives = [];

        if (result) {
          for (let index = 0; index < result.length; index += 1) {
            const alt = result[index];
            alternatives.push({
              rank: index + 1,
              text: alt?.transcript ?? "",
              confidence: typeof alt?.confidence === "number" ? alt.confidence : null,
            });
          }
        }

        const transcript = alternatives[0]?.text ?? "";
        const confidence = alternatives[0]?.confidence ?? null;
        const isFinal = Boolean(result?.isFinal);

        this.emitDebug(isFinal ? "result-final" : "result-interim", {
          text: transcript,
          confidence,
          alternatives,
        });

        if (isFinal) {
          finish({ ok: true, text: transcript, alternatives });
        }
      };

      recognition.onnomatch = () => {
        this.emitDebug("nomatch");
        finish({ ok: false, reason: "nomatch" });
      };

      recognition.onerror = (event) => {
        const knownReasons = {
          "no-speech": "no-speech",
          "audio-capture": "audio-capture",
          "not-allowed": "not-allowed",
          "service-not-allowed": "service-not-allowed",
          aborted: "aborted",
          network: "network",
        };

        const reason = knownReasons[event.error] ?? "error";
        this.emitDebug("error", { reason, rawError: event.error });
        finish({ ok: false, reason });
      };

      recognition.onend = () => {
        this.emitDebug("end");
        finish({ ok: false, reason: "ended-without-result" });
      };

      try {
        this.emitDebug("start", { lang: recognition.lang });
        this.emitDebug("capabilities", capabilities);
        recognition.start();
      } catch (error) {
        this.emitDebug("start-failed", { reason: "start-failed", error: String(error) });
        finish({ ok: false, reason: "start-failed", error });
      }
    });
  }

  startContinuous(options = {}) {
    if (!this.isSupported()) {
      return { ok: false, reason: "unsupported" };
    }

    if (this.isActive) {
      return { ok: false, reason: "busy" };
    }

    const recognition = new this.RecognitionClass();
    this.recognition = recognition;
    recognition.lang = this.language;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 5;

    const phraseHints = Array.isArray(options.phraseHints) ? options.phraseHints.filter((value) => typeof value === "string" && value.trim()) : [];
    const capabilities = this.getCapabilities();

    if (capabilities.supportsPhrases && phraseHints.length > 0) {
      try {
        recognition.phrases = phraseHints;
        this.emitDebug("phrases-applied", { phraseHints });
      } catch (error) {
        this.emitDebug("phrases-failed", { error: String(error) });
      }
    } else if (phraseHints.length > 0) {
      this.emitDebug("phrases-unsupported", {
        implementation: capabilities.implementation,
      });
    }

    const session = {
      active: true,
      restartToken: 0,
      hasAnnouncedReady: false,
    };

    this.continuousSession = session;
    this.isActive = true;

    recognition.onresult = (event) => {
      if (!session.active) {
        return;
      }

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const alternatives = [];

        for (let altIndex = 0; altIndex < result.length; altIndex += 1) {
          const alt = result[altIndex];
          alternatives.push({
            rank: altIndex + 1,
            text: alt?.transcript ?? "",
            confidence: typeof alt?.confidence === "number" ? alt.confidence : null,
          });
        }

        const payload = {
          chunkId: `${Date.now()}-${index}-${result.isFinal ? "F" : "I"}`,
          resultIndex: index,
          isFinal: Boolean(result.isFinal),
          text: alternatives[0]?.text ?? "",
          alternatives,
        };

        this.emitDebug(payload.isFinal ? "result-final" : "result-interim", payload);
        options.onChunk?.(payload);
      }
    };

    recognition.onerror = (event) => {
      const knownReasons = {
        "no-speech": "no-speech",
        "audio-capture": "audio-capture",
        "not-allowed": "not-allowed",
        "service-not-allowed": "service-not-allowed",
        aborted: "aborted",
        network: "network",
      };

      const reason = knownReasons[event.error] ?? "error";
      this.emitDebug("error", { reason, rawError: event.error });
      options.onError?.({ reason, rawError: event.error });

      if (["not-allowed", "service-not-allowed", "audio-capture"].includes(reason)) {
        session.active = false;
        this.continuousSession = null;
        this.isActive = false;
      }
    };

    recognition.onend = () => {
      this.emitDebug("end");

      if (!session.active) {
        this.isActive = false;
        return;
      }

      const restartToken = session.restartToken + 1;
      session.restartToken = restartToken;

      window.setTimeout(() => {
        if (!session.active || !this.continuousSession || this.continuousSession.restartToken !== restartToken) {
          return;
        }

        try {
          recognition.start();
          session.hasAnnouncedReady = false;
          this.emitDebug("continuous-restart");
        } catch (error) {
          this.emitDebug("continuous-restart-failed", { error: String(error) });
          session.active = false;
          this.continuousSession = null;
          this.isActive = false;
          options.onError?.({ reason: "restart-failed", rawError: String(error) });
        }
      }, 120);
    };

    recognition.onstart = () => {
      if (!session.active) {
        return;
      }

      if (!session.hasAnnouncedReady) {
        session.hasAnnouncedReady = true;
        options.onReady?.();
      }
    };

    try {
      this.emitDebug("start", { lang: recognition.lang });
      this.emitDebug("capabilities", capabilities);
      recognition.start();
      return { ok: true };
    } catch (error) {
      session.active = false;
      this.continuousSession = null;
      this.isActive = false;
      this.emitDebug("start-failed", { reason: "start-failed", error: String(error) });
      return { ok: false, reason: "start-failed", error };
    }
  }
}
