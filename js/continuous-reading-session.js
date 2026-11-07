export class ContinuousReadingSession {
  constructor(notes = []) {
    this.notes = Array.isArray(notes) ? notes : [];
    this.states = this.notes.map(() => "pending");
    this.currentIndex = 0;
    this.correctCount = 0;
    this.incorrectCount = 0;
  }

  isFinished() {
    return this.currentIndex >= this.notes.length;
  }

  getExpectedNote() {
    if (this.isFinished()) {
      return null;
    }

    return this.notes[this.currentIndex];
  }

  consumeRecognizedNote(recognizedLabel) {
    if (this.isFinished()) {
      return null;
    }

    const expected = this.getExpectedNote();
    const expectedLabel = String(expected?.label ?? "").toUpperCase();
    const actualLabel = String(recognizedLabel ?? "").toUpperCase();
    const isCorrect = expectedLabel === actualLabel;

    this.states[this.currentIndex] = isCorrect ? "correct" : "incorrect";
    if (isCorrect) {
      this.correctCount += 1;
    } else {
      this.incorrectCount += 1;
    }

    const processedIndex = this.currentIndex;
    this.currentIndex += 1;

    return {
      processedIndex,
      expectedLabel,
      actualLabel,
      isCorrect,
      isFinished: this.isFinished(),
    };
  }

  getProcessedCount() {
    return this.currentIndex;
  }

  getTotalCount() {
    return this.notes.length;
  }

  getSuccessRate() {
    if (this.notes.length === 0) {
      return 0;
    }

    return Math.round((this.correctCount / this.notes.length) * 100);
  }
}
