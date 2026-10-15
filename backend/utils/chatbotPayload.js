import fs from "fs";
import path from "path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "url";
import { getVehicleHourlyRate, roundCurrency } from "./pricing.js";
import { containsModeratedContent } from "./chatModeration.js";
import { RENTAL_ENTITY_KEYS, validRentalEntities, isPublicListingId, getChatbotRentalQuote, getChatbotQuoteDurationMinutes } from "./chatbotRentalQuote.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const chatbotDataDir = path.resolve(__dirname, "../data/chatbot");
const CHATBOT_DATASET_PATH = path.resolve(chatbotDataDir, "rentifypro_chatbot_dataset_v6.json");
const CHATBOT_CONFIG_PATH = path.resolve(chatbotDataDir, "chatbot_config.json");
const CHATBOT_DATASET_SCHEMA_VERSION = "v6_intent_multilingual_conversational";

const chatbotConfig = JSON.parse(fs.readFileSync(CHATBOT_CONFIG_PATH, "utf-8"));
const CHATBOT_MAX_INPUT_LENGTH = Number(chatbotConfig.max_message_length || 500);
const TOP_RECOMMENDATIONS = Number(chatbotConfig.recommendation_limit || 3);
const CONFIGURED_VEHICLE_BRANDS = chatbotConfig.vehicle_brands;
const CHATBOT_TOPICS = chatbotConfig.topics;
const VEHICLE_CATEGORY_SUBTYPES = chatbotConfig.vehicle_category_subtypes;
const VEHICLE_FUELS = ["gasoline", "diesel", "electric", "hybrid"];
const STATUS_CONDITION_KEYS = new Set(["vehicle_status_overview", "vehicle_status_unavailable", "vehicle_status_list"]);
const CONTEXT_CONDITION_KEYS = new Set([...STATUS_CONDITION_KEYS, "payment_option_unavailable"]);
if (!Array.isArray(CONFIGURED_VEHICLE_BRANDS) || CONFIGURED_VEHICLE_BRANDS.length === 0) {
  throw new Error("chatbot_config.json must define a non-empty vehicle_brands array");
}
if (!VEHICLE_CATEGORY_SUBTYPES || typeof VEHICLE_CATEGORY_SUBTYPES !== "object"
  || Object.keys(VEHICLE_CATEGORY_SUBTYPES).sort().join(",") !== "car,motorcycle,truck,van"
  || Object.values(VEHICLE_CATEGORY_SUBTYPES).some((types) => !Array.isArray(types) || !types.length
    || types.some((type) => typeof type !== "string" || !type))) {
  throw new Error("chatbot_config.json must define vehicle_category_subtypes; synchronize the chatbot assets");
}

const SUPPORTED_LANGUAGES = new Set(["english", "filipino", "taglish"]);
const SUPPORTED_REPLY_STYLES = new Set(["en", "fil", "taglish"]);
const DEFAULT_LANGUAGE = "english";
const LANGUAGE_CODE_BY_NAME = { english: "en", filipino: "fil", taglish: "taglish" };
const LANGUAGE_NAME_BY_CODE = { en: "english", fil: "filipino", tag: "taglish", taglish: "taglish" };

const RECOMMENDATION_INTENTS = new Set([
  "available_vehicles",
  "available_transmission",
  "passenger_capacity",
  "vehicle_brand_search",
]);
const CONVERSATIONAL_INTENTS = new Set([
  "chat_greeting",
  "chat_wellbeing",
  "chat_identity",
  "chat_gender_identity",
  "chat_language_support",
  "chat_gratitude",
  "chat_acknowledgement",
  "chat_goodbye",
  "chat_casual_conversation",
  "help_request",
  "unclear_message",
  "nonsense_message",
]);
const RETAIN_TASK_CONTEXT_INTENTS = new Set([
  "chat_greeting", "chat_wellbeing", "chat_identity", "chat_gender_identity",
  "chat_language_support", "chat_gratitude", "chat_acknowledgement", "chat_casual_conversation",
]);
const BRIEF_SOCIAL_INTENTS = new Set(["chat_acknowledgement", "chat_gratitude", "chat_goodbye"]);
const MAX_TASK_IDLE_TURNS = 2;
const REQUESTED_ANSWER_TYPES = new Set(["instructions", "navigation", "explanation", "overview", "troubleshooting", "confirmation", "continuation"]);
const ASSISTANT_ACTIONS = new Set([...REQUESTED_ANSWER_TYPES, "search"]);
const OFFER_ACTIONS = new Set(["instructions", "search"]);
const CONFIG_SHA256 = createHash("sha256").update(fs.readFileSync(CHATBOT_CONFIG_PATH)).digest("hex");

const validRequestedAnswerType = (value) => value == null || (typeof value === "string" && REQUESTED_ANSWER_TYPES.has(value));
export const isChatbotVehicleGuidance = (answer) => RECOMMENDATION_INTENTS.has(answer.intent)
  && ["instructions", "navigation", "explanation", "troubleshooting", "continuation"].includes(answer.response_variant)
  && validResponseVariant(answer.intent, answer.response_variant);

const FALLBACK_REPLIES = {
  english: "Sorry, I couldn't identify the question safely. Please rephrase it with a little more detail.",
  filipino: "Paumanhin, hindi ko matukoy nang ligtas ang tanong. Pakisabi ulit ito nang may kaunting detalye.",
  taglish: "Sorry, hindi ko matukoy nang maayos ang question. Please rephrase with a little more detail.",
};
const REJECT_REPLIES = {
  english: {
    empty: "Please type a message so I can help you.",
    too_long: `Please keep your message within ${CHATBOT_MAX_INPUT_LENGTH} characters.`,
    invalid_characters: "Please remove unsupported control characters and try again.",
    profanity: "Please avoid offensive words. Rephrase your question politely, and I'll gladly help.",
  },
  filipino: {
    empty: "Pakilagay ang iyong mensahe para matulungan kita.",
    too_long: `Pakiikli ang mensahe sa loob ng ${CHATBOT_MAX_INPUT_LENGTH} na characters.`,
    invalid_characters: "Pakialis ang unsupported control characters at subukan ulit.",
    profanity: "Iwasan muna natin ang masasamang salita. I-type ulit nang maayos ang tanong at tutulungan kita.",
  },
  taglish: {
    empty: "Please type your message para matulungan kita.",
    too_long: `Please keep your message within ${CHATBOT_MAX_INPUT_LENGTH} characters.`,
    invalid_characters: "Please remove unsupported control characters and try again.",
    profanity: "Please avoid offensive words. Rephrase mo nang maayos and I'll gladly help.",
  },
};

const FILIPINO_LANGUAGE_MARKERS = [
  /\bano\b/i, /\banong\b/i, /\bpaano\b/i, /\bpano\b/i, /\bmagkano\b/i,
  /\bkailangan\b/i, /\bpwede\b/i, /\bmaaari\b/i, /\bilang\b/i, /\bpasahero\b/i,
  /\bsasakyan\b/i, /\brenta\b/i, /\bbayad\b/i, /\bdeposito\b/i, /\bhanap\b/i,
  /\bmeron\b/i, /\bmayroon\b/i, /\bmay\b.*\b(?:ba|bang)\b/i, /\bkamusta\b/i, /\bsalamat\b/i,
];
const ENGLISH_LANGUAGE_MARKERS = [
  /\bwhat\b/i, /\bhow\b/i, /\bwhere\b/i, /\bwhen\b/i, /\bwhich\b/i,
  /\bcan\b/i, /\bcould\b/i, /\bbooking\b/i, /\bvehicle\b/i, /\bprice\b/i,
  /\brate\b/i, /\bpayment\b/i, /\binsurance\b/i, /\brequirements?\b/i,
];

const TEXT_REPLACEMENTS = [
  [/\u2018|\u2019|\u02bc/g, "'"],
  [/\u201c|\u201d/g, '"'],
  [/\u2010|\u2011|\u2012|\u2013|\u2014|\u2212/g, "-"],
  [/\u00a0/g, " "],
];
const UNSUPPORTED_CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;

let datasetCache = null;

function cleanText(value = "") {
  let text = String(value ?? "").normalize("NFKC");
  for (const [pattern, replacement] of TEXT_REPLACEMENTS) text = text.replace(pattern, replacement);
  return text.replace(/\s+/gu, " ").trim();
}

