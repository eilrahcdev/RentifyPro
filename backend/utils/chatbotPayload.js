import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const chatbotServiceDir = path.resolve(repoRoot, "chatbot-service");

const SUPPORTED_LANGUAGES = new Set(["english", "filipino"]);
const DEFAULT_LANGUAGE = "english";
const LANGUAGE_CODE_BY_NAME = {
  english: "en",
  filipino: "fil",
};
const RECOMMENDATION_INTENTS = new Set([
  "available_vehicles",
  "available_transmission",
  "passenger_capacity",
]);
const CONVERSATIONAL_INTENTS = new Set([
  "chat_greeting",
  "chat_wellbeing",
  "chat_identity",
  "chat_capabilities",
  "chat_gratitude",
]);
const FALLBACK_REPLIES = {
  english:
    "Sorry, I'm not sure I understood. Please try asking about booking, rates, requirements, deposit, payment, insurance, or available vehicles.",
  filipino:
    "Paumanhin, hindi ko natukoy nang maayos ang tanong mo. Subukan mong magtanong tungkol sa booking, presyo, requirements, deposito, bayad, insurance, o available na sasakyan.",
};
const GREETING_PATTERNS = [
  /\bhello\b/i,
  /\bhi\b/i,
  /\bhey\b/i,
  /\bgood day\b/i,
  /\bgreetings?\b/i,
  /\bgood (morning|afternoon|evening)\b/i,
  /\bmagandang (umaga|hapon|gabi|araw)\b/i,
  /\bkamusta\b/i,
  /\bkumusta\b/i,
  /\bmusta\b/i,
  /\bhalo\b/i,
];
const SMALL_TALK_PATTERNS = [
  /\bjoke\b/i,
  /\btest(?:ing)?\b/i,
];
const DOMAIN_KEYWORD_PATTERNS = [
  /\bbook(?:ing)?\b/i,
  /\brent(?:al|a)?\b/i,
  /\breserve\b/i,
  /\bvehicle\b/i,
  /\bcar\b/i,
  /\bvan\b/i,
  /\bsuv\b/i,
  /\bpick[\s-]?up\b/i,
  /\bsedan\b/i,
  /\btransmission\b/i,
  /\bautomatic\b/i,
  /\bmanual\b/i,
  /\bpassengers?\b/i,
  /\bpax\b/i,
  /\bseats?\b/i,
  /\binsurance\b/i,
  /\bdeposit\b/i,
  /\bpayment\b/i,
  /\bgcash\b/i,
  /\bbank transfer\b/i,
  /\bcash\b/i,
  /\brequirements?\b/i,
  /\bvalid id\b/i,
  /\bproof of address\b/i,
  /\bage\b/i,
  /\bfull tank\b/i,
  /\bsame day\b/i,
  /\bdiscount\b/i,
  /\bavailable\b/i,
  /\bavailability\b/i,
  /\bmag-book\b/i,
  /\bpaano mag-book\b/i,
  /\brenta\b/i,
  /\bsasakyan\b/i,
  /\bpasahero\b/i,
  /\bpresyo\b/i,
  /\bbayad\b/i,
  /\bdeposito\b/i,
  /\bkinakailangan\b/i,
  /\bkailangan\b/i,
  /\bberipikasyon\b/i,
  /\bpatunay ng tirahan\b/i,
  /\bedad\b/i,
  /\bfull tank\b/i,
  /\bparehong araw\b/i,
  /\bdiscounto?\b/i,
  /\bavailable\b/i,
];
const FILIPINO_MARKER_PATTERNS = [
  /\bmagkano\b/i,
  /\bano\b/i,
  /\banong\b/i,
  /\bpaano\b/i,
  /\bkailangan\b/i,
  /\bpwede\b/i,
  /\bilang\b/i,
  /\bpasahero\b/i,
  /\bsasakyan\b/i,
  /\brenta\b/i,
  /\bpresyo\b/i,
  /\bbayad\b/i,
  /\bdeposito\b/i,
  /\bdiskwento\b/i,
  /\bberipikasyon\b/i,
  /\bpatunay ng tirahan\b/i,
  /\bhanap\b/i,
  /\bmeron\b/i,
  /\bmay\b/i,
];

