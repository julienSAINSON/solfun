const TREBLE_NOTES = [
  {
    id: "C3",
    label: "DO",
    stepFromBottomLine: -9,
    aliases: ["do", "ut"],
  },
  {
    id: "D3",
    label: "RE",
    stepFromBottomLine: -8,
    aliases: ["re", "re"],
  },
  {
    id: "E3",
    label: "MI",
    stepFromBottomLine: -7,
    aliases: ["mi"],
  },
  {
    id: "F3",
    label: "FA",
    stepFromBottomLine: -6,
    aliases: ["fa"],
  },
  {
    id: "G3",
    label: "SOL",
    stepFromBottomLine: -5,
    aliases: ["sol"],
  },
  {
    id: "A3",
    label: "LA",
    stepFromBottomLine: -4,
    aliases: ["la"],
  },
  {
    id: "B3",
    label: "SI",
    stepFromBottomLine: -3,
    aliases: ["si"],
  },
  {
    id: "C4",
    label: "DO",
    stepFromBottomLine: -2,
    aliases: ["do", "ut"],
  },
  {
    id: "D4",
    label: "RE",
    stepFromBottomLine: -1,
    aliases: ["re", "re"],
  },
  {
    id: "E4",
    label: "MI",
    stepFromBottomLine: 0,
    aliases: ["mi"],
  },
  {
    id: "F4",
    label: "FA",
    stepFromBottomLine: 1,
    aliases: ["fa"],
  },
  {
    id: "G4",
    label: "SOL",
    stepFromBottomLine: 2,
    aliases: ["sol"],
  },
  {
    id: "A4",
    label: "LA",
    stepFromBottomLine: 3,
    aliases: ["la"],
  },
  {
    id: "B4",
    label: "SI",
    stepFromBottomLine: 4,
    aliases: ["si"],
  },
  {
    id: "C5",
    label: "DO",
    stepFromBottomLine: 5,
    aliases: ["do", "ut"],
  },
  {
    id: "D5",
    label: "RE",
    stepFromBottomLine: 6,
    aliases: ["re", "re"],
  },
  {
    id: "E5",
    label: "MI",
    stepFromBottomLine: 7,
    aliases: ["mi"],
  },
  {
    id: "F5",
    label: "FA",
    stepFromBottomLine: 8,
    aliases: ["fa"],
  },
  {
    id: "G5",
    label: "SOL",
    stepFromBottomLine: 9,
    aliases: ["sol"],
  },
  {
    id: "A5",
    label: "LA",
    stepFromBottomLine: 10,
    aliases: ["la"],
  },
  {
    id: "B5",
    label: "SI",
    stepFromBottomLine: 11,
    aliases: ["si"],
  },
];

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

export { TREBLE_NOTES };