function normalizeText(value = "") {
  return cleanText(value)
    .toLocaleLowerCase("en")
    .replace(/\u20b1/gu, " php ")
    .replace(/([!?.,])\1+/gu, "$1")
    .replace(/[^\p{L}\p{N}%#'\-\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

const VEHICLE_BRAND_BY_NORMALIZED = new Map();
for (const value of CONFIGURED_VEHICLE_BRANDS) {
  const canonical = cleanText(value);
  const normalized = normalizeText(canonical);
  if (!canonical || !normalized || VEHICLE_BRAND_BY_NORMALIZED.has(normalized)) {
    throw new Error("chatbot_config.json contains an invalid or duplicate vehicle brand");
  }
  VEHICLE_BRAND_BY_NORMALIZED.set(normalized, canonical);
}

function normalizeLanguage(language) {
  const normalized = normalizeText(language);
  return SUPPORTED_LANGUAGES.has(normalized) ? normalized : DEFAULT_LANGUAGE;
}

function detectMessageLanguage(message = "") {
  const normalized = normalizeText(message);
  if (!normalized) return DEFAULT_LANGUAGE;
  const hasFilipino = FILIPINO_LANGUAGE_MARKERS.some((pattern) => pattern.test(normalized));
  const hasEnglish = ENGLISH_LANGUAGE_MARKERS.some((pattern) => pattern.test(normalized));
  if (hasFilipino && hasEnglish) return "taglish";
  if (hasFilipino) return "filipino";
  return "english";
}

function resolveSelectedLanguage(requestedLanguage = "", message = "") {
  const normalized = normalizeText(requestedLanguage);
  if (normalized && normalized !== "auto" && SUPPORTED_LANGUAGES.has(normalized)) return normalized;
  return detectMessageLanguage(message);
}

function getLanguageCode(language) {
  return LANGUAGE_CODE_BY_NAME[normalizeLanguage(language)] || "en";
}

function normalizeStringList(values = []) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = cleanText(value);
    const key = normalizeText(text);
    if (!text || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function loadDataset() {
  const datasetPath = CHATBOT_DATASET_PATH;
  const datasetMtimeMs = fs.existsSync(datasetPath) ? fs.statSync(datasetPath).mtimeMs : -1;
  if (datasetCache?.datasetPath === datasetPath && datasetCache.datasetMtimeMs === datasetMtimeMs) return datasetCache;
  if (!fs.existsSync(datasetPath)) throw new Error(`Required chatbot dataset v6 is missing: ${datasetPath}`);

  const raw = JSON.parse(fs.readFileSync(datasetPath, "utf-8"));
  if (raw?.schema_version !== CHATBOT_DATASET_SCHEMA_VERSION) {
    throw new Error(`Chatbot dataset must use schema ${CHATBOT_DATASET_SCHEMA_VERSION}: ${datasetPath}`);
  }

  const items = Array.isArray(raw.items) ? raw.items : [];
  const intentsById = {};
  for (const [index, item] of items.entries()) {
    const intentId = cleanText(item?.id);
    if (!intentId || intentsById[intentId]) {
      throw new Error(`Invalid or duplicate v6 chatbot intent at index ${index}: ${intentId || "missing id"}`);
    }
    const examples = normalizeStringList(item.examples);
    const aliases = normalizeStringList(item.aliases || []);
    const hardNegatives = normalizeStringList(item.hard_negatives || []);
    const responses = item?.responses && typeof item.responses === "object" ? item.responses : {};
    const normalizedResponses = {
      en: normalizeStringList(responses.en),
      fil: normalizeStringList(responses.fil),
      taglish: normalizeStringList(responses.taglish),
    };
    if (!examples.length || Object.values(normalizedResponses).some((answers) => !answers.length)) {
      throw new Error(`Invalid v6 chatbot intent '${intentId}': incomplete examples or responses`);
    }
    const variants = item.response_variants ?? {};
    if (!variants || typeof variants !== "object" || Array.isArray(variants) || Object.keys(variants).length > 16) {
      throw new Error(`Invalid response variants for '${intentId}'`);
    }
    for (const [key, answers] of Object.entries(variants)) {
      if (!/^[a-z][a-z0-9_]{0,31}$/u.test(key) || !answers || typeof answers !== "object" || Array.isArray(answers)
        || Object.keys(answers).length !== 3 || ["en", "fil", "taglish"].some((style) =>
          !Array.isArray(answers[style]) || !answers[style].length
          || answers[style].some((answer) => typeof answer !== "string" || !answer.trim()))) {
        throw new Error(`Incomplete response variant '${intentId}.${key}'`);
      }
    }
    const offers = item.assistant_offers ?? {};
    if (!offers || typeof offers !== "object" || Array.isArray(offers) || Object.keys(offers).length > 4
      || Object.entries(offers).some(([source, action]) => (source !== "base" && !Object.hasOwn(variants, source))
        || !OFFER_ACTIONS.has(action) || (action === "instructions" && !Object.hasOwn(variants, "instructions"))
        || (action === "search" && intentId !== "available_vehicles"))) {
      throw new Error(`Invalid assistant offers for '${intentId}'`);
    }
    intentsById[intentId] = {
      ...item,
      id: intentId,
      description: cleanText(item.description),
      examples,
      aliases,
      hard_negatives: hardNegatives,
      responses: normalizedResponses,
      response_variants: Object.fromEntries(Object.entries(variants).map(([key, answers]) => [key,
        Object.fromEntries(["en", "fil", "taglish"].map((style) => [style, normalizeStringList(answers[style])]))])),
      assistant_offers: offers,
      requires_live_data: Boolean(item.requires_live_data),
      live_source: cleanText(item.live_source),
      policy_source: cleanText(item.policy_source),
    };
  }
  if (!Object.keys(intentsById).length) throw new Error(`No valid intents loaded from dataset: ${datasetPath}`);
  datasetCache = { datasetPath, datasetMtimeMs, intentsById,
    datasetSha256: createHash("sha256").update(fs.readFileSync(datasetPath)).digest("hex") };
  return datasetCache;
}

function getIntent(intentId) {
  const intents = loadDataset().intentsById;
  return typeof intentId === "string" && Object.hasOwn(intents, intentId) ? intents[intentId] : null;
}

function getIntentAnswers(intentId, language) {
  const item = getIntent(intentId);
  if (!item) return [];
  const preferred = getLanguageCode(language);
  const order = preferred === "taglish" ? ["taglish", "en", "fil"] : [preferred, "en", "fil", "taglish"];
  for (const key of order) {
    const answers = item.responses[key];
    if (Array.isArray(answers) && answers.length) return answers;
  }
  return [];
}

function getCanonicalAnswer(intentId, language, variant = null) {
  if (variant) return getIntent(intentId)?.response_variants?.[variant]?.[getLanguageCode(language)]?.[0] || "";
  return getIntentAnswers(intentId, language)[0] || "";
}

function validResponseVariant(intent, variant) {
  return variant == null || (typeof variant === "string" && Boolean(getIntent(intent))
    && Object.hasOwn(getIntent(intent).response_variants, variant));
}


function catalogLabel(value, limit) {
  const label = typeof value === "string" ? cleanText(value) : "";
  return label && label.length <= limit && /^[\p{L}\p{N}_ .&'/-]+$/u.test(label) ? label : "";
}

function normalizeSubtype(value) {
  const subtype = normalizeText(value).replace(/-/gu, " ").replace(/\s+/gu, " ").trim();
  return ({ "pick up": "pickup", sportsbike: "sports bike", sportscar: "sports car", bigbike: "big bike" })[subtype] || subtype;
}

export function buildChatbotInventoryVocabulary(vehicles = []) {
  const brands = new Map(), models = new Map(), subtypes = new Map();
  for (const vehicle of vehicles) {
    const identity = deriveVehicleIdentity(vehicle, cleanText(vehicle.name));
    const brandKey = normalizeText(identity.brand);
    if (identity.brand && (brands.has(brandKey) || brands.size < 128)) {
      if (!brands.has(brandKey)) brands.set(brandKey, identity.brand);
      if (catalogLabel(identity.model, 80) && models.size < 512) {
        models.set(`${brandKey}\0${normalizeText(identity.model)}`, { brand: brands.get(brandKey), model: identity.model });
      }
    }
    const category = normalizeVehicleType(vehicle.specs?.type || vehicle.type);
    const name = normalizeSubtype(catalogLabel(vehicle.specs?.subType, 60));
    if (Object.hasOwn(VEHICLE_CATEGORY_SUBTYPES, category) && name && subtypes.size < 256) {
      subtypes.set(`${category}\0${name}`, { category, name });
    }
  }
  return { brands: [...brands.values()], models: [...models.values()], subtypes: [...subtypes.values()] };
}

function vocabularyBrands(vocabulary = {}) {
  return [...CONFIGURED_VEHICLE_BRANDS, ...(vocabulary.brands || [])];
}

function normalizeVehicleEntities(value, vocabulary = {}) {
  if (value === undefined || value === null) {
    return { valid: true, value: { brand: null, model: null } };
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, value: { brand: null, model: null } };
  }
  const allowedKeys = new Set(["brand", "model", "category", "vehicle_subtype", "excluded_subtypes", "max_budget", "currency", "rate_unit", "transmission", "fuel", "excluded_fuels", "self_drive_only", "seat_match", "specification_requested", "driver_included_required", "location", "pax", "excluded_brands", "excluded_transmissions", "requested_schedule", ...RENTAL_ENTITY_KEYS]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    return { valid: false, value: { brand: null, model: null } };
  }

  const rawBrand = cleanText(value.brand);
  const brand = rawBrand ? vocabularyBrands(vocabulary).find(item => normalizeText(item) === normalizeText(rawBrand)) : null;
  const rawModel = cleanText(value.model);
  const model = rawModel && rawModel.length <= 80 ? rawModel : null;
  const category = value.category == null ? null : cleanText(value.category).toLowerCase();
  const subtype = value.vehicle_subtype ?? null;
  const parent = category === "pickup" ? "truck" : ["suv", "sedan"].includes(category) ? "car" : category;
  const allowedSubtypes = [...(VEHICLE_CATEGORY_SUBTYPES[parent] || []), ...(parent === "motorcycle" ? ["big bike"] : []),
    ...(vocabulary.subtypes || []).filter(item => item.category === parent).map(item => item.name)];
  const excludedSubtypes = value.excluded_subtypes ?? [];
  const knownSubtypes = [...Object.values(VEHICLE_CATEGORY_SUBTYPES).flat(), ...(vocabulary.subtypes || []).map(item => item.name)];
  const maxBudget = value.max_budget == null ? null : Number(value.max_budget);
  const currency = value.currency == null ? null : cleanText(value.currency).toUpperCase();
  const rateUnit = value.rate_unit == null ? null : cleanText(value.rate_unit).toLowerCase();
  const transmission = value.transmission == null ? null : cleanText(value.transmission).toLowerCase();
  const location = value.location == null ? null : cleanText(value.location);
  const schedule = value.requested_schedule == null ? null : cleanText(value.requested_schedule);
  const excluded = value.excluded_brands ?? [];
  const excludedTransmissions = value.excluded_transmissions ?? [];
  const excludedFuels = value.excluded_fuels ?? [];
  const valid = validRentalEntities(value)
    && (value.brand == null || typeof value.brand === "string")
    && (value.model == null || typeof value.model === "string")
    && (value.max_budget == null || typeof value.max_budget === "number")
    && ["category", "currency", "rate_unit", "transmission"].every((key) => value[key] == null || typeof value[key] === "string")
    && (!rawBrand || Boolean(brand)) && (!rawModel || Boolean(model))
    && (category === null || ["car", "truck", "sedan", "suv", "van", "pickup", "motorcycle"].includes(category))
    && (subtype === null || (typeof subtype === "string" && allowedSubtypes.includes(subtype)))
    && (maxBudget === null || (Number.isFinite(maxBudget) && maxBudget > 0 && maxBudget <= 10000000))
    && (currency === null || currency === "PHP")
    && (rateUnit === null || ["day", "hour"].includes(rateUnit))
    && (transmission === null || ["automatic", "manual"].includes(transmission))
    && (value.fuel === undefined || (typeof value.fuel === "string" && VEHICLE_FUELS.includes(value.fuel)))
    && Array.isArray(excludedFuels) && excludedFuels.length <= 4 && excludedFuels.every(fuel => VEHICLE_FUELS.includes(fuel))
    && (value.self_drive_only === undefined || (typeof value.self_drive_only === "boolean"
      && (!value.self_drive_only || value.driver_requested === false)))
    && (maxBudget === null || currency === "PHP")
    && (location === null || (typeof value.location === "string" && location.length > 0 && location.length <= 80))
    && (schedule === null || (typeof value.requested_schedule === "string" && schedule.length > 0 && schedule.length <= 100))
    && (value.pax == null || (Number.isInteger(value.pax) && value.pax >= 1 && value.pax <= 99))
    && (value.seat_match === undefined || (typeof value.seat_match === "string" && ["exact", "minimum"].includes(value.seat_match) && Number.isInteger(value.pax)))
    && (value.specification_requested === undefined || (typeof value.specification_requested === "string"
      && ["seats", "fuel", "transmission", "driver", "self_drive", "subtype"].includes(value.specification_requested)))
    && (value.driver_included_required === undefined || typeof value.driver_included_required === "boolean")
    && Array.isArray(excluded) && excluded.length <= 12
    && excluded.every((item) => vocabularyBrands(vocabulary).includes(item))
    && Array.isArray(excludedTransmissions) && excludedTransmissions.length <= 2
    && excludedTransmissions.every((item) => ["automatic", "manual"].includes(item))
    && Array.isArray(excludedSubtypes) && excludedSubtypes.length <= 12
    && excludedSubtypes.every((item) => typeof item === "string" && knownSubtypes.includes(item));
  const normalized = { brand: brand || null, model };
  if (category !== null) normalized.category = category;
  if (subtype !== null) normalized.vehicle_subtype = subtype;
  if (maxBudget !== null) normalized.max_budget = maxBudget;
  if (currency !== null) normalized.currency = currency;
  if (rateUnit !== null) normalized.rate_unit = rateUnit;
  if (transmission !== null) normalized.transmission = transmission;
  if (location !== null) normalized.location = location;
  if (schedule !== null) normalized.requested_schedule = schedule;
  if (value.pax != null) normalized.pax = value.pax;
  for (const key of ["seat_match", "specification_requested", "driver_included_required"]) {
    if (Object.hasOwn(value, key)) normalized[key] = value[key];
  }
  if (excluded.length) normalized.excluded_brands = [...new Set(excluded)];
  if (excludedTransmissions.length) normalized.excluded_transmissions = [...new Set(excludedTransmissions)];
  if (Array.isArray(excludedSubtypes) && excludedSubtypes.length) normalized.excluded_subtypes = [...new Set(excludedSubtypes)];
  if (value.fuel !== undefined) normalized.fuel = value.fuel;
  if (excludedFuels.length) normalized.excluded_fuels = [...new Set(excludedFuels)];
  if (value.self_drive_only !== undefined) normalized.self_drive_only = value.self_drive_only;
  for (const key of RENTAL_ENTITY_KEYS) if (Object.hasOwn(value, key)) normalized[key] = value[key];
  return { valid, value: normalized };
}

function normalizeConversationTopic(value, intent) {
  const topic = value.topic ?? null;
  const candidates = value.candidate_intents ?? [];
  const spec = typeof topic === "string" && Object.hasOwn(CHATBOT_TOPICS, topic) ? CHATBOT_TOPICS[topic] : null;
  const valid = (topic === null || (Boolean(spec) && (intent === "REJECT" || spec.intents.includes(intent))))
    && Array.isArray(candidates) && candidates.length <= 3
    && candidates.every((id) => typeof id === "string" && getIntent(id)
      && (spec ? spec.candidates.includes(id) : ["vehicle_availability_status", "payment_troubleshooting"].includes(id)));
  return { valid, topic, candidate_intents: valid ? [...new Set(candidates)] : [] };
}

export function normalizeChatbotConversationContext(value, vocabulary = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !["intent", "entities", "clarification", "choices", "suggested_brand", "topic", "conditions", "candidate_intents", "response_variant", "requested_answer_type", "idle_turns", "assistant_action", "pending_offer"].includes(key))) return null;
  if (value.intent !== "REJECT" && !getIntent(value.intent)) return null;
  if (!validResponseVariant(value.intent, value.response_variant)) return null;
  if (!validRequestedAnswerType(value.requested_answer_type)) return null;
  if (value.assistant_action != null && !ASSISTANT_ACTIONS.has(value.assistant_action)) return null;
  const offer = value.pending_offer;
  if (offer != null && (!offer || typeof offer !== "object" || Array.isArray(offer)
    || Object.keys(offer).sort().join(",") !== "action,intent,source_variant"
    || offer.intent !== value.intent || !OFFER_ACTIONS.has(offer.action)
    || offer.source_variant !== (value.response_variant || "base")
    || getIntent(value.intent)?.assistant_offers?.[offer.source_variant] !== offer.action)) return null;
  if (value.idle_turns !== undefined && (!Number.isInteger(value.idle_turns) || value.idle_turns < 0 || value.idle_turns > MAX_TASK_IDLE_TURNS)) return null;
  const entities = normalizeVehicleEntities(value.entities, vocabulary);
  const clarification = normalizeClarification(value.clarification, Boolean(value.clarification?.required));
  const choices = value.choices ?? [];
  const metadata = normalizeConversationTopic(value, value.intent);
  const conditions = normalizeConditions(value.conditions);
  if (!entities.valid || !clarification.valid || !metadata.valid || !conditions.valid
    || Object.keys(conditions.value).some((key) => !CONTEXT_CONDITION_KEYS.has(key))
    || (Object.keys(conditions.value).some((key) => STATUS_CONDITION_KEYS.has(key)) && !["REJECT", "vehicle_availability_status"].includes(value.intent))
    || (conditions.value.payment_option_unavailable && !["REJECT", "payment_troubleshooting"].includes(value.intent))
    || !Array.isArray(choices) || choices.length > TOP_RECOMMENDATIONS) return null;
  if (value.suggested_brand != null && !vocabularyBrands(vocabulary).includes(value.suggested_brand)) return null;
  if (choices.some((choice) => !choice || typeof choice !== "object"
    || Object.keys(choice).some((key) => !["brand", "model", "listing_id"].includes(key))
    || (choice.listing_id !== undefined && !isPublicListingId(choice.listing_id))
    || !vocabularyBrands(vocabulary).includes(choice.brand) || typeof choice.model !== "string"
    || !choice.model.trim() || choice.model.length > 80)) return null;
  return { intent: value.intent, entities: entities.value, clarification: clarification.value,
    ...(value.idle_turns ? { idle_turns: value.idle_turns } : {}),
    ...(value.response_variant ? { response_variant: value.response_variant } : {}),
    ...(value.requested_answer_type ? { requested_answer_type: value.requested_answer_type } : {}),
    ...(value.assistant_action ? { assistant_action: value.assistant_action } : {}),
    ...(offer ? { pending_offer: { intent: offer.intent, action: offer.action, source_variant: offer.source_variant } } : {}),
    ...(metadata.topic ? { topic: metadata.topic } : {}),
    ...(metadata.candidate_intents.length ? { candidate_intents: metadata.candidate_intents } : {}),
    ...(Object.keys(conditions.value).length ? { conditions: conditions.value } : {}),
    choices: choices.map(({ brand, model, listing_id }) => ({ brand, model, ...(listing_id ? { listing_id } : {}) })),
    ...(value.suggested_brand ? { suggested_brand: value.suggested_brand } : {}) };
}

export function buildChatbotConversationContext(response, previousContext = null, vocabulary = buildChatbotInventoryVocabulary(response.recommendations || [])) {
  if (response.reason_code === "conversation_reset" || response.intent === "chat_goodbye") return null;
  const previousTask = normalizeChatbotConversationContext(previousContext, vocabulary);
  const repairClarification = response.reason_code === "conversation_repair_clarification";
  const ordinaryFallback = response.intent === "REJECT" && ["low_confidence", "ambiguous_intent"].includes(response.reason_code)
    && (!response.topic || response.topic === previousTask?.topic);
  if (RETAIN_TASK_CONTEXT_INTENTS.has(response.intent) || response.intent === "nonsense_message" || repairClarification || ordinaryFallback) {
    const previous = normalizeChatbotConversationContext(previousContext, vocabulary);
    if (!previous || CONVERSATIONAL_INTENTS.has(previous.intent)
      || (previous.idle_turns || 0) >= MAX_TASK_IDLE_TURNS) return null;
    const retained = { ...previous, idle_turns: (previous.idle_turns || 0) + 1 };
    if (response.reason_code === "assistant_offer_declined") delete retained.pending_offer;
    return normalizeChatbotConversationContext(retained, vocabulary);
  }
  if (CONVERSATIONAL_INTENTS.has(response.intent)) return null;
  if (response.intent === "REJECT" && response.reason_code !== "brand_spelling_clarification"
    && !(response.requires_clarification && response.candidate_intents?.length)) return null;
  const source = response.response_variant || "base";
  const offeredAction = getIntent(response.intent)?.assistant_offers?.[source];
  const actualOffer = !response.requires_clarification && offeredAction
    && response.reply === getCanonicalAnswer(response.intent, LANGUAGE_NAME_BY_CODE[response.language], response.response_variant);
  const assistantAction = isChatbotVehicleGuidance(response) ? response.response_variant
    : response.recommendations?.length ? "search"
    : REQUESTED_ANSWER_TYPES.has(response.response_variant) ? response.response_variant
    : response.requested_answer_type || (actualOffer || response.reason_code ? "overview" : null);
  return normalizeChatbotConversationContext({
    intent: response.intent, entities: response.entities,
    ...(ASSISTANT_ACTIONS.has(assistantAction) ? { assistant_action: assistantAction } : {}),
    ...(actualOffer ? { pending_offer: { intent: response.intent, action: offeredAction, source_variant: source } } : {}),
    ...(response.response_variant ? { response_variant: response.response_variant } : {}),
    ...(response.requested_answer_type ? { requested_answer_type: response.requested_answer_type } : {}),
    clarification: response.clarification,
    topic: response.topic, candidate_intents: response.candidate_intents,
    conditions: Object.fromEntries(Object.entries(response.conditions || {}).filter(([key]) => CONTEXT_CONDITION_KEYS.has(key))),
    choices: (response.status_choices?.length ? response.status_choices : response.recommendations || []).filter(({ brand, model }) => brand && model)
      .slice(0, TOP_RECOMMENDATIONS).map(({ brand, model, _id }) => ({ brand, model, ...(isPublicListingId(_id) ? { listing_id: _id } : {}) })),
    ...(response.suggested_brand ? { suggested_brand: response.suggested_brand } : {}),
  }, vocabulary);
}

export function getChatbotContextOutcome(response, previousContext, rejectedContext = false) {
  if (response.reason_code === "conversation_reset") return "reset";
  if (rejectedContext) return "rejected";
  if (response.conversation_context?.idle_turns) return "retained";
  if (response.conversation_context) return "updated";
  if (!previousContext) return "absent";
  const idleReply = RETAIN_TASK_CONTEXT_INTENTS.has(response.intent) || response.intent === "nonsense_message"
    || response.reason_code === "conversation_repair_clarification"
    || (response.intent === "REJECT" && ["low_confidence", "ambiguous_intent"].includes(response.reason_code)
      && (!response.topic || response.topic === previousContext.topic));
  return idleReply && previousContext.idle_turns >= MAX_TASK_IDLE_TURNS ? "expired" : "cleared";
}

export function normalizePendingVehicleSearch(value, vocabulary = {}) {
  const normalized = normalizeVehicleEntities(value, vocabulary);
  if (!normalized.valid || !value || typeof value !== "object" || Array.isArray(value)) return null;
  const entities = normalized.value;
  if (!entities.max_budget || entities.currency !== "PHP" || (!entities.brand && !entities.category)
    || entities.rate_unit) return null;
  return {
    brand: entities.brand,
    model: entities.model,
    ...(entities.category ? { category: entities.category } : {}),
    max_budget: entities.max_budget,
    currency: "PHP",
    ...(entities.transmission ? { transmission: entities.transmission } : {}),
  };
}

function normalizeConditions(value) {
  if (value == null) return { valid: true, value: {} };
  if (typeof value !== "object" || Array.isArray(value)) return { valid: false, value: {} };
  const booleanKeys = new Set(["remaining_balance", "payment_after_due_date", ...CONTEXT_CONDITION_KEYS]);
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "downpayment_percent") {
      if (!Number.isInteger(item) || item < 1 || item > 100) return { valid: false, value: {} };
    } else if (!booleanKeys.has(key) || item !== true) {
      return { valid: false, value: {} };
    }
    result[key] = item;
  }
  return { valid: true, value: result };
}