const INTENT_PATTERNS = {
  chat_greeting: [
    /\bhello\b/i,
    /\bhi\b/i,
    /\bhey\b/i,
    /\bgood (morning|afternoon|evening|day)\b/i,
    /\bgreetings?\b/i,
    /\bwhat'?s up\b/i,
    /\bkamusta\b/i,
    /\bkumusta\b/i,
    /\bmusta\b/i,
    /\bmagandang (umaga|hapon|gabi|araw)\b/i,
  ],
  chat_wellbeing: [
    /\bhow are you\b/i,
    /\bhow are you doing\b/i,
    /\bhow'?s it going\b/i,
    /\bkamusta ka\b/i,
    /\bkumusta ka\b/i,
    /\bokay ka ba\b/i,
  ],
  chat_identity: [
    /\bwho are you\b/i,
    /\bwhat are you\b/i,
    /\bsino ka\b/i,
    /\bikaw ba si rentifypro ai\b/i,
  ],
  chat_capabilities: [
    /\bwhat can you do\b/i,
    /\bhow can you help\b/i,
    /\bwhat can i ask\b/i,
    /\bwhat do you do\b/i,
    /\bano ang maitutulong mo\b/i,
    /\bano ang pwede mong itulong\b/i,
    /\bpaano ka makakatulong\b/i,
    /\bano ang kaya mong gawin\b/i,
  ],
  chat_gratitude: [
    /\bthank you\b/i,
    /\bthanks\b/i,
    /\bthank you so much\b/i,
    /\bsalamat\b/i,
    /\bmaraming salamat\b/i,
  ],
  rental_rate: [
    /\bhow much\b/i,
    /\bhow much.*rent(?:al)?\b/i,
    /\bprice\b/i,
    /\brate\b/i,
    /\brental cost\b/i,
    /\bper day\b/i,
    /\bper hour\b/i,
    /\bmagkano\b/i,
    /\bmagkano.*rent(?:a|al)?\b/i,
    /\bpresyo\b/i,
    /\brenta\b/i,
    /\bharaw\b/i,
    /\boras\b/i,
  ],
  insurance_included: [
    /\binsurance\b/i,
    /\binsured\b/i,
  ],
  security_deposit: [
    /\bsecurity deposit\b/i,
    /\bdeposit\b/i,
    /\brefundable deposit\b/i,
    /\bdeposit.*magkano\b/i,
    /\bmay .*deposit\b/i,
    /\bdeposito\b/i,
  ],
  payment_methods: [
    /\bpayment methods?\b/i,
    /\bpayment\b/i,
    /\bhow can i pay\b/i,
    /\bmode of payment\b/i,
    /\bpay\b/i,
    /\bgcash\b/i,
    /\bbank transfer\b/i,
    /\bcash\b/i,
    /\bparaan ng bayad\b/i,
    /\bparaan ng pagbabayad\b/i,
    /\bbayad\b/i,
  ],
  rental_requirements: [
    /\brequirements?\b/i,
    /\bneeded to rent\b/i,
    /\bneed(?:ed)? .*rent\b/i,
    /\brent a car\b/i,
    /\bkinakailangan\b/i,
    /\bkailangan .*rent\b/i,
    /\bkailangan para makapag-renta\b/i,
  ],
  minimum_age: [
    /\bminimum age\b/i,
    /\bage requirement\b/i,
    /\bhow old\b/i,
    /\bedad\b/i,
    /\bilang taon\b/i,
  ],
  id_or_proof_of_address: [
    /\bvalid id\b/i,
    /\bproof of address\b/i,
    /\bneed (an )?id\b/i,
    /\bneed\b.*\bid\b/i,
    /\bid\b.*\bkailangan\b/i,
    /\bkailangan\b.*\bid\b/i,
    /\bneed ba ng id\b/i,
    /\bkailangan ba ng id\b/i,
    /\bpatunay ng tirahan\b/i,
  ],
  available_vehicles: [
    /\bavailable vehicles?\b/i,
    /\bwhat vehicles are available\b/i,
    /\bwhat cars are available\b/i,
    /\brecommend (a )?(vehicle|car|van|suv|pickup)\b/i,
    /\blooking for\b.*\b(vehicle|car|van|suv|pickup)\b/i,
    /\bneed\b.*\b(car|van|suv|pickup|vehicle)\b/i,
    /\bmay\b.*\b(car|van|suv|pickup|sedan|kotse)\b/i,
    /\bmeron bang\b.*\b(car|van|suv|pickup|sedan|kotse)\b/i,
    /\bhanap\b.*\b(sasakyan|kotse|van|suv|pickup)\b/i,
    /\banong mga sasakyan ang available\b/i,
    /\banong sasakyan\b/i,
    /\bavailable ba\b/i,
  ],
  available_transmission: [
    /\btransmission\b/i,
    /\bautomatic\b/i,
    /\bmanual\b/i,
    /\bautomatic ba\b/i,
    /\bmanual ba\b/i,
    /\bmay .*automatic\b/i,
    /\bmay .*manual\b/i,
    /\buri ng transmission\b/i,
  ],
  full_tank_return: [
    /\bfull tank\b/i,
    /\brefuel(?:ed)?\b/i,
    /\bibalik.*full tank\b/i,
  ],
  passenger_capacity: [
    /\bhow many passengers\b/i,
    /\bcapacity\b/i,
    /\bhow many people\b/i,
    /\bpassengers?\b/i,
    /\bgood for\b/i,
    /\bfor \d+\s*(pax|passengers|persons|people)\b/i,
    /\bpax\b/i,
    /\bpasahero\b/i,
    /\bkasya\b/i,
    /\bkayang isakay\b/i,
  ],
  choose_specific_model: [
    /\bspecific model\b/i,
    /\bparticular model\b/i,
    /\bchoose a specific\b/i,
    /\bpartikular na modelo\b/i,
    /\btiyak na modelo\b/i,
  ],
  how_to_book: [
    /\bhow do i book\b/i,
    /\bhow to book\b/i,
    /\bhow .*reserve\b/i,
    /\bbook(?:ing)? process\b/i,
    /\bbooking process\b/i,
    /\bpano mag-book\b/i,
    /\bpaano mag-book\b/i,
    /\bpaano mag book\b/i,
    /\bpaano mag reserve\b/i,
    /\bmag-book\b/i,
  ],
  same_day_rental: [
    /\bsame-day\b/i,
    /\bsame day\b/i,
    /\btoday rental\b/i,
    /\bbook today\b/i,
    /\brent today\b/i,
    /\bsame-day rental\b/i,
    /\bparehong araw\b/i,
  ],
  advance_booking_discount: [
    /\badvance booking discount\b/i,
    /\bearly booking discount\b/i,
    /\bdiscount.*advance booking\b/i,
    /\bmay.*discount.*advance booking\b/i,
    /\bdiscount ba sa advance booking\b/i,
  ],
};

