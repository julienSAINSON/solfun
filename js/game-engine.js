import { generateRoundNotes } from "./note-generator.js";
import { validateAnswer } from "./answer-validator.js";

const SUCCESS_MESSAGES = ["Bravo !", "Super !", "Bien joue !", "Tu es un champion !"];

const RETRY_MESSAGES = [
  "Presque ! Reessaie.",
  "Belle tentative, on recommence.",
  "Tu vas y arriver !",
  "Encore un petit effort !",
];

function pickRandomMessage(messages) {
  return messages[Math.floor(Math.random() * messages.length)];
}

export class GameEngine {
  constructor({ totalRounds = 10, onRoundChange, onFeedback, onScoreChange, onGameEnd, onNeedStopListening }) {
    this.totalRounds = totalRounds;
    this.onRoundChange = onRoundChange;
    this.onFeedback = onFeedback;
    this.onScoreChange = onScoreChange;
    this.onGameEnd = onGameEnd;
    this.onNeedStopListening = onNeedStopListening;

    this.notes = [];
    this.currentRound = 0;
    this.score = 0;
    this.correctAnswers = 0;
    this.isLocked = false;
    this.isRunning = false;
  }

  start() {
    this.notes = generateRoundNotes(this.totalRounds);
    this.currentRound = 0;
    this.score = 0;
    this.correctAnswers = 0;
    this.isLocked = false;
    this.isRunning = true;

    this.emitScore();
    this.emitRound();
  }

  canAnswer() {
    return this.isRunning && !this.isLocked;
  }

  getCurrentNote() {
    return this.notes[this.currentRound];
  }

  submitAnswer(answerText) {
    if (!this.canAnswer()) {
      return;
    }

    const expectedNote = this.getCurrentNote();
    const verdict = validateAnswer(answerText, expectedNote);

    if (verdict.status === "unusable") {
      this.onFeedback?.("Je n'ai pas bien entendu. Reessaie.", "neutral");
      return;
    }

    if (verdict.status === "incorrect") {
      this.onFeedback?.(pickRandomMessage(RETRY_MESSAGES), "error");
      return;
    }

    this.isLocked = true;
    this.score += 1;
    this.correctAnswers += 1;
    this.emitScore();
    this.onFeedback?.(pickRandomMessage(SUCCESS_MESSAGES), "success");

    window.setTimeout(() => {
      this.advanceRound();
    }, 900);
  }

  advanceRound() {
    this.onNeedStopListening?.();
    this.currentRound += 1;
    this.isLocked = false;

    if (this.currentRound >= this.totalRounds) {
      this.finishGame();
      return;
    }

    this.emitRound();
  }

  emitRound() {
    this.onRoundChange?.({
      roundNumber: this.currentRound + 1,
      totalRounds: this.totalRounds,
      note: this.getCurrentNote(),
    });
  }

  emitScore() {
    this.onScoreChange?.({
      score: this.score,
    });
  }

  finishGame() {
    this.isRunning = false;
    const successRate = Math.round((this.correctAnswers / this.totalRounds) * 100);

    this.onGameEnd?.({
      score: this.score,
      correctAnswers: this.correctAnswers,
      totalRounds: this.totalRounds,
      successRate,
    });
  }
}