function normalizeClarification(value, required) {
  if (value == null) return { valid: true, value: { required, type: null, field: null } };
  if (typeof value !== "object" || Array.isArray(value)) return { valid: false, value: null };
  if (Object.keys(value).some((key) => !["required", "type", "field"].includes(key))) return { valid: false, value: null };
  const type = value.type ?? null;
  const field = value.field ?? null;
  const valid = value.required === required
    && (type === null || ["missing_entity", "ambiguous_entity", "ambiguous_intent", "unknown_intent", "spelling_confirmation"].includes(type))
    && (field === null || ["rate_unit", "booking", "brand", "model", "duration", "driver", "fuel", "transmission"].includes(field));
  return { valid, value: { required, type, field } };
}

function hasSignalSlots(slots = {}) {
  return Boolean(slots.listing_id || slots.type || slots.transmission || slots.fuel || slots.excluded_fuels?.length
    || Object.hasOwn(slots, "driver_requested") || slots.pax || slots.budget || slots.brand || slots.model || slots.location || slots.excluded_brands?.length || slots.excluded_transmissions?.length || slots.excluded_subtypes?.length);
}

function extractSlots(message) {
  const amountAwareMessage = cleanText(message)
    .replace(/\u20b1/gu, " PHP ")
    .replace(/(?<=\d),(?=\d)/gu, "");
  const text = normalizeText(amountAwareMessage);
  let pax = null;
  const paxMatch = text.match(/\b(\d{1,2})\s*[- ]?\s*(pax|passengers?|persons?|people|katao|tao|pasahero|seats?|seater)\b/u);
  if (paxMatch) pax = Number.parseInt(paxMatch[1], 10);

  let transmission = "";
  if (/\b(automatic|auto|matic)\b/u.test(text)) transmission = "automatic";
  else if (/\b(manual|stick)\b/u.test(text)) transmission = "manual";

  let type = "";
  if (/\b(sedan|car|kotse)\b/u.test(text)) type = "sedan";
  if (/\bsuv\b/u.test(text)) type = "suv";
  if (/\b(van|minivan)\b/u.test(text)) type = "van";
  if (/\b(pick[\s-]?up|truck)\b/u.test(text)) type = "pickup";
  if (/\b(motorcycle|motorbike|motor)\b/u.test(text)) type = "motorcycle";

  let budget = null;
  const budgetMatch =
    text.match(/(?:budget|under|below|max|maximum|hanggang|up to|less than)\s*(?:php|p)?\s*([0-9]+(?:\.[0-9]+)?k?)/u) ||
    text.match(/(?:php|p)\s*([0-9]+(?:\.[0-9]+)?k?)/u);
  if (budgetMatch?.[1]) {
    const raw = budgetMatch[1].toLowerCase();
    const multiplier = raw.endsWith("k") ? 1000 : 1;
    const value = Number.parseFloat(raw.replace(/k$/u, ""));
    if (Number.isFinite(value)) budget = Math.round(value * multiplier);
  }
  return { pax, transmission, type, budget };
}

function normalizeVehicleType(value = "") {
  const normalized = normalizeText(value).replace(/-/gu, " ").replace("pick up", "pickup");
  if (!normalized) return "";
  if (["car", "cars", "kotse"].includes(normalized)) return "car";
  if (normalized === "sedan") return "sedan";
  if (["suv", "suvs"].includes(normalized)) return "suv";
  if (["van", "vans", "minivan"].includes(normalized)) return "van";
  if (["truck", "trucks"].includes(normalized)) return "truck";
  if (["pickup", "pickup truck"].includes(normalized)) return "pickup";
  if (["motorcycle", "motorcycles", "motorbike", "motor", "motorsiklo"].includes(normalized)) return "motorcycle";
  return Object.values(VEHICLE_CATEGORY_SUBTYPES).some((types) => types.includes(normalized)) ? normalized : "";
}

function normalizeTransmission(value = "") {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  if (["automatic", "auto", "matic"].includes(normalized)) return "automatic";
  if (["manual", "stick"].includes(normalized)) return "manual";
  return "";
}

function toNonNegativeNumber(value) {
  if (value == null || typeof value !== "number") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function resolveVehicleHourlyRate(vehicle = {}) {
  const explicitHourlyRate = toNonNegativeNumber(vehicle.hourlyRate);
  if (explicitHourlyRate !== null) return roundCurrency(explicitHourlyRate);
  if (vehicle.dailyRentalRate !== undefined && vehicle.dailyRentalRate !== null) {
    if (toNonNegativeNumber(vehicle.dailyRentalRate) !== null) return getVehicleHourlyRate(vehicle);
  }
  const dailyRate = toNonNegativeNumber(vehicle.dailyRate);
  if (dailyRate !== null) return roundCurrency(dailyRate / 24);
  const legacyPrice = toNonNegativeNumber(vehicle.price);
  return legacyPrice !== null ? roundCurrency(legacyPrice) : null;
}

function findConfiguredBrand(value = "") {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  for (const [brandKey, canonical] of VEHICLE_BRAND_BY_NORMALIZED) {
    if (` ${normalized} `.includes(` ${brandKey} `)) return canonical;
  }
  return null;
}

function deriveVehicleIdentity(vehicle = {}, name = "") {
  const explicit = catalogLabel(vehicle.brand || vehicle.make || vehicle.manufacturer, 60);
  const prefix = name.split(/\s+/u)[0];
  const prefixIsDescription = normalizeVehicleType(prefix) || normalizeTransmission(prefix)
    || VEHICLE_FUELS.includes(normalizeText(prefix))
    || /^(?:unknown|unavailable|available|unnamed|five-seat|locked|driver|test)$/iu.test(prefix);
  const brand = findConfiguredBrand(explicit) || explicit || findConfiguredBrand(name)
    || (name.includes(" ") && !prefixIsDescription ? catalogLabel(prefix, 60) : null);
  const explicitModel = catalogLabel(vehicle.model, 80);
  if (explicitModel) return { brand, model: explicitModel };
  if (!brand) return { brand: null, model: "" };
  const escaped = brand.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const model = catalogLabel(name.replace(new RegExp(`^${escaped}\\s+`, "iu"), ""), 80);
  return { brand, model: model === name ? "" : model };
}

function normalizeVehicleForChatbot(vehicle = {}) {
  const specs = vehicle.specs || {};
  const images = Array.isArray(vehicle.images) ? vehicle.images : [];
  const hourlyRate = resolveVehicleHourlyRate(vehicle);
  const listedRate = toNonNegativeNumber(vehicle.dailyRentalRate);
  const pricingUnit = vehicle.pricingUnit === "daily" || (vehicle.pricingUnit == null && listedRate !== null) ? "daily" : "hourly";
  const dailyRate = listedRate !== null && pricingUnit === "daily"
    ? roundCurrency(listedRate)
    : roundCurrency(hourlyRate * 24);
  const name = cleanText(vehicle.name) || "Unnamed vehicle";
  const identity = deriveVehicleIdentity(vehicle, name);
  const type = normalizeVehicleType(specs.type || vehicle.type || "");
  const subType = normalizeSubtype(catalogLabel(specs.subType || vehicle.subType, 60));
  const broadType = Object.hasOwn(VEHICLE_CATEGORY_SUBTYPES, type);
  const parents = Object.entries(VEHICLE_CATEGORY_SUBTYPES).filter(([, types]) => types.includes(type || subType));
  const category = broadType ? type : parents.length === 1 ? parents[0][0] : "";
  const knownParents = Object.entries(VEHICLE_CATEGORY_SUBTYPES).filter(([, types]) => types.includes(subType));
  const consistent = !subType || (broadType ? !knownParents.length || knownParents.some(([parent]) => parent === type) || type === subType : !type || type === subType);
  const resolvedType = consistent ? (broadType && ["car", "truck"].includes(type) ? subType || type : type || subType) : "";
  const validRate = hourlyRate !== null && (vehicle.pricingUnit == null || ["daily", "hourly"].includes(vehicle.pricingUnit));
  return {
    _id: String(vehicle._id || ""),
    name,
    brand: identity.brand,
    model: identity.model,
    type: resolvedType,
    subtype: normalizeSubtype(specs.subType || vehicle.subType || ""),
    category: consistent ? category : "",
    transmission: normalizeTransmission(specs.transmission || vehicle.transmission || ""),
    fuel: VEHICLE_FUELS.includes(normalizeText(specs.fuel ?? vehicle.fuel)) ? normalizeText(specs.fuel ?? vehicle.fuel) : "",
    ...(typeof vehicle.driverOptionEnabled === "boolean" ? { driverOptionEnabled: vehicle.driverOptionEnabled } : {}),
    seats: Number.isInteger(specs.seats ?? vehicle.seats) && (specs.seats ?? vehicle.seats) > 0 && (specs.seats ?? vehicle.seats) <= 99 ? (specs.seats ?? vehicle.seats) : 0,
    dailyRate,
    hourlyRate,
    pricingUnit,
    rateAvailable: validRate,
    isAvailable: vehicle.availabilityStatus === "available" && vehicle.isAvailable !== false,
    location: cleanText(vehicle.location),
    imageUrl: cleanText(vehicle.imageUrl || images[0] || ""),
  };
}

function isUniqueOneEditMatch(leftValue, rightValue) {
  const left = normalizeText(leftValue);
  const right = normalizeText(rightValue);
  if (!left || !right || left === right || Math.abs(left.length - right.length) > 1) return false;

  if (left.length === right.length) {
    const mismatches = [];
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) mismatches.push(index);
      if (mismatches.length > 2) return false;
    }
    if (mismatches.length === 1) return true;
    return mismatches.length === 2
      && mismatches[1] === mismatches[0] + 1
      && left[mismatches[0]] === right[mismatches[1]]
      && left[mismatches[1]] === right[mismatches[0]];
  }

  const [shorter, longer] = left.length < right.length ? [left, right] : [right, left];
  let shortIndex = 0;
  let longIndex = 0;
  let skipped = false;
  while (shortIndex < shorter.length && longIndex < longer.length) {
    if (shorter[shortIndex] === longer[longIndex]) {
      shortIndex += 1;
      longIndex += 1;
      continue;
    }
    if (skipped) return false;
    skipped = true;
    longIndex += 1;
  }
  return true;
}

