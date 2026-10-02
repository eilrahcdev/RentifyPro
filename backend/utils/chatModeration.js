import fs from "fs";

const DATASET_URL = new URL("../data/rentifypro_profanity_dataset.csv", import.meta.url);
const FILTERED_ACTIONS = new Set(["block_and_flag", "warn_and_log"]);
const ACTION_PRIORITY = {
  allow_with_warning: 1,
  warn_and_log: 2,
  block_and_flag: 3,
};

const escapeRegex = (value = "") =>
  String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const parseCsvRow = (line = "") => {
  const values = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }

  values.push(value);
  return values;
};

const normalizeTerm = (value = "") => String(value || "").trim().toLocaleLowerCase();

const loadModerationEntries = () => {
  const csv = fs.readFileSync(DATASET_URL, "utf8").replace(/^\uFEFF/, "");
  const lines = csv.split(/\r?\n/).filter((line) => line.trim());
  const headers = parseCsvRow(lines.shift()).map((header) => header.trim());
  const entriesByTerm = new Map();

  for (const line of lines) {
    const values = parseCsvRow(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
    const action = String(row.action || "").trim().toLocaleLowerCase();
    if (!ACTION_PRIORITY[action]) continue;

    const terms = [row.word, ...String(row.variants || "").split("|")];
    for (const rawTerm of terms) {
      const term = String(rawTerm || "").trim();
      const key = normalizeTerm(term);
      if (!key) continue;

      const existing = entriesByTerm.get(key);
      if (existing && ACTION_PRIORITY[existing.action] >= ACTION_PRIORITY[action]) continue;

      entriesByTerm.set(key, {
        term,
        action,
        category: String(row.category || "").trim(),
        severity: String(row.severity || "").trim(),
        language: String(row.language || "").trim(),
      });
    }
  }

  return [...entriesByTerm.values()].sort((a, b) => b.term.length - a.term.length);
};

const MODERATION_ENTRIES = loadModerationEntries();
const FILTERED_ENTRIES = MODERATION_ENTRIES.filter((entry) => FILTERED_ACTIONS.has(entry.action));
const ENTRY_BY_TERM = new Map(FILTERED_ENTRIES.map((entry) => [normalizeTerm(entry.term), entry]));
const COMPACT_SCRIPT_PATTERN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

const buildModerationRegex = (entries, flags) => {
  const boundedAlternatives = entries
    .filter((entry) => !COMPACT_SCRIPT_PATTERN.test(entry.term))
    .map((entry) => escapeRegex(entry.term))
    .join("|");
  const compactAlternatives = entries
    .filter((entry) => COMPACT_SCRIPT_PATTERN.test(entry.term))
    .map((entry) => escapeRegex(entry.term))
    .join("|");
  if (!boundedAlternatives && !compactAlternatives) return /$a/;

  // Latin and other space-delimited scripts use Unicode-aware word edges to
  // avoid innocent substrings. CJK terms can occur naturally without spaces.
  const boundedSource = boundedAlternatives
    ? `(^|[^\\p{L}\\p{N}])(${boundedAlternatives})(?=[^\\p{L}\\p{N}]|$)`
    : "(?!)";
  const compactSource = compactAlternatives ? `(${compactAlternatives})` : "(?!)";
  return new RegExp(
    `${boundedSource}|${compactSource}`,
    flags
  );
};

const FILTER_PATTERN = buildModerationRegex(FILTERED_ENTRIES, "giu");
const DETECTION_PATTERN = buildModerationRegex(FILTERED_ENTRIES, "iu");
const LETTER_OR_NUMBER_PATTERN = /[\p{L}\p{N}]/u;

const maskTerm = (value = "") => {
  const characters = Array.from(String(value || ""));
  const visibleIndexes = characters
    .map((character, index) => (LETTER_OR_NUMBER_PATTERN.test(character) ? index : -1))
    .filter((index) => index >= 0);

  if (visibleIndexes.length <= 2) {
    return characters
      .map((character) => (LETTER_OR_NUMBER_PATTERN.test(character) ? "*" : character))
      .join("");
  }

  const firstIndex = visibleIndexes[0];
  const lastIndex = visibleIndexes[visibleIndexes.length - 1];
  return characters
    .map((character, index) => {
      if (!LETTER_OR_NUMBER_PATTERN.test(character)) return character;
      return index === firstIndex || index === lastIndex ? character : "*";
    })
    .join("");
};

export const containsModeratedContent = (input = "") =>
  DETECTION_PATTERN.test(String(input || ""));

export const getModerationMatches = (input = "") => {
  const matches = [];
  String(input || "").replace(FILTER_PATTERN, (_match, _prefix, boundedTerm, compactTerm) => {
    const matchedTerm = boundedTerm || compactTerm;
    const entry = ENTRY_BY_TERM.get(normalizeTerm(matchedTerm));
    if (entry) matches.push({ ...entry, matchedTerm });
    return _match;
  });
  return matches;
};

export const censorProfanityInText = (input = "") =>
  String(input || "").replace(
    FILTER_PATTERN,
    (_match, prefix = "", boundedTerm = "", compactTerm = "") =>
      `${prefix || ""}${maskTerm(boundedTerm || compactTerm)}`
  );

export const getModerationDatasetInfo = () => ({
  source: DATASET_URL.pathname,
  entryCount: MODERATION_ENTRIES.length,
  filteredEntryCount: FILTERED_ENTRIES.length,
});
