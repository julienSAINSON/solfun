export class ContinuousReadingSession {
  constructor(notes = []) {
    this.notes = Array.isArray(notes) ? notes : [];
    this.states = this.notes.map(() => "pending");
    this.currentIndex = 0;
    this.processedCount = 0;
    this.correctCount = 0;
    this.incorrectCount = 0;
  }

  isFinished() {
    return this.processedCount >= this.notes.length;
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
    this.processedCount += 1;

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

  getNoteAt(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.notes.length) {
      return null;
    }

    return this.notes[index];
  }

  markRecognizedAtIndex(index, recognizedLabel) {
    if (this.isFinished()) {
      return null;
    }

    if (!Number.isInteger(index) || index < 0 || index >= this.notes.length) {
      return null;
    }

    if (this.states[index] !== "pending") {
      return null;
    }

    const expected = this.notes[index];
    const expectedLabel = String(expected?.label ?? "").toUpperCase();
    const actualLabel = String(recognizedLabel ?? "").toUpperCase();
    const isCorrect = expectedLabel === actualLabel;

    this.states[index] = isCorrect ? "correct" : "incorrect";
    if (isCorrect) {
      this.correctCount += 1;
    } else {
      this.incorrectCount += 1;
    }
    this.processedCount += 1;

    return {
      processedIndex: index,
      expectedLabel,
      actualLabel,
      isCorrect,
      isFinished: this.isFinished(),
    };
  }

  markTimeoutAtIndex(index) {
    if (this.isFinished()) {
      return null;
    }

    if (!Number.isInteger(index) || index < 0 || index >= this.notes.length) {
      return null;
    }

    if (this.states[index] !== "pending") {
      return null;
    }

    const expected = this.notes[index];
    const expectedLabel = String(expected?.label ?? "").toUpperCase();
    this.states[index] = "incorrect";
    this.incorrectCount += 1;
    this.processedCount += 1;

    return {
      processedIndex: index,
      expectedLabel,
      actualLabel: "",
      isCorrect: false,
      isFinished: this.isFinished(),
    };
  }

  setCurrentIndex(index) {
    if (!Number.isInteger(index)) {
      return;
    }

    this.currentIndex = Math.max(0, Math.min(index, this.notes.length));
  }

  getProcessedCount() {
    return this.processedCount;
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