function resolveRequestedModelFromLiveVehicles(model, brand, vehicles) {
  const original = cleanText(model);
  const requested = normalizeText(original);
  if (!requested) return { model: "", candidates: [] };

  const brandVehicles = brand
    ? vehicles.filter((vehicle) => normalizeText(vehicle.brand) === normalizeText(brand))
    : vehicles;
  const exactMatch = brandVehicles.some((vehicle) => {
    const searchable = normalizeText(`${vehicle.model} ${vehicle.name}`);
    return ` ${searchable} `.includes(` ${requested} `);
  });
  if (exactMatch) return { model: original, candidates: [] };

  const requestedTokens = requested.split(/\s+/u).filter(Boolean);
  if (requested.length < 4) return { model: original, candidates: [] };

  const matches = new Map();
  for (const vehicle of brandVehicles) {
    const fullModel = cleanText(vehicle.model);
    if (fullModel.length >= 4 && isUniqueOneEditMatch(requested, fullModel)) {
      matches.set(normalizeText(fullModel), fullModel);
    }
    if (requestedTokens.length !== 1) continue;
    for (const candidate of cleanText(vehicle.model).split(/\s+/u).filter(Boolean)) {
      const normalizedCandidate = normalizeText(candidate);
      if (normalizedCandidate.length < 4 || !isUniqueOneEditMatch(requested, normalizedCandidate)) continue;
      matches.set(normalizedCandidate, candidate);
    }
  }
  const candidates = [...matches.values()].sort((left, right) => left.localeCompare(right, "en"));
  return { model: candidates.length === 1 ? candidates[0] : original,
    candidates: candidates.length > 1 ? candidates : [] };
}

function compareVehicles(a, b, slots) {
  const rateField = slots.rateUnit === "day" ? "dailyRate" : "hourlyRate";
  const comparisons = [
    slots.sort_by === "lowest_price" ? a[rateField] - b[rateField] : 0,
    slots.brand ? Number(b.brand === slots.brand) - Number(a.brand === slots.brand) : 0,
    slots.model ? Number(normalizeText(b.model) === normalizeText(slots.model)) - Number(normalizeText(a.model) === normalizeText(slots.model)) : 0,
    slots.type ? Number(b.type === slots.type) - Number(a.type === slots.type) : 0,
    slots.transmission ? Number(b.transmission === slots.transmission) - Number(a.transmission === slots.transmission) : 0,
    slots.pax ? Math.abs(a.seats - slots.pax) - Math.abs(b.seats - slots.pax) : 0,
    a[rateField] - b[rateField],
    a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
    a._id.localeCompare(b._id),
  ];
  return comparisons.find((value) => value !== 0) || 0;
}

function filterVehiclesForChatbot(vehicles, slots, availableOnly = true, filterDriverOptions = false) {
  const normalized = (Array.isArray(vehicles) ? vehicles : [])
    .map((vehicle) => normalizeVehicleForChatbot(vehicle))
    .filter((vehicle) => !availableOnly || (vehicle.isAvailable && vehicle.rateAvailable && vehicle._id && vehicle.name !== "Unnamed vehicle"));
  const modelResolution = resolveRequestedModelFromLiveVehicles(slots.model, slots.brand, normalized);
  const resolvedSlots = {
    ...slots,
    model: modelResolution.model,
  };
  const strict = normalized.filter((vehicle) => {
    if (resolvedSlots.listing_id && vehicle._id !== resolvedSlots.listing_id) return false;
    if (resolvedSlots.excluded_brands?.some(brand => normalizeText(brand) === normalizeText(vehicle.brand))) return false;
    if (resolvedSlots.excluded_transmissions?.length && (!["automatic", "manual"].includes(vehicle.transmission)
      || resolvedSlots.excluded_transmissions.includes(vehicle.transmission))) return false;
    if (resolvedSlots.location && !normalizeText(vehicle.location).includes(normalizeText(resolvedSlots.location))) return false;
    if (resolvedSlots.brand && normalizeText(vehicle.brand) !== normalizeText(resolvedSlots.brand)) return false;
    if (resolvedSlots.model) {
      const requestedModel = normalizeText(resolvedSlots.model);
      const searchableModel = normalizeText(`${vehicle.model} ${vehicle.name}`);
      if (!` ${searchableModel} `.includes(` ${requestedModel} `)) return false;
    }
    if (resolvedSlots.type && !(["car", "truck"].includes(resolvedSlots.type)
      ? vehicle.category === resolvedSlots.type : vehicle.type === resolvedSlots.type)) return false;
    if (resolvedSlots.vehicle_subtype && vehicle.subtype !== resolvedSlots.vehicle_subtype) return false;
    if (resolvedSlots.excluded_subtypes?.length && (!vehicle.subtype || resolvedSlots.excluded_subtypes.includes(vehicle.subtype))) return false;
    if (resolvedSlots.transmission && vehicle.transmission !== resolvedSlots.transmission) return false;
    if (resolvedSlots.fuel && vehicle.fuel !== resolvedSlots.fuel) return false;
    if (resolvedSlots.excluded_fuels?.length && (!vehicle.fuel || resolvedSlots.excluded_fuels.includes(vehicle.fuel))) return false;
    if (filterDriverOptions && Object.hasOwn(resolvedSlots, "driver_requested")
      && (typeof vehicle.driverOptionEnabled !== "boolean" || (resolvedSlots.driver_requested && !vehicle.driverOptionEnabled)
        || (resolvedSlots.self_drive_only && vehicle.driverOptionEnabled))) return false;
    if (resolvedSlots.pax && (resolvedSlots.seat_match === "exact"
      ? vehicle.seats !== resolvedSlots.pax : vehicle.seats < resolvedSlots.pax)) return false;
    if (resolvedSlots.budget && (!vehicle.rateAvailable || vehicle[resolvedSlots.rateUnit === "day" ? "dailyRate" : "hourlyRate"] > resolvedSlots.budget)) return false;
    return true;
  });
  const chosen = strict.length || !hasSignalSlots(resolvedSlots) ? (strict.length ? strict : normalized) : [];
  return {
    slots: resolvedSlots,
    vehicles: chosen.sort((a, b) => compareVehicles(a, b, resolvedSlots)),
    modelCandidates: modelResolution.candidates,
  };
}

function normalizeClassifierLanguage(value, fallbackLanguage) {
  const normalized = cleanText(value).toLowerCase();
  if (SUPPORTED_REPLY_STYLES.has(normalized)) return normalized;
  if (SUPPORTED_LANGUAGES.has(normalized)) return getLanguageCode(normalized);
  const languageName = LANGUAGE_NAME_BY_CODE[normalized];
  return languageName ? getLanguageCode(languageName) : getLanguageCode(fallbackLanguage);
}

