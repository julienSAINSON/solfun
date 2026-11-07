const NOTE_LABELS = ["DO", "RE", "MI", "FA", "SOL", "LA", "SI"];
const NOTE_ALIASES = {
  DO: ["do", "ut"],
  RE: ["re"],
  MI: ["mi"],
  FA: ["fa"],
  SOL: ["sol"],
  LA: ["la"],
  SI: ["si"],
};

function diatonicIndexFromPitch(noteName, octave) {
  const noteOrder = ["C", "D", "E", "F", "G", "A", "B"];
  const step = noteOrder.indexOf(noteName);
  return octave * 7 + step;
}

function labelFromNoteName(noteName) {
  const map = {
    C: "DO",
    D: "RE",
    E: "MI",
    F: "FA",
    G: "SOL",
    A: "LA",
    B: "SI",
  };
  return map[noteName] ?? "DO";
}

function createClefNote(noteName, octave, clef, referenceBottomLine) {
  const id = `${noteName}${octave}`;
  const label = labelFromNoteName(noteName);
  const aliases = NOTE_ALIASES[label] ?? [];
  const stepFromBottomLine = diatonicIndexFromPitch(noteName, octave) - referenceBottomLine;

  return {
    id,
    label,
    stepFromBottomLine,
    aliases,
    clef,
  };
}

function buildClefNotes({ clef, minOctave, maxOctave, referenceBottomLine }) {
  const noteOrder = ["C", "D", "E", "F", "G", "A", "B"];
  const notes = [];

  for (let octave = minOctave; octave <= maxOctave; octave += 1) {
    noteOrder.forEach((noteName) => {
      notes.push(createClefNote(noteName, octave, clef, referenceBottomLine));
    });
  }

  return notes;
}

const TREBLE_BOTTOM_LINE_REFERENCE = diatonicIndexFromPitch("E", 4);
const BASS_BOTTOM_LINE_REFERENCE = diatonicIndexFromPitch("G", 2);

const TREBLE_NOTES = buildClefNotes({
  clef: "treble",
  minOctave: 3,
  maxOctave: 5,
  referenceBottomLine: TREBLE_BOTTOM_LINE_REFERENCE,
});

const BASS_NOTES = buildClefNotes({
  clef: "bass",
  minOctave: 1,
  maxOctave: 4,
  referenceBottomLine: BASS_BOTTOM_LINE_REFERENCE,
});

function pickRandomNote(pool) {
  return pool[Math.floor(Math.random() * pool.length)];
}

export function generateRoundNotes(count = 10, pool = TREBLE_NOTES) {
  const notes = [];

  for (let index = 0; index < count; index += 1) {
    let candidate = pickRandomNote(pool);

    if (pool.length > 1 && notes.length > 0) {
      while (candidate.id === notes[notes.length - 1].id) {
        candidate = pickRandomNote(pool);
      }
    }

    notes.push(candidate);
  }

  return notes;
}

export { TREBLE_NOTES, BASS_NOTES, NOTE_LABELS };
