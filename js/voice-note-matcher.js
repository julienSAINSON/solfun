const NOTE_ALIAS_MAP = {
  DO: ["do", "ut"],
  RE: ["re", "ré", "rai", "ray", "rhe"],
  MI: ["mi", "me"],
  FA: ["fa"],
  SOL: ["sol"],
  LA: ["la"],
  SI: ["si"],
};

const NOTE_KEYS = Object.keys(NOTE_ALIAS_MAP);
const NON_AMBIGUOUS_NOTE_KEYS = NOTE_KEYS.filter((key) => key !== "LA");

function normalizeSpeechText(input) {
  if (typeof input !== "string") {
    return "";
  }

  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’`]/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getExpectedNoteKey(expectedNote) {
  const rawLabel = String(expectedNote?.label ?? "").toUpperCase();
  const normalizedLabel = normalizeSpeechText(rawLabel).toUpperCase();

  if (NOTE_ALIAS_MAP[rawLabel]) {
    return rawLabel;
  }

  if (NOTE_ALIAS_MAP[normalizedLabel]) {
    return normalizedLabel;
  }

  return "";
}

function getExpectedAliases(expectedNote) {
  const expectedKey = getExpectedNoteKey(expectedNote);
  const aliasesFromKey = NOTE_ALIAS_MAP[expectedKey] ?? [];
  const aliasesFromNote = Array.isArray(expectedNote?.aliases)
    ? expectedNote.aliases.map((alias) => normalizeSpeechText(alias)).filter(Boolean)
    : [];

  return {
    expectedKey,
    aliases: Array.from(new Set([...aliasesFromKey, ...aliasesFromNote])),
  };
}

function parseRecognitionAlternatives(recognitionInput) {
  if (typeof recognitionInput === "string") {
    const text = recognitionInput.trim();
    return text ? [{ text, confidence: null, rank: 1 }] : [];
  }

  if (!recognitionInput || typeof recognitionInput !== "object") {
    return [];
  }

  const merged = [];

  if (typeof recognitionInput.text === "string" && recognitionInput.text.trim()) {
    merged.push({ text: recognitionInput.text.trim(), confidence: null, rank: 1 });
  }

  if (Array.isArray(recognitionInput.alternatives)) {
    recognitionInput.alternatives.forEach((alt, index) => {
      const text = typeof alt?.text === "string" ? alt.text.trim() : "";
      if (!text) {
        return;
      }

      merged.push({
        text,
        confidence: typeof alt?.confidence === "number" ? alt.confidence : null,
        rank: Number.isFinite(alt?.rank) ? alt.rank : index + 1,
      });
    });
  }

  const seen = new Set();
  return merged.filter((item) => {
    const key = normalizeSpeechText(item.text);
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function buildAliasLookup() {
  const lookup = new Map();

  NOTE_KEYS.forEach((noteKey) => {
    const aliases = NOTE_ALIAS_MAP[noteKey] ?? [];
    aliases.forEach((alias) => {
      lookup.set(normalizeSpeechText(alias), noteKey);
    });
  });

  return lookup;
}

const ALIAS_LOOKUP = buildAliasLookup();

export function extractNoteTokensFromText(rawText) {
  const normalized = normalizeSpeechText(rawText);
  if (!normalized) {
    return [];
  }

  return normalized
    .split(" ")
    .map((word) => ALIAS_LOOKUP.get(word) ?? null)
    .filter(Boolean);
}

export function extractBestNoteTokenSequence(recognitionInput) {
  const alternatives = parseRecognitionAlternatives(recognitionInput);

  if (alternatives.length === 0) {
    return {
      tokens: [],
      usedAlternative: null,
      tokenizedAlternatives: [],
    };
  }

  const tokenizedAlternatives = alternatives.map((alt) => ({
    ...alt,
    tokens: extractNoteTokensFromText(alt.text),
  }));

  const usedAlternative = tokenizedAlternatives.find((alt) => alt.tokens.length > 0) ?? null;

  return {
    tokens: usedAlternative?.tokens ?? [],
    usedAlternative,
    tokenizedAlternatives,
  };
}

function extractConflictingNotes(tokens, expectedKey) {
  const conflicts = [];

  NON_AMBIGUOUS_NOTE_KEYS.forEach((noteKey) => {
    if (noteKey === expectedKey) {
      return;
    }

    const aliases = NOTE_ALIAS_MAP[noteKey];
    if (aliases.some((alias) => tokens.includes(alias))) {
      conflicts.push(noteKey);
    }
  });

  return conflicts;
}

function evaluateCandidateText(rawText, expectedKey, expectedAliases) {
  const normalized = normalizeSpeechText(rawText);
  const tokens = normalized ? normalized.split(" ") : [];

  if (!normalized || tokens.length === 0) {
    return {
      rawText,
      normalized,
      accepted: false,
      reason: "empty",
      tokens,
      conflicts: [],
    };
  }

  const hasExpectedAlias = expectedAliases.some((alias) => tokens.includes(alias));
  if (!hasExpectedAlias) {
    return {
      rawText,
      normalized,
      accepted: false,
      reason: "missing-expected-note",
      tokens,
      conflicts: [],
    };
  }

  const conflicts = extractConflictingNotes(tokens, expectedKey);
  if (conflicts.length > 0) {
    return {
      rawText,
      normalized,
      accepted: false,
      reason: "contains-other-note",
      tokens,
      conflicts,
    };
  }

  return {
    rawText,
    normalized,
    accepted: true,
    reason: "matched-expected-note",
    tokens,
    conflicts: [],
  };
}

export function matchExpectedNoteFromRecognition(recognitionInput, expectedNote) {
  const { expectedKey, aliases } = getExpectedAliases(expectedNote);

  if (!expectedKey || aliases.length === 0) {
    return {
      status: "incorrect",
      matched: false,
      expectedKey,
      bestTranscript: "",
      alternatives: [],
      evaluations: [],
      reason: "invalid-expected-note",
    };
  }

  const alternatives = parseRecognitionAlternatives(recognitionInput);
  if (alternatives.length === 0) {
    return {
      status: "unusable",
      matched: false,
      expectedKey,
      bestTranscript: "",
      alternatives: [],
      evaluations: [],
      reason: "no-usable-transcript",
    };
  }

  const evaluations = alternatives.map((alt) => ({
    ...alt,
    ...evaluateCandidateText(alt.text, expectedKey, aliases),
  }));

  const acceptedEvaluation = evaluations.find((item) => item.accepted);

  return {
    status: acceptedEvaluation ? "correct" : "incorrect",
    matched: Boolean(acceptedEvaluation),
    expectedKey,
    bestTranscript: alternatives[0]?.text ?? "",
    alternatives,
    evaluations,
    acceptedEvaluation: acceptedEvaluation ?? null,
    reason: acceptedEvaluation ? "matched" : "no-candidate-matched",
  };
}

export { normalizeSpeechText, parseRecognitionAlternatives, NOTE_ALIAS_MAP };