const TEXT_REPLACEMENTS = [
  [/â‚±/g, "P"],
  [/₱/g, "P"],
  [/â€™/g, "'"],
  [/’/g, "'"],
  [/â€œ|â€|“|”/g, '"'],
  [/â€“|â€”|–|—/g, "-"],
];

let datasetCache = null;

function cleanText(value = "") {
  let text = String(value || "");
  for (const [pattern, replacement] of TEXT_REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

function normalizeText(value = "") {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLanguage(language) {
  const normalized = normalizeText(language);
  return SUPPORTED_LANGUAGES.has(normalized) ? normalized : DEFAULT_LANGUAGE;
}

function getLanguageCode(language) {
  return LANGUAGE_CODE_BY_NAME[normalizeLanguage(language)] || LANGUAGE_CODE_BY_NAME[DEFAULT_LANGUAGE];
}

function hasFilipinoMarkers(text = "") {
  return FILIPINO_MARKER_PATTERNS.some((pattern) => pattern.test(text));
}

function hasSignalSlots(slots = {}) {
  return Boolean(slots.type || slots.transmission || slots.pax || slots.budget);
}

function countMeaningfulTokens(message = "") {
  return normalizeText(message)
    .split(" ")
    .filter(Boolean).length;
}

function hasDomainKeywords(message = "") {
  return DOMAIN_KEYWORD_PATTERNS.some((pattern) => pattern.test(message));
}

function detectPreflightReject(message, hasHint, slots) {
  const tokenCount = countMeaningfulTokens(message);
  const hasDomainTerms = hasDomainKeywords(message) || hasHint || hasSignalSlots(slots);

  if (GREETING_PATTERNS.some((pattern) => pattern.test(message)) && !hasDomainTerms) {
    return "greeting";
  }

  if (SMALL_TALK_PATTERNS.some((pattern) => pattern.test(message)) && !hasDomainTerms) {
    return "small_talk";
  }

  if (!hasDomainTerms && tokenCount > 0 && tokenCount <= 2) {
    return "too_short_out_of_domain";
  }

  return "";
}

function hashString(value = "") {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function getDatasetPath() {
  const configured = String(process.env.CHATBOT_DATASET_PATH || "").trim();
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.resolve(chatbotServiceDir, configured);
  }

  const candidates = [
    path.resolve(chatbotServiceDir, "rentifypro_chatbot_dataset_v4.json"),
    path.resolve(chatbotServiceDir, "rentifypro_chatbot_dataset.json"),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function loadDataset() {
  const datasetPath = getDatasetPath();
  const datasetExists = fs.existsSync(datasetPath);
  const datasetMtimeMs = datasetExists ? fs.statSync(datasetPath).mtimeMs : -1;

  if (
    datasetCache &&
    datasetCache.datasetPath === datasetPath &&
    datasetCache.datasetMtimeMs === datasetMtimeMs
  ) {
    return datasetCache;
  }

  if (!datasetExists) {
    datasetCache = { datasetPath, datasetMtimeMs, intentsById: {} };
    return datasetCache;
  }

  const raw = JSON.parse(fs.readFileSync(datasetPath, "utf-8"));
  const items = Array.isArray(raw?.items) ? raw.items : [];
  const intentsById = {};

  for (const item of items) {
    const intentId = cleanText(item?.id);
    if (!intentId) continue;

    intentsById[intentId] = {
      english: {
        question: cleanText(item?.english?.question),
        answers: Array.isArray(item?.english?.answers)
          ? item.english.answers.map((answer) => cleanText(answer)).filter(Boolean)
          : [],
      },
      filipino: {
        question: cleanText(item?.filipino?.question),
        answers: Array.isArray(item?.filipino?.answers)
          ? item.filipino.answers.map((answer) => cleanText(answer)).filter(Boolean)
          : [],
      },
    };
  }

  datasetCache = { datasetPath, datasetMtimeMs, intentsById };
  return datasetCache;
}

function getCanonicalQuestion(intentId, language) {
  const { intentsById } = loadDataset();
  const record = intentsById[intentId];
  if (!record) return "";

  const preferredLanguage = normalizeLanguage(language);
  const question = cleanText(record[preferredLanguage]?.question);
  if (question) return question;

  const fallbackLanguage = preferredLanguage === "english" ? "filipino" : "english";
  return cleanText(record[fallbackLanguage]?.question);
}

function getIntentAnswers(intentId, language) {
  const { intentsById } = loadDataset();
  const record = intentsById[intentId];
  if (!record) return [];

  const preferredLanguage = normalizeLanguage(language);
  const primaryAnswers = Array.isArray(record[preferredLanguage]?.answers) ? record[preferredLanguage].answers : [];
  if (primaryAnswers.length > 0) {
    return primaryAnswers;
  }

  const fallbackLanguage = preferredLanguage === "english" ? "filipino" : "english";
  return Array.isArray(record[fallbackLanguage]?.answers) ? record[fallbackLanguage].answers : [];
}

function pickDatasetAnswer(intentId, language, seed = "") {
  const answers = getIntentAnswers(intentId, language);
  if (answers.length === 0) {
    return FALLBACK_REPLIES[normalizeLanguage(language)];
  }

  const index = hashString(`${intentId}:${normalizeLanguage(language)}:${seed}`) % answers.length;
  return cleanText(answers[index]);
}

function scoreIntentPatterns(message) {
  const scores = {};

  for (const [intentId, patterns] of Object.entries(INTENT_PATTERNS)) {
    let score = 0;
    for (const pattern of patterns) {
      if (pattern.test(message)) {
        score += 1;
      }
    }
    if (score > 0) {
      scores[intentId] = score;
    }
  }

  return scores;
}

function detectIntentHint(message) {
  const scores = scoreIntentPatterns(message);
  let bestIntentId = "";
  let bestScore = 0;

  for (const [intentId, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestIntentId = intentId;
      bestScore = score;
    }
  }

  return {
    intentId: bestIntentId,
    confidence: bestScore,
  };
}

function extractSlots(message) {
  const text = normalizeText(message);

  let pax = null;
  const paxMatch = text.match(/\b(\d{1,2})\s*(pax|passengers|persons|people|katao|tao|seats|seater)?\b/);
  if (paxMatch) {
    pax = Number(paxMatch[1]);
  }

  let transmission = "";
  if (/\b(automatic|auto|matic)\b/.test(text)) {
    transmission = "automatic";
  } else if (/\b(manual|stick)\b/.test(text)) {
    transmission = "manual";
  }

  let type = "";
  if (/\bsedan\b|\bcar\b|\bcars\b|\bkotse\b/.test(text)) {
    type = "sedan";
  } else if (/\bsuv\b/.test(text)) {
    type = "suv";
  } else if (/\bvan\b|\bminivan\b/.test(text)) {
    type = "van";
  } else if (/\bpick[\s-]?up\b|\btruck\b/.test(text)) {
    type = "pickup";
  }

  let budget = null;
  const budgetMatch =
    text.match(/(?:budget|under|below|max|maximum|hanggang|upto|up to|less than)\s*(?:php|p)?\s*([0-9]+(?:\.[0-9]+)?k?)/) ||
    text.match(/(?:php|p)\s*([0-9]+(?:\.[0-9]+)?k?)/);

  if (budgetMatch?.[1]) {
    const raw = budgetMatch[1].toLowerCase();
    const multiplier = raw.endsWith("k") ? 1000 : 1;
    const value = Number.parseFloat(raw.replace(/k$/, ""));
    if (Number.isFinite(value)) {
      budget = Math.round(value * multiplier);
    }
  }

  return { pax, transmission, type, budget };
}

function buildSlotSummary(slots, language) {
  const selectedLanguage = normalizeLanguage(language);
  const parts = [];

  if (slots.type) {
    parts.push(selectedLanguage === "filipino" ? `uri ng sasakyan: ${slots.type}` : `vehicle type: ${slots.type}`);
  }
  if (slots.transmission) {
    parts.push(selectedLanguage === "filipino" ? `transmission: ${slots.transmission}` : `transmission: ${slots.transmission}`);
  }
  if (slots.pax) {
    parts.push(selectedLanguage === "filipino" ? `pasahero: ${slots.pax}` : `passengers: ${slots.pax}`);
  }
  if (slots.budget) {
    parts.push(selectedLanguage === "filipino" ? `budget: PHP ${slots.budget}` : `budget: PHP ${slots.budget}`);
  }

  return parts.join(", ");
}

function normalizeVehicleType(value = "") {
  const normalized = normalizeText(value).replace("pick up", "pickup");
  if (!normalized) return "";
  if (normalized.includes("sedan") || normalized.includes("car") || normalized.includes("kotse")) return "sedan";
  if (normalized.includes("suv")) return "suv";
  if (normalized.includes("van")) return "van";
  if (normalized.includes("pickup") || normalized.includes("truck")) return "pickup";
  if (normalized.includes("motor")) return "motorcycle";
  return normalized;
}

function normalizeTransmission(value = "") {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  if (normalized.includes("automatic") || normalized.includes("auto") || normalized.includes("matic")) return "automatic";
  if (normalized.includes("manual") || normalized.includes("stick")) return "manual";
  return normalized;
}

function normalizeVehicleForChatbot(vehicle) {
  const specs = vehicle?.specs || {};
  const images = Array.isArray(vehicle?.images) ? vehicle.images : [];
  const imageUrl = cleanText(vehicle?.imageUrl || images[0] || "");

  return {
    _id: String(vehicle?._id || ""),
    name: cleanText(vehicle?.name) || "Unnamed vehicle",
    type: normalizeVehicleType(vehicle?.type || specs?.type || specs?.subType || ""),
    transmission: normalizeTransmission(vehicle?.transmission || specs?.transmission || ""),
    seats: Number(vehicle?.seats || specs?.seats || 0) || 0,
    dailyRate: Number(vehicle?.dailyRate || vehicle?.dailyRentalRate || 0) || 0,
    isAvailable: vehicle?.isAvailable ?? vehicle?.availabilityStatus === "available",
    location: cleanText(vehicle?.location || ""),
    imageUrl,
  };
}

function normalizeRecommendationList(recommendations = []) {
  return recommendations
    .map((vehicle) => normalizeVehicleForChatbot(vehicle))
    .filter((vehicle) => vehicle.name);
}

function filterVehiclesForChatbot(vehicles, slots) {
  const normalized = vehicles
    .map((vehicle) => normalizeVehicleForChatbot(vehicle))
    .filter((vehicle) => vehicle.isAvailable);
  const hasRequestedFilters = hasSignalSlots(slots);

  const strict = normalized.filter((vehicle) => {
    if (slots.type && vehicle.type !== slots.type) return false;
    if (slots.transmission && vehicle.transmission !== slots.transmission) return false;
    if (slots.pax && vehicle.seats < slots.pax) return false;
    if (slots.budget && vehicle.dailyRate > slots.budget) return false;
    return true;
  });

  const relaxed = normalized.filter((vehicle) => {
    if (slots.type && vehicle.type !== slots.type) return false;
    if (slots.transmission && vehicle.transmission !== slots.transmission) return false;
    if (slots.pax && vehicle.seats < Math.max(1, slots.pax - 2)) return false;
    if (slots.budget && vehicle.dailyRate > Math.round(slots.budget * 1.15)) return false;
    return true;
  });

  let chosen = normalized;
  if (strict.length > 0) {
    chosen = strict;
  } else if (relaxed.length > 0) {
    chosen = relaxed;
  } else if (hasRequestedFilters) {
    chosen = [];
  }

  return chosen.sort((a, b) => {
    if (slots.type) {
      const typeDiff = Number(b.type === slots.type) - Number(a.type === slots.type);
      if (typeDiff !== 0) return typeDiff;
    }
    if (slots.transmission) {
      const transmissionDiff =
        Number(b.transmission === slots.transmission) - Number(a.transmission === slots.transmission);
      if (transmissionDiff !== 0) return transmissionDiff;
    }
    if (slots.pax) {
      const seatDelta = Math.abs(a.seats - slots.pax) - Math.abs(b.seats - slots.pax);
      if (seatDelta !== 0) return seatDelta;
    }
    return a.dailyRate - b.dailyRate;
  });
}

export function buildChatbotPayload(message, language, vehicles = []) {
  const originalMessage = cleanText(message);
  const selectedLanguage = normalizeLanguage(language);
  const normalizedMessage = normalizeText(originalMessage);
  const slots = extractSlots(originalMessage);
  const patternHint = detectIntentHint(originalMessage);

  let hintIntentId = patternHint.intentId;
  let hintConfidence = patternHint.confidence;

  const hasVehicleRecommendationFilters = Boolean(
    slots.type || slots.pax || slots.budget || (slots.transmission && /\b(available|recommend|suggest|need|want|hanap)\b/i.test(originalMessage))
  );

  if (hasVehicleRecommendationFilters) {
    hintIntentId = "available_vehicles";
    hintConfidence = Math.max(hintConfidence, 2);
  } else if (!hintIntentId && slots.transmission) {
    hintIntentId = "available_transmission";
    hintConfidence = 1;
  } else if (!hintIntentId && slots.pax) {
    hintIntentId = "passenger_capacity";
    hintConfidence = 1;
  }

  const canonicalQuestion = hintIntentId ? getCanonicalQuestion(hintIntentId, selectedLanguage) : "";
  const slotSummary = buildSlotSummary(slots, selectedLanguage);
  const containsFilipino = hasFilipinoMarkers(originalMessage);
  const hasCanonicalQuestion = Boolean(canonicalQuestion);
  const tokenCount = countMeaningfulTokens(originalMessage);
  const domainKeywordsDetected = hasDomainKeywords(originalMessage);
  const preflightRejectReason = detectPreflightReject(originalMessage, Boolean(hintIntentId), slots);
  const shouldSuppressOriginalForEnglish =
    selectedLanguage === "english" && containsFilipino && (hasCanonicalQuestion || hasSignalSlots(slots));

  const filteredParts = [];
  if (hasCanonicalQuestion) {
    filteredParts.push(canonicalQuestion);
  }
  if (slotSummary && (hintIntentId || hasSignalSlots(slots))) {
    filteredParts.push(`${selectedLanguage === "filipino" ? "Mga detalye" : "Details"}: ${slotSummary}`);
  }
  if (!shouldSuppressOriginalForEnglish) {
    if (!hasCanonicalQuestion || normalizeText(canonicalQuestion) !== normalizedMessage) {
      filteredParts.push(originalMessage);
    }
  }

  let filteredMessage = filteredParts.filter(Boolean).join("\n").trim() || originalMessage;
  if (selectedLanguage === "filipino" && !/\b(tanong|pakisagot sa filipino)\b/i.test(filteredMessage)) {
    filteredMessage = `Pakisagot sa Filipino.\n${filteredMessage}`;
  }
  if (selectedLanguage === "english" && shouldSuppressOriginalForEnglish) {
    filteredMessage = `Please answer in English.\n${filteredMessage}`;
  }

  const filteredVehicles = filterVehiclesForChatbot(vehicles, slots);

  return {
    selectedLanguage,
    originalMessage,
    filteredMessage,
    slots,
    hintIntentId,
    hintConfidence,
    canonicalQuestion,
    tokenCount,
    hasDomainKeywords: domainKeywordsDetected,
    preflightRejectReason,
    vehicles: filteredVehicles,
  };
}

export function shouldRetryChatbotResponse(response, payload) {
  if (!response || typeof response !== "object") {
    return false;
  }

  const intent = response.intent || response.intent_id || "";
  const score = Number(response.score || 0);
  const hasHint = Boolean(payload.hintIntentId && payload.canonicalQuestion);
  const mismatch = hasHint && intent && intent !== "REJECT" && intent !== payload.hintIntentId;
  const weakScore = score < 0.62;
  const rejected = intent === "REJECT";
  const desiredReplyLang = getLanguageCode(payload.selectedLanguage);
  const replyLangMismatch = Boolean(response.reply_lang) && response.reply_lang !== desiredReplyLang;

  return hasHint && (rejected || mismatch || weakScore || replyLangMismatch);
}

export function buildRetryPayload(payload) {
  if (!payload.canonicalQuestion) {
    return payload.filteredMessage;
  }

  const details = [];
  if (payload.slots.type) details.push(`vehicle type ${payload.slots.type}`);
  if (payload.slots.transmission) details.push(`transmission ${payload.slots.transmission}`);
  if (payload.slots.pax) details.push(`passengers ${payload.slots.pax}`);
  if (payload.slots.budget) details.push(`budget ${payload.slots.budget}`);

  if (details.length === 0) {
    return payload.canonicalQuestion;
  }

  return `${payload.canonicalQuestion}\n${payload.originalMessage}\nFilters: ${details.join(", ")}`;
}

export function normalizeChatbotResponse(response) {
  if (!response || typeof response !== "object") {
    return {
      reply: "Chatbot returned an invalid response.",
      intent: "REJECT",
      score: 0,
      top_preds: [],
      recommendations: [],
    };
  }

  const intent = response.intent || response.intent_id || "REJECT";
  const topPreds = Array.isArray(response.top_preds) ? response.top_preds : [];
  const recommendations = normalizeRecommendationList(Array.isArray(response.recommendations) ? response.recommendations : []);

  return {
    ...response,
    intent,
    score: Number(response.score || 0),
    reply: cleanText(response.reply || ""),
    top_preds: topPreds,
    recommendations,
  };
}

export function buildRejectedChatbotResponse(language, reason = "fallback") {
  const selectedLanguage = normalizeLanguage(language);
  return {
    reply: FALLBACK_REPLIES[selectedLanguage],
    intent: "REJECT",
    intent_id: "REJECT",
    reply_lang: getLanguageCode(selectedLanguage),
    score: 0,
    top_preds: [],
    recommendations: [],
    reject_reason: reason,
  };
}

function shouldRejectLowSignalResponse(response, payload) {
  const topScore = Number(response.score || 0);
  const secondScore = Number(response.top_preds?.[1]?.score || 0);
  const scoreGap = topScore - secondScore;
  const noStrongHints = !payload.hintIntentId && !hasSignalSlots(payload.slots);
  const noDomainTerms = !payload.hasDomainKeywords;
  const shortMessage = payload.tokenCount <= 4;
  const ambiguous = topScore < 0.72 && scoreGap < 0.08;
  const weak = topScore < 0.68;

  if (payload.preflightRejectReason) {
    return true;
  }

  if (noStrongHints && noDomainTerms && (weak || ambiguous)) {
    return true;
  }

  if (noStrongHints && shortMessage && topScore < 0.62) {
    return true;
  }

  return false;
}

function shouldOverrideIntentWithHint(response, payload) {
  if (!payload.hintIntentId) {
    return false;
  }

  const intent = response.intent || "REJECT";
  const score = Number(response.score || 0);
  const hasVehicleFilters = payload.hintIntentId === "available_vehicles" && hasSignalSlots(payload.slots);
  const isConversationalHint = CONVERSATIONAL_INTENTS.has(payload.hintIntentId);
  if (intent === "REJECT") {
    return payload.hintConfidence >= 1;
  }
  if (isConversationalHint && intent !== payload.hintIntentId) {
    return true;
  }
  if (hasVehicleFilters && RECOMMENDATION_INTENTS.has(intent) && intent !== "available_vehicles") {
    return true;
  }
  if (payload.hintConfidence >= 2 && intent !== payload.hintIntentId) {
    return true;
  }
  return score < 0.35 && intent !== payload.hintIntentId;
}

function buildRecommendationReply(intentId, language, payload, recommendations) {
  const baseAnswer = pickDatasetAnswer(intentId, language, payload.originalMessage);
  if (recommendations.length === 0) {
    return normalizeLanguage(language) === "filipino"
      ? "Wala akong mahanap na available na sasakyan na tugma sa request mo. Subukang baguhin ang passengers, budget, transmission, o uri ng sasakyan."
      : "I couldn't find an available vehicle that matches your request. Try adjusting the passengers, budget, transmission, or vehicle type.";
  }

  const suffix =
    normalizeLanguage(language) === "filipino"
      ? "Narito ang ilang sasakyang maaaring piliin batay sa request mo."
      : "Here are a few vehicles you can consider based on your request.";
  return `${baseAnswer} ${suffix}`.trim();
}

export function applyChatbotGuardrails(response, payload) {
  const normalized = normalizeChatbotResponse(response);
  const selectedLanguage = normalizeLanguage(payload.selectedLanguage);
  const desiredReplyLang = getLanguageCode(selectedLanguage);

  if (shouldRejectLowSignalResponse(normalized, payload)) {
    return buildRejectedChatbotResponse(selectedLanguage, payload.preflightRejectReason || "low_signal");
  }

  let intent = normalized.intent;
  let score = normalized.score;
  let reply = normalized.reply;
  let recommendations = normalizeRecommendationList(normalized.recommendations);

  if (shouldOverrideIntentWithHint(normalized, payload)) {
    intent = payload.hintIntentId;
    score = Math.max(score, payload.hintConfidence >= 2 ? 0.72 : 0.58);
  }

  const replyLangMismatch = Boolean(normalized.reply_lang) && normalized.reply_lang !== desiredReplyLang;
  const hasDatasetIntent = Boolean(getCanonicalQuestion(intent, selectedLanguage));
  const shouldUseDatasetReply =
    intent !== "REJECT" && hasDatasetIntent && (replyLangMismatch || !reply || score < 0.55 || intent !== normalized.intent);

  if (shouldUseDatasetReply) {
    reply = pickDatasetAnswer(intent, selectedLanguage, payload.originalMessage);
  }

  if (RECOMMENDATION_INTENTS.has(intent)) {
    recommendations = recommendations.length > 0 ? recommendations.slice(0, 3) : payload.vehicles.slice(0, 3);
    reply = buildRecommendationReply(intent, selectedLanguage, payload, recommendations);
  } else {
    recommendations = [];
  }

  if (intent === "REJECT") {
    reply = FALLBACK_REPLIES[selectedLanguage];
  }

  return {
    ...normalized,
    intent,
    score,
    reply,
    reply_lang: desiredReplyLang,
    recommendations,
  };
}

export function getChatbotDatasetInfo() {
  const { datasetPath, intentsById } = loadDataset();
  return {
    datasetPath,
    intentsCount: Object.keys(intentsById).length,
  };
}