function normalizeAlternative(value) {
  if (!value || typeof value !== "object") return null;
  const intent = cleanText(value.intent || value.intent_id);
  const confidence = Number(value.confidence ?? value.score);
  if (!getIntent(intent) || typeof (value.confidence ?? value.score) !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  return { intent, confidence };
}

function mapVehicleTypeLabel(type, language) {
  const labels = {
    english: { car: "cars", truck: "trucks", sedan: "sedans", suv: "SUVs", van: "vans", pickup: "pickup trucks", motorcycle: "motorcycles" },
    filipino: { car: "kotse", truck: "truck", sedan: "sedan", suv: "SUV", van: "van", pickup: "pickup truck", motorcycle: "motorsiklo" },
    taglish: { car: "cars", truck: "trucks", sedan: "sedans", suv: "SUVs", van: "vans", pickup: "pickup trucks", motorcycle: "motorcycles" },
  };
  return labels[normalizeLanguage(language)]?.[type] || type;
}

function joinNaturalList(values, language) {
  if (!values.length) return "";
  if (values.length === 1) return values[0];
  const conjunction = normalizeLanguage(language) === "filipino" ? "at" : "and";
  if (values.length === 2) return `${values[0]} ${conjunction} ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, ${conjunction} ${values.at(-1)}`;
}

function summarizeAvailableTypes(vehicles, language) {
  const seen = new Set();
  const labels = [];
  for (const vehicle of vehicles) {
    if (!vehicle.type || seen.has(vehicle.type)) continue;
    seen.add(vehicle.type);
    labels.push(mapVehicleTypeLabel(vehicle.type, language));
  }
  return joinNaturalList(labels, language);
}

function buildBrandSearchReply(intent, language, payload, recommendations) {
  const selectedLanguage = normalizeLanguage(language);
  const brand = payload.slots.brand || "";
  const model = payload.slots.model || "";
  const label = [brand, model].filter(Boolean).join(" ");
  const total = payload.vehicles.length;

  if (!recommendations.length) {
    if (payload.slots.type || payload.slots.vehicle_subtype) {
      const filters = describeVehicleFilters(payload.slots);
      return {
        english: `I couldn't find a currently available listing matching these filters: ${filters}.`,
        filipino: `Wala akong nakitang available na listing na tugma sa mga filter na ito: ${filters}.`,
        taglish: `Walang current available listing na match sa filters na ito: ${filters}.`,
      }[selectedLanguage];
    }
    if (selectedLanguage === "filipino") return `Wala akong nakitang available na ${label} na tugma sa paghahanap mo. Hindi nito pinapatunayang walang listing; maaaring unavailable ang unit.`;
    if (selectedLanguage === "taglish") return `Wala akong nakitang available na ${label} vehicle na match sa search mo. This does not confirm that no listing exists; the unit may be unavailable.`;
    return `I couldn't find any available ${label} vehicles matching your search. This does not confirm that no listing exists; a unit may be unavailable.`;
  }

  if (intent === "rental_rate") {
    const requestedUnit = payload.slots.rateUnit === "day" ? "day" : "hour";
    const lowestRate = recommendations[0][requestedUnit === "day" ? "dailyRate" : "hourlyRate"];
    const formattedRate = Number(lowestRate || 0).toLocaleString("en-PH", { maximumFractionDigits: 2 });
    const unitLabel = requestedUnit === "day" ? "day" : "hour";
    if (selectedLanguage === "filipino") return `May nakita akong ${total} kasalukuyang listahan ng ${label}. Nagsisimula sa PHP ${formattedRate} bawat ${requestedUnit === "day" ? "araw" : "oras"} ang rate; nakadepende pa rin sa iskedyul at mga detalye ng booking ang eksaktong kabuuan.`;
    if (selectedLanguage === "taglish") return `May nakita akong ${total} current ${label} listing${total === 1 ? "" : "s"}. The rate starts at PHP ${formattedRate} per ${unitLabel}; the exact total still depends on the schedule and booking details.`;
    return `I found ${total} current ${label} listing${total === 1 ? "" : "s"}. The rate starts at PHP ${formattedRate} per ${unitLabel}; the exact total still depends on the schedule and booking details.`;
  }

  if (selectedLanguage === "filipino") return `May nakita akong ${total} kasalukuyang listahan ng ${label} sa RentifyPro. Mga katugmang listahan pa lamang ito; ibigay ang petsa at oras ng pagkuha at pagbabalik upang makumpirma kung maaari itong rentahan sa iskedyul mo.`;
  if (selectedLanguage === "taglish") return `May nakita akong ${total} current RentifyPro ${label} listing${total === 1 ? "" : "s"}. Listing matches ito; provide your pickup and return schedule to confirm availability for your dates.`;
  return `I found ${total} current RentifyPro ${label} listing${total === 1 ? "" : "s"}. These are listing matches; provide your pickup and return schedule to confirm availability for your dates.`;
}

function describeVehicleFilters(slots, language = "english") {
  const filipino = normalizeLanguage(language) === "filipino";
  const unit = filipino ? (slots.rateUnit === "day" ? "araw" : "oras") : slots.rateUnit;
  return [filipino ? mapVehicleTypeLabel(slots.type, language) : slots.type, slots.brand, slots.model, slots.vehicle_subtype,
    slots.transmission ? `${slots.transmission} transmission` : "",
    slots.fuel ? `${filipino ? "uri ng fuel" : "fuel"}: ${slots.fuel}` : "",
    slots.driver_requested === true ? (filipino ? "may optional na driver" : "optional driver available") : slots.self_drive_only ? (filipino ? "self-drive lamang" : "self-drive only") : slots.driver_requested === false ? "self-drive" : "",
    slots.location ? `${filipino ? "lugar" : "location"}: ${slots.location}` : "",
    slots.pax ? (filipino ? `${slots.seat_match === "exact" ? "eksaktong" : "hindi bababa sa"} ${slots.pax} upuan` : slots.seat_match === "exact" ? `exactly ${slots.pax} seats` : `minimum seats: ${slots.pax}`) : "",
    slots.budget ? `budget: PHP ${slots.budget.toLocaleString("en-PH")} ${filipino ? "bawat" : "per"} ${unit}` : "",
    slots.excluded_brands?.length ? `${filipino ? "hindi kasamang brand" : "excluded brands"}: ${slots.excluded_brands.join(", ")}` : "",
    slots.excluded_transmissions?.length ? `${filipino ? "hindi kasamang transmission" : "excluded transmissions"}: ${slots.excluded_transmissions.join(", ")}` : "",
    slots.excluded_fuels?.length ? `${filipino ? "hindi kasamang fuel" : "excluded fuels"}: ${slots.excluded_fuels.join(", ")}` : "",
    slots.excluded_subtypes?.length ? `${filipino ? "hindi kasamang subtype" : "excluded subtypes"}: ${slots.excluded_subtypes.join(", ")}` : "",
    slots.listing_id ? (filipino ? "napiling listing" : "selected listing") : ""].filter(Boolean).join("; ");
}

function buildVehicleSearchExplanation(language, payload, recommendations) {
  const filters = describeVehicleFilters(payload.slots, language);
  const reason = /\b(?:why|bakit)\b/u.test(payload.normalizedMessage);
  const criteria = filters || ({ english: "current available vehicles", filipino: "kasalukuyang available na sasakyan", taglish: "current available vehicles" })[language];
  const intro = {
    english: reason ? `The search required these filters: ${criteria}.` : `I meant that I checked the current available listings using these filters: ${criteria}.`,
    filipino: reason ? `Ito ang mga filter na kailangan sa paghahanap: ${criteria}.` : `Ang ibig kong sabihin, sinuri ko ang kasalukuyang available na listings gamit ang mga filter na ito: ${criteria}.`,
    taglish: reason ? `The search required these filters: ${criteria}.` : `Ang ibig kong sabihin, I checked the current available listings with these filters: ${criteria}.`,
  }[language];
  if (!recommendations.length) return `${intro} ${({
    english: "None of the current available listings match all those filters. This is a result for this search, rather than a general restriction on supported vehicle types or transmissions.",
    filipino: "Walang kasalukuyang available na listing na tugma sa lahat ng filter na iyon. Resulta ito ng paghahanap na ito, hindi pangkalahatang limitasyon sa uri ng sasakyan o transmission.",
    taglish: "Walang current available listing na match sa lahat ng filters na iyon. Result ito ng search na ito, hindi general restriction sa vehicle types or transmissions.",
  })[language]}`;
  const total = payload.vehicles.length;
  const names = joinNaturalList(recommendations.map(vehicle => vehicle.name), language);
  return `${intro} ${({
    english: `I found ${total} matching available listing${total === 1 ? "" : "s"}. The results shown are ${names}. Confirm your pickup and return schedule and the owner's approval before booking.`,
    filipino: `May ${total} available na listing na tugma. Ang ipinapakitang mga resulta ay ${names}. Kumpirmahin ang pickup at return schedule at owner approval bago mag-book.`,
    taglish: `May ${total} matching available listing${total === 1 ? "" : "s"}. Shown results: ${names}. Confirm your pickup and return schedule and owner approval before booking.`,
  })[language]}`;
}

function buildRecommendationReply(intent, language, payload, recommendations, answerType) {
  const selectedLanguage = normalizeLanguage(language);
  const specificationFilters = Boolean(payload.slots.pax || payload.slots.transmission || payload.slots.fuel
    || payload.slots.excluded_fuels?.length || payload.slots.vehicle_subtype || payload.slots.excluded_subtypes?.length || Object.hasOwn(payload.slots, "driver_requested"));
  if (answerType === "explanation") return buildVehicleSearchExplanation(selectedLanguage, payload, recommendations);
  if (payload.slots.brand && !specificationFilters && ["vehicle_brand_search", "rental_rate", "available_vehicles", "available_transmission", "passenger_capacity"].includes(intent)) {
    return buildBrandSearchReply(intent, selectedLanguage, payload, recommendations);
  }
  if (!recommendations.length) {
    const specifications = describeVehicleFilters(payload.slots, selectedLanguage).replace(`minimum seats: ${payload.slots.pax}`, `${payload.slots.pax}-seat minimum`)
      + (payload.slots.seat_match === "exact" && selectedLanguage !== "filipino" ? ` (${payload.slots.pax}-seat requirement)` : "");
    if (specificationFilters) return ({
      english: `I couldn't find an available listing matching all these filters: ${specifications}. You can change a filter to search again.`,
      filipino: `Wala akong mahanap na available na listing na tugma sa lahat ng filter na ito: ${specifications}. Maaari kang magbago ng filter para maghanap muli.`,
      taglish: `Walang available listing na match sa lahat ng filters na ito: ${specifications}. You can change a filter to search again.`,
    })[selectedLanguage];
    const category = { car: "car", truck: "truck", sedan: "sedan", suv: "SUV", van: "van", pickup: "pickup truck", motorcycle: "motorcycle" }[payload.slots.type];
    const details = category ? {
      english: ` No current available ${category} listing matches${payload.slots.pax ? ` the ${payload.slots.pax}-seat minimum and` : ""} your filters${payload.slots.vehicle_subtype ? ` (subtype: ${payload.slots.vehicle_subtype})` : ""}.`,
      filipino: ` Walang available na ${category} listing na tugma sa${payload.slots.pax ? ` minimum na ${payload.slots.pax} upuan at` : ""} filters mo${payload.slots.vehicle_subtype ? ` (subtype: ${payload.slots.vehicle_subtype})` : ""}.`,
      taglish: ` Walang current available ${category} listing na match sa${payload.slots.pax ? ` ${payload.slots.pax}-seat minimum and` : ""} your filters${payload.slots.vehicle_subtype ? ` (subtype: ${payload.slots.vehicle_subtype})` : ""}.`,
    }[selectedLanguage] : "";
    if (selectedLanguage === "filipino") return `Wala akong mahanap na available na sasakyan na tugma sa request mo.${details} Maaari kang magbago ng filter para maghanap muli.`;
    if (selectedLanguage === "taglish") return `Wala akong mahanap na available na sasakyan na match sa request mo.${details} You can change a filter to search again.`;
    return `I couldn't find an available vehicle that matches your request.${details} You can change a filter to search again.`;
  }
  if (payload.slots.sort_by === "lowest_price") {
    const unit = payload.slots.rateUnit === "hour" ? "hour" : "day";
    const rates = recommendations.map((vehicle) => `${vehicle.name}: PHP ${vehicle[unit === "day" ? "dailyRate" : "hourlyRate"].toLocaleString("en-PH", { maximumFractionDigits: 2 })} ${selectedLanguage === "filipino" ? `bawat ${unit === "day" ? "araw" : "oras"}` : `per ${unit}`}`).join("; ");
    const equivalents = recommendations.some((vehicle) => vehicle.pricingUnit === "hourly") && unit === "day";
    return ({
      english: `Lowest matching rental rates: ${rates}.${equivalents ? " Day prices for hourly listings are 24-hour equivalents." : ""} These are current listings; confirm your pickup and return schedule before booking.`,
      filipino: `Pinakamababang katugmang rate: ${rates}.${equivalents ? " Ang presyo bawat araw ng hourly listings ay katumbas ng 24 oras." : ""} Kasalukuyang listings ito; kumpirmahin ang pickup at return schedule bago mag-book.`,
      taglish: `Pinakamurang matching rentals: ${rates}.${equivalents ? " Day prices for hourly listings are 24-hour equivalents." : ""} Current listings ito; confirm your pickup and return schedule before booking.`,
    })[selectedLanguage];
  }
  if (specificationFilters) {
    const unit = payload.slots.rateUnit === "day" ? "day" : "hour";
    const matches = recommendations.map(vehicle => `${vehicle.name}: PHP ${vehicle[unit === "day" ? "dailyRate" : "hourlyRate"].toLocaleString("en-PH", { maximumFractionDigits: 2 })} ${selectedLanguage === "filipino" ? `bawat ${unit === "day" ? "araw" : "oras"}` : `per ${unit}`}`).join("; ");
    const driver = payload.slots.driver_requested ? ({
      english: " Driver service is optional; the shown vehicle rates do not include its additional charge.",
      filipino: " Optional ang driver; hindi kasama ang dagdag na bayad nito sa ipinapakitang vehicle rates.",
      taglish: " Optional ang driver; shown vehicle rates exclude its additional charge.",
    })[selectedLanguage] : "";
    return ({
      english: `I found ${payload.vehicles.length} available listing${payload.vehicles.length === 1 ? "" : "s"} matching these filters: ${describeVehicleFilters(payload.slots, selectedLanguage)}. Shown matches: ${matches}.${driver} Confirm your pickup and return schedule before booking.`,
      filipino: `May ${payload.vehicles.length} available na listing na tugma sa mga filter na ito: ${describeVehicleFilters(payload.slots, selectedLanguage)}. Mga resulta: ${matches}.${driver} Kumpirmahin ang pickup at return schedule bago mag-book.`,
      taglish: `May ${payload.vehicles.length} available listing${payload.vehicles.length === 1 ? "" : "s"} na match sa filters na ito: ${describeVehicleFilters(payload.slots, selectedLanguage)}. Shown matches: ${matches}.${driver} Confirm pickup and return schedule before booking.`,
    })[selectedLanguage];
  }
  if (intent === "available_vehicles" && payload.slots.budget && payload.slots.rateUnit) {
    const unit = payload.slots.rateUnit;
    const amount = Number(payload.slots.budget).toLocaleString("en-PH", { maximumFractionDigits: 2 });
    const criteria = [payload.slots.brand, payload.slots.model,
      payload.slots.type ? mapVehicleTypeLabel(payload.slots.type, selectedLanguage) : ""].filter(Boolean).join(" ");
    const matching = criteria ? ` matching ${criteria}` : "";
    if (selectedLanguage === "filipino") return `May ${payload.vehicles.length} kasalukuyang listing${matching} na hindi lalampas sa PHP ${amount} bawat ${unit === "day" ? "araw" : "oras"}. Ibigay ang pickup at return schedule para ma-check ang availability sa mga petsa mo.`;
    if (selectedLanguage === "taglish") return `May ${payload.vehicles.length} current listing${payload.vehicles.length === 1 ? "" : "s"}${matching} under PHP ${amount} per ${unit}. Provide your pickup and return schedule to check availability for your dates.`;
    return `I found ${payload.vehicles.length} current listing${payload.vehicles.length === 1 ? "" : "s"}${matching} under PHP ${amount} per ${unit}. Provide your pickup and return schedule to check availability for your dates.`;
  }
  if (intent !== "available_vehicles") {
    const base = getCanonicalAnswer(intent, selectedLanguage);
    const suffix = selectedLanguage === "filipino"
      ? "Narito ang mga pinakamalapit na available na sasakyan."
      : "Here are the closest available vehicles.";
    return `${base} ${suffix}`.trim();
  }

  const total = payload.vehicles.length;
  const typeSummary = summarizeAvailableTypes(payload.vehicles, selectedLanguage);
  const preview = total > recommendations.length
    ? selectedLanguage === "filipino"
      ? ` Ipinapakita ang unang ${recommendations.length} ayon sa tugma at presyo.`
      : ` Showing the first ${recommendations.length} by match and price.`
    : "";
  if (selectedLanguage === "filipino") return `May ${total} available na sasakyan ngayon.${typeSummary ? ` Mga uri: ${typeSummary}.` : ""}${preview}`.trim();
  if (selectedLanguage === "taglish") return `May ${total} available vehicle${total === 1 ? "" : "s"} right now.${typeSummary ? ` Available types: ${typeSummary}.` : ""}${preview}`.trim();
  return `There ${total === 1 ? "is" : "are"} ${total} available vehicle${total === 1 ? "" : "s"} right now.${typeSummary ? ` Available types: ${typeSummary}.` : ""}${preview}`.trim();
}

export function validateChatbotInput(message = "") {
  const rawMessage = String(message ?? "");
  const trimmedMessage = rawMessage.trim();
  if (!trimmedMessage) return { isValid: false, reason: "empty", message: "", maxLength: CHATBOT_MAX_INPUT_LENGTH };
  if (rawMessage.length > CHATBOT_MAX_INPUT_LENGTH) return { isValid: false, reason: "too_long", message: trimmedMessage, maxLength: CHATBOT_MAX_INPUT_LENGTH };
  if (containsModeratedContent(trimmedMessage)) return { isValid: false, reason: "profanity", message: trimmedMessage, maxLength: CHATBOT_MAX_INPUT_LENGTH };
  if (UNSUPPORTED_CONTROL_CHARACTERS.test(rawMessage)) return { isValid: false, reason: "invalid_characters", message: trimmedMessage, maxLength: CHATBOT_MAX_INPUT_LENGTH };
  return {
    isValid: true,
    reason: "",
    message: cleanText(trimmedMessage),
    normalizedMessage: normalizeText(trimmedMessage),
    maxLength: CHATBOT_MAX_INPUT_LENGTH,
  };
}

