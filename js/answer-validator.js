import { matchExpectedNoteFromRecognition, normalizeSpeechText } from "./voice-note-matcher.js";

export function validateAnswer(rawText, expectedNote) {
  const match = matchExpectedNoteFromRecognition(rawText, expectedNote);

  if (match.status === "unusable") {
    return {
      status: "unusable",
      normalized: "",
      match,
    };
  }

  return {
    status: match.status,
    normalized: normalizeSpeechText(match.bestTranscript ?? ""),
    match,
  };
}

export { normalizeSpeechText as normalizeText };