export function buildChatbotPayload(message, language, vehicles = [], entities = null, filterDriverOptions = false, vocabulary = buildChatbotInventoryVocabulary(vehicles)) {
  const originalMessage = cleanText(message);
  const selectedLanguage = resolveSelectedLanguage(language, originalMessage);
  const normalizedEntities = normalizeVehicleEntities(entities, vocabulary);
  const extracted = extractSlots(originalMessage);
  const classifierEntities = normalizedEntities.valid ? normalizedEntities.value : { brand: null, model: null };
  const initialSlots = {
    ...extracted,
    ...classifierEntities,
    type: classifierEntities.category || (entities ? "" : extracted.type),
    budget: Object.hasOwn(classifierEntities, "max_budget") ? classifierEntities.max_budget : entities ? null : extracted.budget,
    rateUnit: classifierEntities.rate_unit || (classifierEntities.sort_by === "lowest_price" ? "day" : null),
    transmission: classifierEntities.transmission || (entities ? "" : extracted.transmission),
    pax: classifierEntities.pax || (entities ? null : extracted.pax),
  };
  const liveVehiclePayload = filterVehiclesForChatbot(vehicles, initialSlots, true, filterDriverOptions);
  return {
    selectedLanguage,
    originalMessage,
    normalizedMessage: normalizeText(originalMessage),
    slots: liveVehiclePayload.slots,
    vehicles: liveVehiclePayload.vehicles,
    modelCandidates: liveVehiclePayload.modelCandidates,
    inventoryMatches: filterVehiclesForChatbot(vehicles, initialSlots, false, filterDriverOptions).vehicles,
    rawVehicles: vehicles,
    inventoryVocabulary: vocabulary,
  };
}

function fulfillRentalPrice(normalized, payload, language) {
  const entities = normalized.entities;
  const recommendations = payload.vehicles.slice(0, TOP_RECOMMENDATIONS);
  const pick = (en, fil, taglish) => ({ english: en, filipino: fil, taglish })[language];
  const clarify = (field, reply) => ({ reply, recommendations, requires_clarification: true,
    clarification: { required: true, type: field === "model" ? "ambiguous_entity" : "missing_entity", field },
    reason_code: `quote_missing_${field}`, requires_live_data: true });
  if (!hasSignalSlots(payload.slots) && !entities.quote_requested && !entities.duration_value && !Object.hasOwn(entities, "driver_requested")) {
    return { recommendations: [], reply: pick(
      "Which vehicle's rate would you like to check? Give its listing name and say per hour or per day; prices depend on the current listing.",
      "Aling sasakyan ang gusto mong malaman ang rate? Ibigay ang listing name at kung bawat oras o araw; batay sa kasalukuyang listing ang presyo.",
      "Aling vehicle rate ang gusto mong malaman? Give its listing name and say per hour or per day; prices depend on the current listing.") };
  }
  if (!payload.vehicles.length) {
    const matches = payload.inventoryMatches || [];
    const label = [entities.brand, entities.model, entities.category].filter(Boolean).join(" ") || "vehicle";
    if (matches.length) {
      const unavailable = matches.every((vehicle) => !vehicle.isAvailable);
      return { recommendations: [], reason_code: unavailable ? "price_listing_unavailable" : "price_not_verified",
        reply: unavailable
          ? pick(`Matching ${label} listings exist but are currently unavailable. I can't confirm future availability; check with the owner or choose another listing.`,
            `May katugmang ${label} listing pero unavailable ito ngayon. Hindi ko makukumpirma ang future availability; magtanong sa owner o pumili ng ibang listing.`,
            `May matching ${label} listings pero currently unavailable. I can't confirm future availability; check with the owner or choose another listing.`)
          : pick(`I found a matching ${label} listing, but its rental rate is not verified. Check the vehicle page or ask the owner.`,
            `May katugmang ${label} listing pero hindi ma-verify ang rate. Tingnan ang vehicle page o magtanong sa owner.`,
            `May matching ${label} listing pero hindi verified ang rate. Check the vehicle page or ask the owner.`) };
    }
    const identityMatches = entities.brand && filterVehiclesForChatbot(payload.rawVehicles, { brand: entities.brand, model: entities.model }, false).vehicles.length;
    return { recommendations: [], reason_code: identityMatches ? "price_filters_unmatched" : "price_listing_not_found",
      reply: identityMatches
        ? pick(`Current ${label} listings exist, but none matches all your filters. You can change a filter to search again.`,
          `May kasalukuyang ${label} listings pero walang tugma sa lahat ng filters mo. Maaari kang magbago ng filter.`,
          `May current ${label} listings, pero none matches all your filters. You can change a filter to search again.`)
        : pick(`I couldn't find a current ${label} listing matching your search, so I can't give a verified price. Try another model or change a filter.`,
          `Wala akong nakitang kasalukuyang ${label} listing na tugma, kaya hindi ako makapagbibigay ng verified na presyo. Subukan ang ibang model o filter.`,
          `Wala akong nakitang current ${label} listing na match, so I can't give a verified price. Try another model or change a filter.`) };
  }
  const wantsQuote = entities.quote_requested === true || (entities.duration_value && entities.quote_requested !== false);
  const hasScheduleDuration = entities.requested_date && entities.requested_return_date && entities.pickup_time && entities.return_time;
  const wantsDriver = Object.hasOwn(entities, "driver_requested");
  const selected = (entities.listing_id || entities.model) && payload.vehicles.length === 1;
  if ((wantsQuote || wantsDriver) && !selected) return clarify("model", pick(
    "Which listing should I quote? Choose a matching vehicle below or give its full listing name.",
    "Aling listing ang gusto mong ipa-quote? Pumili sa katugmang sasakyan o ibigay ang buong pangalan ng listing.",
    "Aling listing ang gusto mong ipa-quote? Choose a matching vehicle below or give its full listing name."));
  if (wantsQuote && !entities.duration_value && !hasScheduleDuration) return clarify("duration", pick(
    "For how many hours or days should I quote this listing?", "Ilang oras o araw ang ipapa-quote mo?", "Ilang hours or days ang ipapa-quote mo?"));
  if (wantsQuote && !getChatbotQuoteDurationMinutes(entities)) return clarify("duration", pick(
    "Please confirm the rental duration and pickup/return dates and times. The supplied schedule or duration is invalid or conflicts with the other details.",
    "Kumpirmahin ang tagal ng renta at pickup/return dates at oras. Hindi valid ang schedule o tagal, o hindi ito tugma sa ibang detalye.",
    "Please confirm the rental duration and pickup/return dates and times. Hindi valid o hindi tugma ang supplied details."));
  if (selected && (wantsQuote || wantsDriver)) {
    const vehicle = payload.rawVehicles.find((record) => String(record._id) === payload.vehicles[0]._id);
    if (entities.driver_requested && vehicle.driverOptionEnabled !== true) return clarify("driver", pick(
      "This listing does not offer a driver. Would you like a quotation without a driver?",
      "Walang driver option ang listing na ito. Gusto mo ba ng quote na walang driver?",
      "This listing has no driver option. Gusto mo ba ng quote without a driver?"));
    if (wantsQuote) {
      const quote = getChatbotRentalQuote(vehicle, entities);
      if (!quote) return { reply: pick("I can't verify the required rates for this quotation. Check the listing or ask the owner.",
        "Hindi ko ma-verify ang kailangang rate para sa quote. Tingnan ang listing o magtanong sa owner.",
        "I can't verify the required rates for this quote. Check the listing or ask the owner."), recommendations: [], reason_code: "quote_rate_not_verified" };
      const amount = quote.rentalSubtotal.toLocaleString("en-PH", { maximumFractionDigits: 2 });
      const duration = entities.duration_value
        ? `${entities.duration_value} ${entities.duration_unit}${entities.duration_value === 1 ? "" : "s"}`
        : `${quote.durationHours} hours (${entities.requested_date} ${entities.pickup_time} to ${entities.requested_return_date} ${entities.return_time}, Asia/Manila)`;
      const driver = entities.driver_requested ? pick(`, including PHP ${quote.driverCharge.toLocaleString("en-PH")} for the driver`, `, kasama ang PHP ${quote.driverCharge.toLocaleString("en-PH")} para sa driver`, `, including PHP ${quote.driverCharge.toLocaleString("en-PH")} for the driver`) : pick(", without a driver", ", walang driver", ", without a driver");
      return { quote, recommendations, reason_code: "verified_rental_quote", reply: pick(
        `${payload.vehicles[0].name} for ${duration}: rental subtotal PHP ${amount}${driver}. This estimate uses the booking's hourly-rate calculation; it excludes checkout fees and is not a confirmed booking or payment due.`,
        `${payload.vehicles[0].name} para sa ${duration}: rental subtotal PHP ${amount}${driver}. Batay ito sa hourly-rate calculation ng booking; hindi kasama ang checkout fees at hindi ito kumpirmadong booking o halagang dapat bayaran.`,
        `${payload.vehicles[0].name} for ${duration}: rental subtotal PHP ${amount}${driver}. Based ito sa booking hourly-rate calculation; checkout fees are excluded. Hindi ito confirmed booking or payment due.`) };
    }
    if (entities.driver_requested && toNonNegativeNumber(vehicle.driverDailyRate) === null) return { reply: pick(
      "The listing's driver rate is not verified. Ask the owner before requesting a quote.",
      "Hindi verified ang driver rate. Magtanong sa owner bago magpa-quote.",
      "Hindi verified ang driver rate. Ask the owner before requesting a quote."), recommendations: [], reason_code: "quote_rate_not_verified" };
    const unit = entities.rate_unit === "day" ? "day" : "hour";
    const baseHourly = getVehicleHourlyRate(vehicle);
    const driverHourly = entities.driver_requested ? getVehicleHourlyRate(vehicle, { rateField: "driverDailyRate" }) : 0;
    const rate = roundCurrency((baseHourly + driverHourly) * (unit === "day" ? 24 : 1));
    return { recommendations, reason_code: "verified_driver_rate", reply: pick(
      `${payload.vehicles[0].name}: PHP ${rate.toLocaleString("en-PH")} per ${unit}, ${entities.driver_requested ? "with" : "without"} a driver. Give the rental duration for a subtotal; checkout fees are excluded.`,
      `${payload.vehicles[0].name}: PHP ${rate.toLocaleString("en-PH")} bawat ${unit === "day" ? "araw" : "oras"}, ${entities.driver_requested ? "may" : "walang"} driver. Ibigay ang tagal para sa subtotal; hindi kasama ang checkout fees.`,
      `${payload.vehicles[0].name}: PHP ${rate.toLocaleString("en-PH")} per ${unit}, ${entities.driver_requested ? "with" : "without"} a driver. Give the rental duration for a subtotal; checkout fees are excluded.`) };
  }
  if (entities.brand) return { recommendations, reply: buildBrandSearchReply("rental_rate", language, payload, recommendations) };
  const unit = entities.rate_unit === "day" ? "day" : "hour";
  const rates = recommendations.map((vehicle) => `${vehicle.name}: PHP ${vehicle[unit === "day" ? "dailyRate" : "hourlyRate"].toLocaleString("en-PH", { maximumFractionDigits: 2 })} per ${unit}`).join("; ");
  return { recommendations, reply: pick(`Current matching rates: ${rates}. Choose a listing and give the rental duration for a quotation.`,
    `Mga katugmang rate ngayon: ${rates}. Pumili ng listing at ibigay ang tagal ng renta para sa quote.`,
    `Current matching rates: ${rates}. Choose a listing and give the rental duration para sa quote.`) };
}

export function normalizeChatbotResponse(response, fallbackLanguage = DEFAULT_LANGUAGE, depth = 0, vocabulary = {}) {
  if (!response || typeof response !== "object") {
    return { valid: false, intent: "REJECT", score: 0, reply: "", alternatives: [], recommendations: [] };
  }
  if (response.valid === false) {
    return { ...response, valid: false };
  }
  const intent = cleanText(response.intent || response.intent_id || "REJECT");
  const score = Number(response.confidence ?? response.score);
  const language = normalizeClassifierLanguage(response.language || response.reply_style || response.reply_lang, fallbackLanguage);
  const rawAlternatives = Array.isArray(response.alternatives) ? response.alternatives : [];
  const alternatives = rawAlternatives.map(normalizeAlternative);
  const alternativesValid = (response.alternatives === undefined || Array.isArray(response.alternatives))
    && rawAlternatives.length <= TOP_RECOMMENDATIONS && alternatives.every(Boolean);
  const normalizedEntities = normalizeVehicleEntities(response.entities, vocabulary);
  const normalizedConditions = normalizeConditions(response.conditions);
  const clarification = normalizeClarification(response.clarification, Boolean(response.requires_clarification));
  const intentValid = intent === "REJECT" || Boolean(getIntent(intent));
  const scoreValid = Number.isFinite(score) && score >= 0 && score <= 1;
  const scoreTypeValid = typeof (response.confidence ?? response.score) === "number";
  const clarificationTypeValid = response.requires_clarification === undefined || typeof response.requires_clarification === "boolean";
  const rawLanguage = response.language ?? response.reply_style ?? response.reply_lang;
  const languageValid = SUPPORTED_REPLY_STYLES.has(language) && (rawLanguage === undefined
    || (typeof rawLanguage === "string" && (SUPPORTED_LANGUAGES.has(rawLanguage.toLowerCase())
      || Object.hasOwn(LANGUAGE_NAME_BY_CODE, rawLanguage.toLowerCase()))));
  const rawAdditional = response.additional_answers ?? [];
  const additional = Array.isArray(rawAdditional) && rawAdditional.length <= 2 && (depth === 0 || rawAdditional.length === 0)
    ? rawAdditional.map((item) => normalizeChatbotResponse(item, language, depth + 1, vocabulary)) : null;
  const questionValid = response.question == null || (typeof response.question === "string" && response.question.length <= CHATBOT_MAX_INPUT_LENGTH);
  const suggestionValid = response.suggested_brand == null || vocabularyBrands(vocabulary).includes(response.suggested_brand);
  const rawPredictions = response.top_preds ?? [];
  const predictionsValid = Array.isArray(rawPredictions) && rawPredictions.length <= Number(chatbotConfig.top_predictions)
    && rawPredictions.every((item) => item && typeof item === "object" && getIntent(item.intent_id || item.id)
      && typeof item.score === "number" && Number.isFinite(item.score) && item.score >= 0 && item.score <= 1);
  const metadata = normalizeConversationTopic(response, intent);
  const allowedFields = new Set(["valid", "intent", "intent_id", "score", "confidence", "language", "reply_style", "reply_lang", "reply",
    "alternatives", "top_preds", "entities", "conditions", "clarification", "requires_clarification", "requires_live_data", "live_source",
    "matched_alias", "reason_code", "decision_reason", "topic", "candidate_intents", "suggested_brand", "additional_answers", "question",
    "response_variant", "requested_answer_type", "recommendations", "status_choices", "inventory_vocabulary_requested"]);
  const fieldsValid = Object.keys(response).every((key) => allowedFields.has(key))
    && (response.reply === undefined || (typeof response.reply === "string" && response.reply.length <= 4000))
    && (response.requires_live_data === undefined || typeof response.requires_live_data === "boolean")
    && (response.inventory_vocabulary_requested === undefined || (typeof response.inventory_vocabulary_requested === "boolean"
      && CONVERSATIONAL_INTENTS.has(intent)));
  const valid = intentValid && scoreValid && scoreTypeValid && clarificationTypeValid && languageValid && alternativesValid
    && normalizedEntities.valid && normalizedConditions.valid && clarification.valid
    && questionValid && suggestionValid && predictionsValid && metadata.valid && validResponseVariant(intent, response.response_variant)
    && fieldsValid && validRequestedAnswerType(response.requested_answer_type) && additional !== null && additional.every((item) => item.valid);
  return {
    valid,
    ...(valid && response.inventory_vocabulary_requested ? { inventory_vocabulary_requested: true } : {}),
    ...(valid && response.response_variant ? { response_variant: response.response_variant } : {}),
    ...(valid && response.requested_answer_type ? { requested_answer_type: response.requested_answer_type } : {}),
    ...(response.question !== undefined && questionValid ? { question: response.question } : {}),
    ...(response.suggested_brand && suggestionValid ? { suggested_brand: response.suggested_brand } : {}),
    intent: valid ? intent : "REJECT",
    intent_id: valid ? intent : "REJECT",
    score: scoreValid ? score : 0,
    confidence: scoreValid ? score : 0,
    language,
    reply_lang: language,
    reply: cleanText(response.reply),
    alternatives: alternatives.filter(Boolean),
    top_preds: predictionsValid ? rawPredictions.map((item) => ({ intent_id: item.intent_id || item.id, id: item.intent_id || item.id, score: item.score })) : [],
    requires_live_data: Boolean(getIntent(intent)?.requires_live_data),
    live_source: cleanText(getIntent(intent)?.live_source),
    recommendations: [],
    status_choices: [],
    requires_clarification: Boolean(response.requires_clarification),
    reason_code: cleanText(response.reason_code || response.decision_reason),
    matched_alias: cleanText(response.matched_alias),
    entities: normalizedEntities.value,
    conditions: normalizedConditions.value,
    clarification: clarification.value,
    topic: metadata.topic,
    candidate_intents: metadata.candidate_intents,
    additional_answers: additional || [],
  };
}

export function buildRejectedChatbotResponse(language, reason = "fallback", reply = "") {
  const selectedLanguage = resolveSelectedLanguage(language, language);
  return {
    reply: cleanText(reply) || REJECT_REPLIES[selectedLanguage]?.[reason] || FALLBACK_REPLIES[selectedLanguage],
    intent: "REJECT",
    intent_id: "REJECT",
    language: getLanguageCode(selectedLanguage),
    reply_lang: getLanguageCode(selectedLanguage),
    score: 0,
    confidence: 0,
    alternatives: [],
    top_preds: [],
    recommendations: [],
    requires_clarification: reason === "clarification",
    reason_code: reason,
    entities: { brand: null, model: null },
    conditions: {},
    clarification: { required: reason === "clarification", type: reason === "clarification" ? "unknown_intent" : null, field: null },
  };
}

function fulfillListingSpecification(normalized, payload) {
  const language = normalized.language;
  const pick = (en, fil, taglish) => ({ en, fil, taglish })[language];
  const cards = payload.vehicles.slice(0, TOP_RECOMMENDATIONS).map(vehicle => ({ ...vehicle,
    displayRate: vehicle.hourlyRate, displayRateUnit: "hour" }));
  const clarify = reply => ({ ...normalized, reply, recommendations: cards,
    requires_clarification: true, clarification: { required: true, type: "ambiguous_entity", field: "model" } });
  if (payload.vehicles.length !== 1) return clarify(payload.vehicles.length
    ? pick("Multiple current listings match that name. Which listing do you mean? Choose a shown option.",
        "May higit sa isang listing na tugma sa pangalan. Aling listing ang tinutukoy mo? Pumili sa mga resulta.",
        "Multiple listings match that name. Which listing ang tinutukoy mo? Choose a shown option.")
    : pick("I couldn't identify that listing in the current available results. Give the exact listing name or choose a current result.",
        "Hindi ko matukoy ang listing sa kasalukuyang available results. Ibigay ang eksaktong pangalan o pumili sa mga resulta.",
        "I couldn't identify that listing sa current available results. Give the exact listing name or choose a result."));
  const vehicle = payload.vehicles[0];
  const field = normalized.entities.specification_requested;
  const unknown = pick("not recorded", "hindi nakatala", "not recorded");
  let detail;
  if (field === "seats") detail = `${vehicle.seats || unknown}${vehicle.seats ? " seats" : ""}`;
  if (field === "fuel") detail = `fuel: ${vehicle.fuel || unknown}`;
  if (field === "transmission") detail = `transmission: ${vehicle.transmission || unknown}`;
  if (field === "subtype") detail = `type/subtype: ${vehicle.type || unknown}${vehicle.subtype ? ` / ${vehicle.subtype}` : ""}`;
  if (field === "driver") detail = typeof vehicle.driverOptionEnabled !== "boolean" ? `driver option: ${unknown}`
    : vehicle.driverOptionEnabled ? pick("an optional driver is available", "may optional driver", "may optional driver")
      : pick("self-drive only; no optional driver recorded", "self-drive lamang; walang nakatalang optional driver", "self-drive only; walang optional driver recorded");
  if (field === "self_drive") detail = typeof vehicle.driverOptionEnabled !== "boolean" ? `self-drive option: ${unknown}`
    : pick("self-drive is allowed", "puwedeng self-drive", "puwede ang self-drive");
  const inclusion = ["driver", "self_drive"].includes(field) ? pick(
    " Driver inclusion in the advertised vehicle rate is not recorded; optional driver service has a separate charge.",
    " Hindi nakatala na kasama ang driver sa vehicle rate; hiwalay ang bayad sa optional driver.",
    " Driver inclusion in the vehicle rate is not recorded; may separate charge ang optional driver.") : "";
  return { ...normalized, reply: `${vehicle.name}: ${detail}.${inclusion}`, recommendations: cards,
    requires_clarification: false, clarification: { required: false, type: null, field: null } };
}

export function applyChatbotGuardrails(response, payload) {
  const normalized = normalizeChatbotResponse(response, payload.selectedLanguage, 0, payload.inventoryVocabulary);
  if (!normalized.valid) return buildRejectedChatbotResponse(payload.selectedLanguage, "malformed_classifier");
  if (normalized.entities.driver_included_required && !normalized.entities.specification_requested && !normalized.requires_clarification) {
    const replies = {
      en: "I cannot verify a driver included in the advertised price: that information is not recorded. Listings may offer an optional driver with a separate charge. Would you like to search for optional-driver listings?",
      fil: "Hindi ko makukumpirma na kasama ang driver sa advertised price dahil hindi ito nakatala. Maaaring may optional driver na may hiwalay na bayad. Gusto mo bang hanapin ang listings na may optional driver?",
      taglish: "I cannot verify a driver included in the advertised price; hindi ito recorded. Listings may offer an optional driver with a separate charge. Search for optional-driver listings ba?",
    };
    return { ...normalized, reply: replies[normalized.language], recommendations: [], requires_live_data: false };
  }
  if (normalized.entities.specification_requested && !normalized.requires_clarification) {
    return fulfillListingSpecification(normalized, payload);
  }
  if (normalized.reason_code === "conflicting_vehicle_specifications" && normalized.requires_clarification) {
    const prompts = {
      transmission: { en: "Which transmission do you want: automatic or manual?", fil: "Anong transmission ang gusto mo: automatic o manual?", taglish: "Which transmission ang gusto mo: automatic or manual?" },
      fuel: { en: "Which fuel type should I search for: gasoline, diesel, electric, or hybrid?", fil: "Anong fuel type ang hahanapin ko: gasoline, diesel, electric, o hybrid?", taglish: "Which fuel type ang ise-search ko: gasoline, diesel, electric, or hybrid?" },
      driver: { en: "Do you want a rental with an optional driver, or to drive it yourself?", fil: "Gusto mo ba ng rental na may optional driver o ikaw ang magmamaneho?", taglish: "With an optional driver ba ang rental, or self-drive?" },
    };
    if (prompts[normalized.clarification.field]) return { ...normalized, reply: prompts[normalized.clarification.field][normalized.language], recommendations: [], requires_live_data: false };
  }
  if ((RECOMMENDATION_INTENTS.has(normalized.intent) || normalized.entities.self_drive_only)
    && Object.hasOwn(normalized.entities, "driver_requested")) {
    payload = buildChatbotPayload(payload.originalMessage, payload.selectedLanguage, payload.rawVehicles, normalized.entities, true);
  }
  if (isChatbotVehicleGuidance(normalized) && !normalized.requires_clarification) {
    return { ...normalized, reply: getCanonicalAnswer(normalized.intent, LANGUAGE_NAME_BY_CODE[normalized.language], normalized.response_variant),
      requires_live_data: false, live_source: "", recommendations: [] };
  }
  if ((RECOMMENDATION_INTENTS.has(normalized.intent) || ["rental_rate", "vehicle_availability_status"].includes(normalized.intent))
    && normalized.entities.max_budget && !normalized.entities.rate_unit) {
    const amount = normalized.entities.max_budget.toLocaleString("en-PH", { maximumFractionDigits: 2 });
    const reply = {
      en: `Is your PHP ${amount} budget per day or per hour?`,
      fil: `Ang PHP ${amount} budget mo ba ay bawat araw o bawat oras?`,
      taglish: `Yung PHP ${amount} budget mo ba ay per day or per hour?`,
    }[normalized.language];
    return { ...normalized, reply, recommendations: [], requires_clarification: true,
      clarification: { required: true, type: "missing_entity", field: "rate_unit" },
      requires_live_data: false, reason_code: "missing_rate_unit" };
  }
  if (normalized.intent === "vehicle_availability_status" && !normalized.entities.brand
    && !normalized.conditions.vehicle_status_overview
    && !(normalized.clarification?.field === "rate_unit" && normalized.entities.max_budget)) {
    const reply = getIntent(normalized.intent).clarification[normalized.language];
    return { ...normalized, reply, recommendations: [], requires_live_data: false,
      requires_clarification: true, reason_code: "missing_vehicle",
      clarification: { required: true, type: "missing_entity", field: "model" } };
  }
  if (normalized.intent !== "REJECT" && normalized.clarification?.type === "missing_entity") {
    return { ...normalized, reply: normalized.reply, recommendations: [], requires_live_data: false };
  }
  if (normalized.intent === "REJECT" || normalized.requires_clarification) {
    const rejected = buildRejectedChatbotResponse(
      LANGUAGE_NAME_BY_CODE[normalized.language] || payload.selectedLanguage,
      normalized.requires_clarification ? "clarification" : normalized.reason_code || "fallback",
      normalized.reply
    );
    return {
      ...rejected,
      score: normalized.score,
      confidence: normalized.confidence,
      alternatives: normalized.alternatives,
      top_preds: normalized.top_preds,
      reason_code: normalized.reason_code || rejected.reason_code,
      entities: normalized.entities,
      conditions: normalized.conditions,
      clarification: normalized.clarification,
      requires_clarification: normalized.requires_clarification,
      suggested_brand: normalized.suggested_brand,
      topic: normalized.topic,
      candidate_intents: normalized.candidate_intents,
      ...(normalized.requested_answer_type ? { requested_answer_type: normalized.requested_answer_type } : {}),
    };
  }

  const datasetIntent = getIntent(normalized.intent);
  const selectedLanguage = LANGUAGE_NAME_BY_CODE[normalized.language] || payload.selectedLanguage;
  if ((RECOMMENDATION_INTENTS.has(normalized.intent) || normalized.intent === "rental_rate")
    && payload.modelCandidates?.length > 1) {
    const models = joinNaturalList(payload.modelCandidates, selectedLanguage);
    const questions = {
      english: `I found similar current models: ${models}. Which model did you mean?`,
      filipino: `May magkahawig na kasalukuyang modelo: ${models}. Aling modelo ang tinutukoy mo?`,
      taglish: `May similar current models: ${models}. Which model did you mean?`,
    };
    return { ...normalized, reply: questions[selectedLanguage], recommendations: [],
      requires_clarification: true,
      clarification: { required: true, type: "ambiguous_entity", field: "model" },
      requires_live_data: false };
  }
  const canonicalReply = getCanonicalAnswer(normalized.intent, selectedLanguage, normalized.response_variant);
  let reply = normalized.response_variant ? canonicalReply : CONVERSATIONAL_INTENTS.has(normalized.intent)
    ? BRIEF_SOCIAL_INTENTS.has(normalized.intent)
      ? getIntentAnswers(normalized.intent, selectedLanguage).includes(normalized.reply) ? normalized.reply : canonicalReply
      : normalized.reply || canonicalReply
    : canonicalReply || normalized.reply;
  if (normalized.intent === "payment_troubleshooting" && normalized.conditions.payment_option_unavailable) {
    reply = {
      english: "I can't verify a payment-provider outage here. Open your booking's checkout to see the payment methods currently offered. If an option is missing or fails, use another method offered there. If you were already charged, check the booking's payment status before paying again. Use Report issue on the booking if the problem continues; don't share passwords, OTPs, or full card details.",
      filipino: "Hindi ko makukumpirma rito kung may outage ang payment provider. Buksan ang checkout ng booking para makita ang kasalukuyang payment methods. Kung wala o pumalya ang isang option, pumili ng ibang inaalok doon. Kung nabawasan ka na, tingnan muna ang payment status bago muling magbayad. Gamitin ang Report issue kung patuloy ang problema; huwag ibigay ang password, OTP, o buong card details.",
      taglish: "I can't verify a payment-provider outage here. Open your booking checkout para makita ang currently offered methods. If an option is missing or fails, choose another method offered there. Kung charged ka na, check the booking payment status before paying again. Use Report issue if the problem continues; don't share passwords, OTPs, or full card details.",
    }[selectedLanguage];
  }
  let recommendations = [];
  if (RECOMMENDATION_INTENTS.has(normalized.intent)) {
    recommendations = payload.vehicles.slice(0, TOP_RECOMMENDATIONS);
    reply = buildRecommendationReply(normalized.intent, selectedLanguage, payload, recommendations, normalized.requested_answer_type);
    if (payload.slots.vehicle_subtype === "big bike") reply += {
      english: " Big bike is a listing subtype label here; engine size is not verified by the current vehicle fields. Confirm the specification with the owner.",
      filipino: " Listing subtype label ang big bike dito; walang verified engine size sa kasalukuyang vehicle fields. Kumpirmahin ang specification sa owner.",
      taglish: " Big bike is a listing subtype label here; hindi verified ang engine size sa current vehicle fields. Confirm the specification with the owner.",
    }[selectedLanguage];
  }
  if (["payment_downpayment", "unpaid_balance"].includes(normalized.intent)
    && normalized.conditions?.payment_after_due_date) {
    const mentionsDownpayment = normalized.intent === "payment_downpayment"
      && normalized.conditions?.downpayment_percent === 30;
    const dueReplies = {
      english: `${mentionsDownpayment ? "You can choose the 30% down payment when that booking offers it. " : ""}The remaining balance becomes due when the vehicle is returned or its scheduled return time passes. Paying after that leaves a due balance, which can block another booking until settled. Check your booking's payment details for the amount and status; I can't confirm your specific balance here.`,
      filipino: `${mentionsDownpayment ? "Puwede ang 30% down payment kung available ito sa booking mo. " : ""}Nagiging due ang natitirang balanse kapag naibalik ang sasakyan o lumampas ang nakatakdang oras ng pagbabalik. Kung babayaran ito pagkatapos noon, may due balance na maaaring humarang sa panibagong booking hanggang mabayaran. Tingnan ang payment details ng booking mo para sa eksaktong halaga at status.`,
      taglish: `${mentionsDownpayment ? "Puwede ang 30% down payment kung offered sa booking mo. " : ""}Due ang remaining balance kapag naibalik ang vehicle o lumampas ang scheduled return time. Paying after that leaves a due balance that can block another booking until settled. Check your booking payment details for the exact amount and status.`,
    };
    reply = dueReplies[selectedLanguage];
  }
  let rentalPrice = null;
  if (normalized.intent === "rental_rate") {
    rentalPrice = fulfillRentalPrice(normalized, payload, selectedLanguage);
    reply = rentalPrice.reply;
    recommendations = rentalPrice.recommendations;
  }
  if ((RECOMMENDATION_INTENTS.has(normalized.intent) || normalized.intent === "rental_rate") && (normalized.entities.requested_schedule || normalized.entities.requested_date)) {
    if (normalized.entities.requested_date) reply += {
      english: ` Requested pickup date: ${normalized.entities.requested_date} (Asia/Manila).`,
      filipino: ` Hiniling na petsa ng pickup: ${normalized.entities.requested_date} (Asia/Manila).`,
      taglish: ` Requested pickup date: ${normalized.entities.requested_date} (Asia/Manila).`,
    }[selectedLanguage];
    reply += {
      english: " Availability for the requested dates is not confirmed. Select both pickup and return dates and times on the vehicle page; the booking checks the schedule before accepting a request.",
      filipino: " Hindi pa kumpirmado ang availability sa hiniling na petsa. Piliin ang pickup at return dates at oras sa vehicle page; sinusuri ang schedule bago tanggapin ang request.",
      taglish: " Hindi pa confirmed ang availability for your dates. Select pickup and return dates and times sa vehicle page; the booking checks the schedule before accepting a request.",
    }[selectedLanguage];
  }
  return {
    ...normalized,
    ...(rentalPrice || {}),
    reply,
    recommendations: recommendations.map((vehicle) => ({
      ...vehicle,
      displayRate: payload.slots.rateUnit === "day" ? vehicle.dailyRate : vehicle.hourlyRate,
      displayRateUnit: payload.slots.rateUnit === "day" ? "day" : "hour",
    })),
    entities: {
      ...normalized.entities,
      model: payload.slots.model || normalized.entities?.model || null,
    },
    requires_live_data: Boolean(datasetIntent?.requires_live_data),
    live_source: cleanText(datasetIntent?.live_source),
  };
}

export function fulfillVehicleAvailabilityStatus(response, vehicles) {
  const normalized = normalizeChatbotResponse(response, DEFAULT_LANGUAGE, 0, buildChatbotInventoryVocabulary(vehicles));
  if (!normalized.valid || normalized.intent !== "vehicle_availability_status") {
    return buildRejectedChatbotResponse(normalized.language, "malformed_classifier");
  }
  if (normalized.requires_clarification) return normalized;
  if (!normalized.entities.brand && !normalized.conditions.vehicle_status_overview) {
    return applyChatbotGuardrails(normalized, buildChatbotPayload("", normalized.language));
  }
  const entities = normalized.entities;
  const matches = filterVehiclesForChatbot(vehicles, {
    brand: entities.brand, model: entities.model, type: entities.category,
    transmission: entities.transmission, location: entities.location, pax: entities.pax,
    budget: entities.max_budget, rateUnit: entities.rate_unit,
    excluded_brands: entities.excluded_brands, excluded_transmissions: entities.excluded_transmissions, excluded_subtypes: entities.excluded_subtypes,
  }, false);
  const style = normalized.language;
  const result = (reply, reason, clarification = null) => ({
    ...normalized, reply, reason_code: reason, recommendations: [],
    requires_live_data: true,
    requires_clarification: Boolean(clarification),
    clarification: clarification || { required: false, type: null, field: null },
  });
  const askWhich = (reason, labels) => result({
    en: `${labels ? `I found multiple matching listings: ${labels}. ` : ""}Which vehicle or listing do you mean?`,
    fil: `${labels ? `May magkakatugmang listing: ${labels}. ` : ""}Aling sasakyan o listing ang tinutukoy mo?`,
    taglish: `${labels ? `May multiple matching listings: ${labels}. ` : ""}Which vehicle or listing ang tinutukoy mo?`,
  }[style], reason, { required: true, type: "ambiguous_entity", field: "model" });
  if (matches.modelCandidates.length > 1) {
    return askWhich("ambiguous_vehicle_model", joinNaturalList(matches.modelCandidates, LANGUAGE_NAME_BY_CODE[style]));
  }
  const items = matches.vehicles;
  if (!items.length) {
    return result({
      en: normalized.conditions.vehicle_status_overview ? "There are no current vehicle listings matching those filters. Try changing your search filters." : "I couldn't find a matching current vehicle listing. Try the exact vehicle name or listing.",
      fil: normalized.conditions.vehicle_status_overview ? "Walang kasalukuyang vehicle listings na tugma sa filters na iyon. Subukang baguhin ang search filters." : "Wala akong nakitang kasalukuyang listing na tugma. Subukan ang eksaktong pangalan o listing ng sasakyan.",
      taglish: normalized.conditions.vehicle_status_overview ? "No current vehicle listings match those filters. Try changing your search filters." : "Wala akong nakitang matching current vehicle listing. Try the exact vehicle name or listing.",
    }[style], "vehicle_status_not_found");
  }
  if (normalized.conditions.vehicle_status_overview) {
    const available = items.filter((vehicle) => vehicle.isAvailable).length;
    const unavailable = items.length - available;
    if (normalized.conditions.vehicle_status_list) {
      const listed = normalized.conditions.vehicle_status_unavailable ? items.filter((vehicle) => !vehicle.isAvailable) : items;
      const labels = listed.slice(0, TOP_RECOMMENDATIONS).map((vehicle) =>
        `${vehicle.name} (${vehicle.isAvailable ? "available" : "unavailable"})`);
      const names = joinNaturalList(labels, LANGUAGE_NAME_BY_CODE[style]);
      const remaining = Math.max(0, listed.length - labels.length);
      const publicChoices = listed.slice(0, TOP_RECOMMENDATIONS);
      return { ...result({
        en: `${listed.length ? `Current matching listings: ${names}${remaining ? `; ${remaining} more` : ""}.` : "There are no currently unavailable listings matching those filters."} The Vehicles page shows only available vehicles. These status results do not confirm availability for future dates.`,
        fil: `${listed.length ? `Kasalukuyang listings na tugma: ${names}${remaining ? `; ${remaining} pa` : ""}.` : "Walang unavailable listings na tugma sa filters ngayon."} Available lamang ang nasa Vehicles page. Hindi nito kinukumpirma ang availability sa susunod na petsa.`,
        taglish: `${listed.length ? `Current matching listings: ${names}${remaining ? `; ${remaining} more` : ""}.` : "No currently unavailable listings match those filters."} Available vehicles lang ang nasa Vehicles page. Future-date availability is not confirmed by these status results.`,
      }[style], "vehicle_status_list"),
        status_choices: publicChoices.every((vehicle) => vehicle.brand && vehicle.model)
          ? publicChoices.map(({ brand, model }) => ({ brand, model })) : [],
      };
    }
    return result({
      en: `There are ${unavailable} currently unavailable and ${available} available matching vehicle listings. The Vehicles page shows only available vehicles. I can't confirm a future availability date from the current status alone.`,
      fil: `May ${unavailable} unavailable at ${available} available na magkakatugmang vehicle listing ngayon. Available lamang ang nasa Vehicles page. Hindi makukumpirma ang petsa ng muling availability mula sa kasalukuyang status lamang.`,
      taglish: `May ${unavailable} currently unavailable and ${available} available matching vehicle listings. The Vehicles page only shows available vehicles. Current status alone cannot confirm a future availability date.`,
    }[style], "vehicle_status_overview");
  }
  if (items.length > 1) {
    return askWhich("ambiguous_vehicle_listing", joinNaturalList(
      items.slice(0, TOP_RECOMMENDATIONS).map((vehicle) => vehicle.name), LANGUAGE_NAME_BY_CODE[style]
    ));
  }
  const vehicle = items[0];
  if (vehicle.isAvailable) {
    return result({
      en: `${vehicle.name} is currently available. Provide your pickup and return schedule to check your dates. If it is missing from the Vehicles page, check your search filters.`,
      fil: `Available ngayon ang ${vehicle.name}. Ibigay ang pickup at return schedule para matingnan ang napili mong petsa. Kung wala ito sa Vehicles page, tingnan ang search filters mo.`,
      taglish: `${vehicle.name} is currently available. Provide your pickup and return schedule to check your dates. Check your search filters if it is missing from the Vehicles page.`,
    }[style], "vehicle_status_available");
  }
  return result({
    en: `${vehicle.name} has a current listing but is unavailable, so it is hidden from the available Vehicles page and cannot be recommended for booking. I can't confirm when it will be available again; check with the owner through RentifyPro.`,
    fil: `May kasalukuyang listing ang ${vehicle.name}, pero unavailable ito kaya hindi lumalabas sa available Vehicles page at hindi inirerekomenda para i-book. Hindi ko makukumpirma kung kailan ito magiging available; makipag-ugnayan sa owner sa RentifyPro.`,
    taglish: `${vehicle.name} has a current listing but is unavailable, kaya hidden sa available Vehicles page at hindi booking recommendation. I can't confirm when it will be available again; check with the owner through RentifyPro.`,
  }[style], "vehicle_status_unavailable");
}

export function getChatbotDatasetInfo() {
  const { datasetPath, intentsById, datasetSha256 } = loadDataset();
  return {
    datasetPath,
    configPath: CHATBOT_CONFIG_PATH,
    datasetSha256,
    configSha256: CONFIG_SHA256,
    intentsCount: Object.keys(intentsById).length,
    liveDataIntents: Object.values(intentsById).filter((item) => item.requires_live_data).map((item) => item.id),
  };
}
