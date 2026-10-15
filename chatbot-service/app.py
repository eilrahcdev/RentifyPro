import json
import hashlib
import os
import re
import math
import unicodedata
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

# Keep routine startup and evaluation logs readable without changing model behavior.
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
os.environ.setdefault("TRANSFORMERS_NO_ADVISORY_WARNINGS", "1")

from fastapi import FastAPI
from service_security import InternalServiceAuthMiddleware
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
from chatbot_routing import (outside_scope, other_person_private_query, practical_intent,
                            split_questions, topic_for_query, topic_for_intent, availability_request,
                            clarification_selection, rental_search_intent,
                            support_response_route, support_response_variant, short_followup_action,
                            social_question_intent, conversation_reset_request, conversational_repair,
                            requested_answer_type, REQUESTED_ANSWER_TYPES, frustration_variant,
                            vehicle_subject_fragment)
from chatbot_inventory import INVENTORY_VOCABULARY, validate_inventory_vocabulary, normalize_subtype
from chatbot_rental_entities import RENTAL_FIELDS, NUMBER_WORDS, extract_rental_preferences, valid_rental_fields, specification_conflict, requested_vehicle_specification
from chatbot_conversation import (CONTEXTUAL_EXAMPLES, contextual_request, has_indirect_reference,
                                  offer_response, valid_assistant_state, validate_offers)


BASE_DIR = Path(__file__).parent
DATASET_PATH = BASE_DIR / "rentifypro_chatbot_dataset_v6.json"
CONFIG_PATH = BASE_DIR / "chatbot_config.json"
DATASET_SCHEMA_VERSION = "v6_intent_multilingual_conversational"


def load_config(path: Path) -> Dict[str, Any]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or raw.get("schema_version") != "v1":
        raise RuntimeError(f"Invalid chatbot configuration: {path}")
    return raw


CONFIG = load_config(CONFIG_PATH)
CONFIG_SHA256 = hashlib.sha256(CONFIG_PATH.read_bytes()).hexdigest()
TOPICS = CONFIG["topics"]
STATUS_CONDITIONS = {"vehicle_status_overview", "vehicle_status_unavailable", "vehicle_status_list"}
CONTEXT_CONDITIONS = STATUS_CONDITIONS | {"payment_option_unavailable"}
MODEL_NAME = os.getenv("CHATBOT_MODEL_NAME", "paraphrase-multilingual-MiniLM-L12-v2")
CONFIDENCE_THRESHOLD = float(
    os.getenv("CHATBOT_CONFIDENCE_THRESHOLD", CONFIG["confidence_threshold"])
)
HIGH_CONFIDENCE_THRESHOLD = float(
    os.getenv("CHATBOT_HIGH_CONFIDENCE_THRESHOLD", CONFIG["high_confidence_threshold"])
)
CLARIFICATION_MARGIN = float(
    os.getenv("CHATBOT_CLARIFICATION_MARGIN", CONFIG["clarification_margin"])
)
HARD_NEGATIVE_FLOOR = float(CONFIG["hard_negative_floor"])
HARD_NEGATIVE_PENALTY = float(CONFIG["hard_negative_penalty"])
MAX_MESSAGE_LENGTH = int(CONFIG["max_message_length"])
MAX_ALTERNATIVES = int(CONFIG["max_alternatives"])
TOP_PREDICTIONS = int(CONFIG["top_predictions"])
UNIQUE_TYPO_MIN_LENGTH = int(CONFIG.get("unique_typo_min_length", 4))
if UNIQUE_TYPO_MIN_LENGTH < 4:
    raise RuntimeError("chatbot_config.json unique_typo_min_length must be at least 4")
CONFIGURED_VEHICLE_BRANDS = CONFIG.get("vehicle_brands")
if not isinstance(CONFIGURED_VEHICLE_BRANDS, list) or not CONFIGURED_VEHICLE_BRANDS:
    raise RuntimeError("chatbot_config.json must define a non-empty vehicle_brands array")

SUPPORTED_STYLES = {"en", "fil", "taglish"}
SUPPORTED_REPLY_LANGUAGES = CONFIG["supported_reply_languages"]
LANGUAGE_ALIASES = CONFIG["language_aliases"]
if set(SUPPORTED_REPLY_LANGUAGES.values()) != SUPPORTED_STYLES:
    raise RuntimeError("Supported reply languages must have approved en, fil, and taglish responses")
REQUESTED_LANGUAGE_TO_STYLE = {
    "english": "en",
    "filipino": "fil",
    "taglish": "taglish",
    "en": "en",
    "fil": "fil",
    "tag": "taglish",
}
CONVERSATIONAL_INTENTS = {
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
}
BRAND_CONTEXT_POLICY_INTENTS = {
    "insurance_included",
    "security_deposit",
    "full_tank_return",
    "driver_option",
}

APOSTROPHE_TRANSLATION = str.maketrans({
    "\u2018": "'",
    "\u2019": "'",
    "\u02bc": "'",
    "\u201c": '"',
    "\u201d": '"',
    "\u2010": "-",
    "\u2011": "-",
    "\u2012": "-",
    "\u2013": "-",
    "\u2014": "-",
    "\u2212": "-",
    "\u00a0": " ",
})
TOKEN_PATTERN = re.compile(r"[^\W_]+(?:'[^\W_]+)?|\d+(?:\.\d+)?%?", re.UNICODE)
RATE_QUERY_PATTERN = re.compile(
    r"\b(?:how much|price|pricing|rate|cost|magkano|presyo)\b",
    re.IGNORECASE,
)
MODEL_BOUNDARY_TOKENS = {
    "a", "an", "ang", "available", "ba", "bang", "bukas", "car", "cars",
    "for", "from", "in", "is", "lang", "may", "na", "ng", "ngayon", "now",
    "mayroon", "meron", "please", "po", "price", "rate", "rent", "rental", "sana", "show", "today",
    "tomorrow", "vehicle", "vehicles", "with", "available", "automatic", "manual",
    "unavailable", "kahit", "still", "not", "hindi", "wala", "disappeared", "missing",
    "currently", "already", "again", "talaga", "pa", "o", "or", "disappear", "visible",
    "be", "become", "will", "right", "and", "can", "could", "how", "what", "does",
    "but", "except", "instead", "kayo", "kau", "mag", "payment", "pay",
    "magkano", "presyo", "total", "lahat", "subtotal",
}
MODEL_CONTEXT_START = re.compile(
    r"\b(?:per|bawat|kada|daily|hourly|today|tomorrow|bukas|ngayon|"
    r"for\s+(?:\d+|one|two|three|isang|dalawang)\s+(?:days?|hours?|araw|oras)|"
    r"under|below|less\s+than|up\s+to|maximum|max|hanggang|mas\s+mababa\s+sa|"
    r"available|availability|rate|price|cost|rent|rental|"
    r"automatic|manual|in|at|sa|on|from)\b",
    re.IGNORECASE,
)
VEHICLE_CATEGORIES = {
    "suv": "suv", "suvs": "suv", "sedan": "sedan", "sedans": "sedan",
    "van": "van", "vans": "van", "truck": "truck", "trucks": "truck",
    "pickup": "pickup", "motorcycle": "motorcycle", "motorcycles": "motorcycle",
    "motorbike": "motorcycle", "motorbikes": "motorcycle", "car": "car",
    "motor": "motorcycle", "motorsiklo": "motorcycle", "minivan": "van",
    "cars": "car", "kotse": "car",
}
AMOUNT_PATTERN = r"(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*k?"
BUDGET_PATTERN = re.compile(
    rf"\b(?:under|below|less\s+than|up\s+to|max(?:imum)?|budget(?:\s+of)?|"
    rf"hanggang|mas\s+mababa\s+sa)\s*(?:php|₱|p)?\s*({AMOUNT_PATTERN})\b",
    re.IGNORECASE,
)
DAY_UNIT_PATTERN = re.compile(r"\b(?:per\s+day|per\s+24\s*hours?|daily|bawat\s+araw|kada\s+araw)\b", re.IGNORECASE)
HOUR_UNIT_PATTERN = re.compile(r"\b(?:per\s+hour|hourly|bawat\s+oras|kada\s+oras)\b", re.IGNORECASE)
PICKUP_TIME_PATTERN = re.compile(
    r"\b(?:pickup\s+(?:time|schedule)|(?:when|what\s+time)\s+(?:is\s+)?(?:my\s+)?pickup|"
    r"(?:what|when|anong|ilang)\s+(?:time|oras).*\b(?:pick\s*up|pickup|kukunin|kunin|kuha)|"
    r"(?:pick\s*up|pickup|kukunin|kunin|kuha).*\b(?:what|when|time|oras|schedule|kailan))\b",
    re.IGNORECASE,
)
PERSONAL_BOOKING_PATTERNS = (
    ("my_active_bookings", (
        re.compile(r"^(?:do i have|have i got|is there|are there|show(?: me)?|check)\b.{0,55}\b(?:active|current|ongoing)\b.{0,20}\b(?:bookings?|rentals?)\b"),
        re.compile(r"^(?:may|meron|mayroon)\b.{0,50}\b(?:active|current|ongoing|kasalukuyang)\b.{0,20}\b(?:booking|rental|renta)\b.{0,20}\b(?:ako|ko)\b"),
        re.compile(r"^(?:may|meron|mayroon)\s+(?:booking|rental|renta)\s+pa\s+ba\s+ako\b"),
    )),
    ("my_unpaid_balance", (
        re.compile(r"^(?:do i have|is there|are there|how much|what is my|check my)\b.{0,65}\b(?:unpaid|outstanding|remaining|due|overdue|owe)\b.{0,25}\b(?:balance|payment|amount|fee|bookings?)\b"),
        re.compile(r"^(?:do i|am i)\s+(?:still\s+)?owe\b"),
        re.compile(r"^(?:may|meron|mayroon)\b.{0,45}\b(?:unpaid|balance|balanse|utang)\b.{0,25}\b(?:ako|ko)\s*(?:ba)?$"),
        re.compile(r"^magkano\b.{0,35}\b(?:balance|balanse|utang)\s+ko\b"),
    )),
    ("my_overdue_return", (
        re.compile(r"^(?:am i|is my|are my|do i have|are any of my)\b.{0,65}\b(?:overdue|late(?:\s+return)?|returning\s+late)\b"),
        re.compile(r"^(?:late|overdue|nahuli)\s+(?:na\s+)?ba\b.{0,50}\b(?:booking|return|balik|rental|renta|ako|ko)\b"),
        re.compile(r"^(?:may|meron|mayroon)\b.{0,35}\b(?:late|overdue)\s+(?:return|balik)\b.{0,15}\b(?:ako|ko)\b"),
    )),
    ("booking_status", (
        re.compile(r"^(?:do i have|have i got)\b.{0,45}\b(?:bookings?|reservations?)\b(?:\s+(?:right now|currently))?$"),
        re.compile(r"^(?:do i have|have i got|may|meron|mayroon)\b.{0,35}\b(?:pending|confirmed)\s+(?:booking|reservation|renta)\b"),
    )),
)
# These forms address the assistant itself. Keep third-party rental questions out
# of this conversational intent (for example, "can a gay renter book?").
ASSISTANT_IDENTITY_TERMS = (
    r"(?:girl|boy|woman|man|gay|lesbian|male|female|straight|non[- ]?binary|"
    r"bisexual|pansexual|asexual|queer|transgender|trans|tomboy|fem[- ]?boy|"
    r"babae|lalaki|bakla|bading|beki|tibo|lesbiyana|silahis)"
)
FEMBOY_PATTERN = re.compile(r"\bfem[- ]?boy\b")
SELF_GENDER_QUESTION_PATTERNS = (
    re.compile(rf"^(?:are you|r u)\s+(?:(?:a|an)\s+)?{ASSISTANT_IDENTITY_TERMS}\b"),
    re.compile(r"^(?:what(?:'s| is)|which is)\s+your\s+(?:gender|sex|sexuality|sexual orientation)\b"),
    re.compile(r"^what\s+gender\s+are\s+you\b"),
    re.compile(rf"^do you (?:have\s+(?:a\s+)?(?:gender|sex|sexuality|sexual orientation)|identify as\s+(?:a\s+)?{ASSISTANT_IDENTITY_TERMS})\b"),
    re.compile(rf"^(?:ikaw\s+(?:ba\s+)?(?:ay\s+)?)?{ASSISTANT_IDENTITY_TERMS}\s+ka\b|^ikaw\s+(?:ba\s+)?(?:ay\s+)?{ASSISTANT_IDENTITY_TERMS}\b"),
    re.compile(rf"^{ASSISTANT_IDENTITY_TERMS}\s+ba\s+(?:ikaw|si\s+rentify\s+ai|ang\s+chatbot)\b"),
    re.compile(r"^(?:ano|anong)\s+(?:ang\s+)?(?:kasarian|gender|sexual orientation)\s+mo\b"),
    re.compile(r"^(?:may|meron|mayroon)\s+ka\s+ba(?:ng)?\s+(?:kasarian|gender|sexual orientation)\b"),
)
STYLE_DIRECTIVE_PATTERN = re.compile(
    r"^\s*(?:(?:please\s+)?(?:reply|answer|respond|speak)\s+in\s+"
    r"(?P<en>english)|(?:please\s+)?(?:reply|answer|respond|speak)\s+in\s+"
    r"(?P<fil>filipino|tagalog)|(?:please\s+)?(?:reply|answer|respond|speak)\s+in\s+"
    r"(?P<taglish>taglish))\s*[:,.]?\s*",
    re.IGNORECASE,
)

FILIPINO_TOKENS = {
    "ako", "ang", "ano", "anong", "at", "ba", "bakit", "balanse", "bayad",
    "dapat", "di", "gamit", "hindi", "ilang", "kailangan", "kaso", "kotse",
    "kaya", "kung", "late", "mag", "magbayad", "magbook", "magkano", "magrenta", "magsalita",
    "kumusta", "lang", "magsoli", "makapagbook", "makapagbayad", "patakaran", "may", "mayroon", "meron", "mga", "mo", "muna",
    "na", "ng", "ngayon", "paano", "pano", "para", "pasahero", "po", "puwedeng", "pwede",
    "renta", "rentahan", "sabay", "salamat", "sana", "sasakyan", "sige", "sobra", "tulong",
    "wala", "yung", "kasya",
    "oo", "opo", "ko", "kong", "akin", "gusto", "nasaan", "dito", "doon",
    "iyan", "yon", "yun", "naman", "pala", "kasi", "pero", "tapos", "kapag",
    "pag", "baka", "talaga", "puwede", "kuha", "kunin", "ibalik", "bayaran",
    "oras", "araw", "bukas", "ngayon", "yung", "maaaring", "bawat", "mas",
    "ikaw", "ka", "babae", "lalaki", "bakla", "bading", "beki",
    "tibo", "tomboy", "femboy", "lesbiyana", "silahis", "kasarian",
    "nahuli", "balik", "utang", "kasalukuyang",
    "marunong", "walang", "sumagot", "suportado",
    "motor", "motorsiklo", "pinakamura", "pinakamurang", "pinakamababang", "limang", "tatlong", "dalawang",
}
ENGLISH_TOKENS = {
    "account", "available", "balance", "book", "booking", "can", "cancel",
    "car", "cash", "day", "deposit", "do", "driver", "extend", "fee", "gcash",
    "automatic", "book", "date", "dates", "fuel", "help", "how", "insurance",
    "late", "level", "methods", "pax", "payment", "pending", "price", "rate", "rent",
    "rental", "requirements", "return", "same", "status", "vehicle", "what", "when",
    "where", "which", "why", "show", "find",
    "pickup", "time", "hour", "hours", "daily", "hourly", "model", "brand",
    "van", "truck", "motorcycle", "today", "tomorrow", "budget",
    "under", "below", "maximum", "minimum", "refund", "refundable", "due",
    "overdue", "unpaid", "active", "current", "ongoing", "owe", "owner",
    "location", "schedule", "manual", "listing",
    "availability", "extension",
    "thank", "thanks", "please", "you",
    "girl", "boy", "woman", "man", "gay", "lesbian", "male", "female", "gender",
    "sexuality", "straight", "nonbinary", "bisexual", "pansexual", "asexual",
    "queer", "transgender", "trans", "tomboy", "femboy",
    "speak", "reply", "respond", "understand", "know", "good", "fluent", "languages", "support",
    "days", "total", "quote", "subtotal", "cheapest", "affordable", "lowest",
}
FILIPINO_GRAMMAR_PATTERN = re.compile(r"\b(?:may|meron|mayroon)\b.*\b(?:ba|bang)\b|\b(?:yung|ang|ng|ko|kong|mga)\b", re.IGNORECASE)
ENGLISH_DOMAIN_PATTERN = re.compile(
    r"\b(?:available|booking|payment|status|vehicle|pickup|rental|rate|extend|"
    r"automatic|manual|van|car|driver|per\s+day|per\s+hour)\b", re.IGNORECASE
)
AMBIGUOUS_SHORT_FOLLOWUPS = {
    "oo", "opo", "sige", "ok", "okay", "yes", "no", "per day", "per hour",
    "bawat araw", "bawat oras", "daily", "hourly",
}

GENERIC_CLARIFICATIONS = {
    "en": "I want to make sure I answer correctly. Could you add a little more detail to your question?",
    "fil": "Gusto kong masigurong tama ang sagot ko. Maaari mo bang dagdagan ng kaunting detalye ang tanong?",
    "taglish": "Gusto kong masigurong tama ang sagot ko. Could you add a little more detail?",
}
FEMBOY_REPLIES = {
    "en": "Femboy usually describes feminine gender expression, not sexual orientation. I'm an AI assistant, so I'm not a femboy and I don't have a sexual orientation.",
    "fil": "Ang femboy ay karaniwang tumutukoy sa pambabaeng pagpapahayag ng kasarian, hindi sa seksuwal na oryentasyon. AI assistant ako, kaya hindi ako femboy at wala akong seksuwal na oryentasyon.",
    "taglish": "Femboy usually describes feminine gender expression, hindi sexual orientation. AI assistant ako, so hindi ako femboy at wala akong sexual orientation.",
}
FEMBOY_DEFINITION_REPLIES = {
    "en": "Femboy usually describes feminine gender expression, not sexual orientation. A person's orientation cannot be inferred from that label.",
    "fil": "Ang femboy ay karaniwang tumutukoy sa pambabaeng pagpapahayag ng kasarian, hindi sa seksuwal na oryentasyon. Hindi matutukoy ang oryentasyon ng isang tao mula sa tawag na iyon.",
    "taglish": "Femboy usually describes feminine gender expression, hindi sexual orientation. Hindi malalaman ang orientation ng isang tao from that label alone.",
}


class ChatRequest(BaseModel):
    message: str
    language: Optional[str] = "auto"
    previous_language: Optional[str] = None
    previous_context: Optional[Dict[str, Any]] = None
    # Retained for backward compatibility. Live recommendations are fulfilled
    # by the Node backend after this service selects the intent.
    vehicles: Optional[List[Dict[str, Any]]] = None
    inventory_vocabulary: Optional[Dict[str, Any]] = None


def clean_text(value: Any, max_length: int = MAX_MESSAGE_LENGTH) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).translate(APOSTROPHE_TRANSLATION)
    text = re.sub(r"\s+", " ", text, flags=re.UNICODE).strip()
    return text[:max_length]


def normalize_for_match(value: Any) -> str:
    text = clean_text(value).lower().replace("\u20b1", " php ")
    text = re.sub(r"([!?.,])\1+", r"\1", text)
    text = re.sub(r"[^\w\s%#'\-]", " ", text, flags=re.UNICODE)
    return re.sub(r"\s+", " ", text, flags=re.UNICODE).strip()


def tokenize(value: str) -> List[str]:
    return [token.lower() for token in TOKEN_PATTERN.findall(value or "")]


def build_informal_text_normalizations(value: Any) -> List[Tuple[str, str]]:
    if not isinstance(value, dict) or not value:
        raise RuntimeError("chatbot_config.json must define informal_text_normalizations")
    rules: List[Tuple[str, str]] = []
    seen: Set[str] = set()
    for raw_source, raw_target in value.items():
        source = normalize_for_match(raw_source)
        target = normalize_for_match(raw_target)
        if not source or not target or source == target or source in seen:
            raise RuntimeError("chatbot_config.json contains an invalid informal text normalization")
        seen.add(source)
        rules.append((source, target))
    return sorted(rules, key=lambda item: (-len(item[0].split()), -len(item[0]), item[0]))


INFORMAL_TEXT_NORMALIZATIONS = build_informal_text_normalizations(
    CONFIG.get("informal_text_normalizations")
)


def normalize_informal_text(value: Any) -> str:
    normalized = normalize_for_match(value)
    for source, target in INFORMAL_TEXT_NORMALIZATIONS:
        normalized = re.sub(
            rf"(?<!\w){re.escape(source)}(?!\w)",
            target,
            normalized,
            flags=re.UNICODE,
        )
    return re.sub(r"\s+", " ", normalized, flags=re.UNICODE).strip()


def build_vehicle_brand_lookup(values: List[Any]) -> Dict[str, str]:
    lookup: Dict[str, str] = {}
    for value in values:
        canonical = clean_text(value)
        normalized = normalize_for_match(canonical)
        if not canonical or not normalized or normalized in lookup:
            raise RuntimeError("chatbot_config.json contains an invalid or duplicate vehicle brand")
        lookup[normalized] = canonical
    return lookup


VEHICLE_BRAND_BY_NORMALIZED = build_vehicle_brand_lookup(CONFIGURED_VEHICLE_BRANDS)
brand_aliases = CONFIG.get("vehicle_brand_aliases", {})
if not isinstance(brand_aliases, dict):
    raise RuntimeError("chatbot_config.json vehicle_brand_aliases must be an object")
for alias, canonical in brand_aliases.items():
    normalized_alias = normalize_for_match(alias)
    if (not normalized_alias or normalized_alias in VEHICLE_BRAND_BY_NORMALIZED
        or canonical not in CONFIGURED_VEHICLE_BRANDS):
        raise RuntimeError("chatbot_config.json contains an invalid vehicle brand alias")
    VEHICLE_BRAND_BY_NORMALIZED[normalized_alias] = canonical



def vehicle_brand_lookup():
    return {**VEHICLE_BRAND_BY_NORMALIZED, **{
        normalize_for_match(brand): brand for brand in INVENTORY_VOCABULARY.get().get("brands", [])}}


def vehicle_subtypes():
    types = {parent: list(values) for parent, values in CONFIG["vehicle_category_subtypes"].items()}
    types["motorcycle"].append("big bike")
    for item in INVENTORY_VOCABULARY.get().get("subtypes", []):
        subtype = normalize_subtype(item["name"])
        if subtype not in types[item["category"]]:
            types[item["category"]].append(subtype)
    return types

def find_brand_token_span(message: str) -> Tuple[Optional[str], int, int, List[str]]:
    original_tokens = TOKEN_PATTERN.findall(clean_text(message))
    normalized_tokens = [normalize_for_match(token) for token in original_tokens]
    for normalized_brand, canonical_brand in sorted(
        vehicle_brand_lookup().items(), key=lambda item: len(item[0]), reverse=True
    ):
        brand_tokens = normalized_brand.split()
        width = len(brand_tokens)
        for index in range(0, len(normalized_tokens) - width + 1):
            if normalized_tokens[index:index + width] == brand_tokens:
                return canonical_brand, index, index + width, original_tokens
    return None, -1, -1, original_tokens


def mentioned_brands(message: str) -> List[str]:
    tokens = [normalize_for_match(token) for token in TOKEN_PATTERN.findall(clean_text(message))]
    found = set()
    for normalized_brand, canonical in vehicle_brand_lookup().items():
        width = len(normalized_brand.split())
        if any(tokens[index:index + width] == normalized_brand.split()
               for index in range(len(tokens) - width + 1)):
            found.add(canonical)
    return sorted(found)


def canonicalize_model_token(token: str) -> str:
    if token.islower() or token.isupper():
        return token[:1].upper() + token[1:].lower()
    return token


def extract_vehicle_entities(message: str) -> Dict[str, Optional[str]]:
    brand, _, brand_end, original_tokens = find_brand_token_span(message)
    live_models = INVENTORY_VOCABULARY.get().get("models", [])
    normalized = normalize_for_match(message)
    generic_models = set(VEHICLE_CATEGORIES) | {subtype for values in vehicle_subtypes().values() for subtype in values}
    matches = [item for item in live_models if (brand or (normalize_for_match(item["model"]) not in generic_models
               and re.search(r"[^\W\d_]", item["model"], re.UNICODE)))
               and (not brand or item["brand"] == brand)
               and re.search(r"\b" + re.escape(normalize_for_match(item["model"])) + r"\b", normalized)]
    matches.sort(key=lambda item: len(item["model"]), reverse=True)
    if matches and (brand or normalized == normalize_for_match(matches[0]["model"])
                    or re.search(r"\b(?:show|find|rent|rentals|have|may|meron|hanap|how about|what about)\b", normalized)):
        longest = len(matches[0]["model"])
        identities = {(item["brand"], item["model"]) for item in matches if len(item["model"]) == longest}
        if len(identities) == 1:
            live_brand, model = next(iter(identities))
            return {"brand": live_brand, "model": model}
    if not brand:
        return {"brand": None, "model": None}

    suffix = " ".join(original_tokens[brand_end:])
    context = MODEL_CONTEXT_START.search(suffix)
    if context:
        suffix = suffix[:context.start()]
    model_tokens: List[str] = []
    for token in TOKEN_PATTERN.findall(suffix):
        normalized = normalize_for_match(token)
        if not normalized or normalized in MODEL_BOUNDARY_TOKENS or normalized in VEHICLE_CATEGORIES:
            break
        model_tokens.append(canonicalize_model_token(token))
        if len(model_tokens) >= 4:
            break
    return {
        "brand": brand,
        "model": " ".join(model_tokens) or None,
    }


def extract_query_entities(message: str, original_message: Optional[str] = None) -> Dict[str, Any]:
    normalized = normalize_for_match(message)
    excluded = [brand for brand in mentioned_brands(message) if re.search(
        rf"\b(?:no|not|except|exclude|without|don't want|do not want|ayaw(?: ko)?|huwag|hindi)\s+(?:ng\s+)?{re.escape(brand.lower())}\b", normalized
    )]
    positive_message = normalized
    for brand in excluded:
        positive_message = re.sub(rf"\b{re.escape(brand.lower())}\b", "", positive_message)
    entities: Dict[str, Any] = extract_vehicle_entities(positive_message)
    if excluded:
        entities["excluded_brands"] = excluded
    categories = []
    for token in tokenize(normalized):
        if (token == "pickup" and not re.search(r"\bpickup\s+truck\b", normalized)
            and re.search(r"\bpickup\s+(?:on|at|today|tomorrow|bukas|ngayon|time|date|schedule|a|the|my|our|\d[\d-]*)\b", normalized)):
            continue
        category = VEHICLE_CATEGORIES.get(token)
        if category:
            categories.append(category)
    if categories:
        entities["category"] = next((category for category in categories if category not in {"car", "truck"}), categories[0])
    if re.search(r"\bpick up trucks?\b", normalized):
        entities["category"] = "pickup"
    excluded_subtypes = [subtype for subtypes in vehicle_subtypes().values() for subtype in subtypes
                        if re.search(r"\b(?:no|not|except|exclude|without|ayaw(?: ko)?|huwag|hindi)\s+(?:ng\s+)?"
                                     + re.escape(subtype) + r"s?\b", normalized)]
    if excluded_subtypes:
        entities["excluded_subtypes"] = list(dict.fromkeys(excluded_subtypes))
    for parent, subtypes in vehicle_subtypes().items():
        for subtype in subtypes:
            if subtype == "pickup" and not re.search(r"\bpick ?up trucks?\b", normalized):
                continue
            plural = "s?" if not subtype.endswith("s") and subtype not in {"passenger", "cargo", "luxury"} else ""
            if subtype not in excluded_subtypes and re.search(r"\b" + re.escape(subtype) + plural + r"\b", normalized) and entities.get("category") in (None, parent):
                unique_parent = sum(subtype in types for types in vehicle_subtypes().values()) <= 1
                if entities.get("category") or unique_parent:
                    entities["category"], entities["vehicle_subtype"] = parent, subtype
                    if normalize_for_match(entities.get("model")) == subtype:
                        entities.pop("model", None)
    if not entities.get("brand") and not entities.get("category"):
        model = re.search(r"\b(?:rent|renta|rental) (?:ng|of|for) ([a-z][a-z0-9-]{1,30})\b", normalized)
        if model and model.group(1) not in {"a", "the", "my", "it", "this", "that", "today", "tomorrow", "days", "hours"}:
            entities["model"] = model.group(1)
    day_unit = bool(DAY_UNIT_PATTERN.search(normalized))
    hour_unit = bool(HOUR_UNIT_PATTERN.search(normalized))
    if day_unit != hour_unit:
        entities["rate_unit"] = "day" if day_unit else "hour"
    budget_match = BUDGET_PATTERN.search(clean_text(original_message or message))
    if budget_match and re.match(r"\s*[- ]?\s*(?:seats?|seater|pax|passengers?|tao|pasahero)\b", clean_text(original_message or message)[budget_match.end():], re.I):
        budget_match = None
    if budget_match:
        amount = budget_match.group(1).replace(",", "").replace(" ", "").lower()
        multiplier = 1000 if amount.endswith("k") else 1
        try:
            budget = float(amount.rstrip("k")) * multiplier
        except ValueError:
            budget = 0
        if 0 < budget <= 10_000_000:
            entities["max_budget"] = round(budget, 2)
            entities["currency"] = "PHP"
    excluded_transmissions = [item for item in ("automatic", "manual") if re.search(
        rf"\b(?:not|no|without|exclude|except|hindi|ayaw(?: ko)?)\s+(?:ng\s+)?{item}\b", normalized
    )]
    if excluded_transmissions:
        entities["excluded_transmissions"] = excluded_transmissions
    transmission = next((match for match in re.finditer(r"\b(automatic|manual|matic)\b", normalized)
                         if match.group(1) not in excluded_transmissions), None)
    if transmission:
        entities["transmission"] = "automatic" if transmission.group(1) in {"automatic", "matic"} else "manual"
    if re.search(r"\b(?:no clutch|without.*clutch|do not need.*clutch)\b", normalized):
        entities["transmission"] = "automatic"
    for location in re.finditer(r"(?=\b(?:in|near|around|sa)\s+([a-z][a-z '-]{1,70}))", normalized):
        words = []
        stops = {"tomorrow", "today", "bukas", "ngayon", "under", "below", "per", "for", "with", "and", "automatic", "manual", "on", "from", "until", "to", "available", "please", "po", "php", "p", "budget", "bawat", "kada", "ba", "lang", "na", "may", "at", "next", "that", "which", "are", "is", "currently"}
        stops.update(NUMBER_WORDS)
        stops.update(VEHICLE_CATEGORIES)
        stops.update({"payment", "payments", "cash", "person", "balance", "downpayment", "checkout", "account", "booking", "bookings", "english", "filipino", "tagalog", "taglish", "progress", "good", "condition", "loob", "sa", "the", "a", "an", "rental", "rent", "my", "your"})
        stops.update({"loob", "ilang", "araw", "oras", "day", "days", "hour", "hours", "presyo", "renta", "driver", "pickup", "return"})
        stops.update({"gasoline", "diesel", "electric", "hybrid", "petrol", "gas", "self", "drive", "mt"})
        for word in location.group(1).split():
            if word in stops or len(words) >= 4:
                break
            words.append(word)
        place = " ".join(words)
        if place and not mentioned_brands(place) and place not in {"english", "filipino", "tagalog", "taglish", "progress", "my account", "the booking", "booking ko", "oras ng pagsoli"}:
            entities["location"] = place
            break
    schedule_tokens = re.findall(
        r"\b(?:day after tomorrow|tomorrow|today|tonight|bukas|ngayon|weekend|next week|"
        r"(?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|"
        r"\d{4}-\d{2}-\d{2}|\d{1,2}[/]\d{1,2}(?:[/]\d{2,4})?)\b",
        clean_text(original_message or message).lower(),
    )
    if schedule_tokens:
        entities["requested_schedule"] = " to ".join(dict.fromkeys(schedule_tokens))[:100]
    preferences = extract_rental_preferences(clean_text(original_message or message))
    controlled_preferences = extract_rental_preferences(normalized)
    for key in ("sort_by", "quote_requested", "driver_requested"):
        if key not in preferences and key in controlled_preferences:
            preferences[key] = controlled_preferences[key]
    entities.update(preferences)
    specification = requested_vehicle_specification(original_message or message)
    reference = re.search(r"\b(?:(?:this|that|same|selected) (?:one|vehicle|car|listing|suv|motorcycle|truck)|first|second|third|itong|iyang|ito|iyan|it)\b", normalized)
    identity_search = bool(entities.get("brand") and entities.get("category") and not entities.get("model")
                           and re.search(r"^(?:do you have|may|meron|mayroon)\b", normalized))
    if specification and not identity_search and (entities.get("brand") or (reference and (specification != "subtype"
        or re.search(r"\b(?:vehicle|car|motorcycle|truck|van|listing|subtype)\b", normalized)))):
        entities["specification_requested"] = specification
        if entities.get("brand"):
            entities["model"] = extract_vehicle_entities(normalized).get("model")
        if entities.get("model"):
            entities["model"] = re.split(r"\b(?:have|has|use|uses|automatic|manual|transmission|fuel|allow|allows)\b", entities["model"], flags=re.I)[0].strip() or None
        for field in ("pax", "seat_match", "transmission", "fuel", "driver_requested", "self_drive_only", "driver_included_required", "location"):
            entities.pop(field, None)
    return entities


def extract_conditions(message: str) -> Dict[str, Any]:
    normalized = normalize_for_match(message)
    conditions: Dict[str, Any] = {}
    percent = re.search(r"\b(\d{1,3})\s*%", normalized)
    if percent and 0 < int(percent.group(1)) <= 100:
        conditions["downpayment_percent"] = int(percent.group(1))
    if re.search(r"\b(?:remaining|outstanding|unpaid)\s+balance\b|\bbalance\b|\bbalanse\b|\bnatitirang\s+bayad\b", normalized):
        conditions["remaining_balance"] = True
    if re.search(
        r"\b(?:after|past|beyond)\s+(?:the\s+)?(?:due\s+date|deadline)|"
        r"\b(?:pagkatapos\s+ng|lampas\s+sa)\s+(?:due\s+date|deadline)|"
        r"\b(?:pay|payment|balance|balanse|bayad)\b.*\boverdue\b",
        normalized,
    ):
        conditions["payment_after_due_date"] = True
    return conditions


def validated_pending_search(value: Any) -> Dict[str, Any]:
    if not isinstance(value, dict) or set(value) - {
        "brand", "model", "category", "max_budget", "currency", "transmission"
    }:
        return {}
    brand = value.get("brand")
    category = value.get("category")
    budget = value.get("max_budget")
    if brand not in vehicle_brand_lookup().values() and brand is not None:
        return {}
    if category is not None and category not in set(VEHICLE_CATEGORIES.values()):
        return {}
    if not brand and not category:
        return {}
    if isinstance(budget, bool) or not isinstance(budget, (int, float)) or not 0 < budget <= 10_000_000:
        return {}
    if value.get("currency") != "PHP":
        return {}
    model = value.get("model")
    if model is not None and (not isinstance(model, str) or len(model) > 80):
        return {}
    transmission = value.get("transmission")
    if transmission is not None and transmission not in {"automatic", "manual"}:
        return {}
    return {key: item for key, item in value.items() if item is not None}


def validated_conversation_context(value: Any) -> Dict[str, Any]:
    if not isinstance(value, dict) or set(value) - {"intent", "entities", "clarification", "choices", "suggested_brand", "topic", "conditions", "candidate_intents", "response_variant", "requested_answer_type", "idle_turns", "assistant_action", "pending_offer"}:
        return {}
    if not isinstance(value.get("intent"), str) or (value["intent"] not in INTENTS_BY_ID and value["intent"] != "REJECT"):
        return {}
    if not valid_assistant_state(value, INTENTS_BY_ID):
        return {}
    variant = value.get("response_variant")
    answer_type = value.get("requested_answer_type")
    if answer_type is not None and (not isinstance(answer_type, str) or answer_type not in REQUESTED_ANSWER_TYPES):
        return {}
    if variant is not None and (not isinstance(variant, str) or variant not in INTENTS_BY_ID.get(value["intent"], {}).get("response_variants", {})):
        return {}
    idle = value.get("idle_turns", 0)
    if type(idle) is not int or not 0 <= idle <= 2:
        return {}
    entities = value.get("entities", {})
    allowed = {"brand", "model", "category", "vehicle_subtype", "max_budget", "currency", "rate_unit", "transmission", "location", "pax", "excluded_brands", "excluded_transmissions", "excluded_subtypes", "requested_schedule"} | RENTAL_FIELDS
    if not isinstance(entities, dict) or set(entities) - allowed:
        return {}
    if not valid_rental_fields(entities):
        return {}
    if entities.get("brand") is not None and entities["brand"] not in vehicle_brand_lookup().values():
        return {}
    if entities.get("category") is not None and entities["category"] not in VEHICLE_CATEGORIES.values():
        return {}
    parent = "truck" if entities.get("category") == "pickup" else "car" if entities.get("category") in {"suv", "sedan"} else entities.get("category")
    if entities.get("vehicle_subtype") is not None and entities["vehicle_subtype"] not in vehicle_subtypes().get(parent, []):
        return {}
    for key, options in (("rate_unit", {"day", "hour"}), ("transmission", {"automatic", "manual"}), ("currency", {"PHP"})):
        if entities.get(key) is not None and (not isinstance(entities[key], str) or entities[key] not in options):
            return {}
    for key, limit in (("model", 80), ("location", 80), ("requested_schedule", 100)):
        if entities.get(key) is not None and (not isinstance(entities[key], str) or len(entities[key]) > limit):
            return {}
    for key, maximum in (("max_budget", 10_000_000), ("pax", 99)):
        if key in entities and (isinstance(entities[key], bool) or not isinstance(entities[key], (int, float)) or not math.isfinite(entities[key]) or not 0 < entities[key] <= maximum or (key == "pax" and entities[key] % 1)):
            return {}
    if entities.get("max_budget") and entities.get("currency") != "PHP":
        return {}
    excluded = entities.get("excluded_brands", [])
    if not isinstance(excluded, list) or len(excluded) > 12 or any(brand not in vehicle_brand_lookup().values() for brand in excluded):
        return {}
    excluded_transmissions = entities.get("excluded_transmissions", [])
    if not isinstance(excluded_transmissions, list) or len(excluded_transmissions) > 2 or any(not isinstance(item, str) or item not in {"automatic", "manual"} for item in excluded_transmissions):
        return {}
    excluded_subtypes = entities.get("excluded_subtypes", [])
    known_subtypes = {subtype for subtypes in vehicle_subtypes().values() for subtype in subtypes}
    if not isinstance(excluded_subtypes, list) or len(excluded_subtypes) > 12 or any(not isinstance(item, str) or item not in known_subtypes for item in excluded_subtypes):
        return {}
    choices = value.get("choices", [])
    if not isinstance(choices, list) or len(choices) > 3:
        return {}
    for choice in choices:
        if not isinstance(choice, dict) or set(choice) - {"brand", "model", "listing_id"} or not valid_rental_fields(choice):
            return {}
        if choice.get("brand") not in vehicle_brand_lookup().values() or not isinstance(choice.get("model"), str) or len(choice["model"]) > 80:
            return {}
    clarification = value.get("clarification", {})
    if not isinstance(clarification, dict) or set(clarification) - {"required", "type", "field"}:
        return {}
    if value.get("suggested_brand") is not None and value["suggested_brand"] not in vehicle_brand_lookup().values():
        return {}
    topic = value.get("topic")
    if topic is not None and (not isinstance(topic, str) or topic not in TOPICS):
        return {}
    if topic and value["intent"] != "REJECT" and topic_for_intent(value["intent"], TOPICS) != topic:
        return {}
    candidates = value.get("candidate_intents", [])
    if not isinstance(candidates, list) or len(candidates) > 3 or any(not isinstance(item, str) or item not in INTENTS_BY_ID for item in candidates):
        return {}
    allowed_candidates = TOPICS[topic]["candidates"] if topic else ["vehicle_availability_status", "payment_troubleshooting"]
    if any(item not in allowed_candidates for item in candidates):
        return {}
    if ("required" in clarification and not isinstance(clarification["required"], bool)
        or clarification.get("type") not in (None, "missing_entity", "ambiguous_entity", "ambiguous_intent", "unknown_intent", "spelling_confirmation")
        or clarification.get("field") not in (None, "rate_unit", "booking", "brand", "model", "duration", "driver", "fuel", "transmission")):
        return {}
    conditions = value.get("conditions", {})
    if not isinstance(conditions, dict) or set(conditions) - CONTEXT_CONDITIONS or any(item is not True for item in conditions.values()):
        return {}
    if set(conditions) & STATUS_CONDITIONS and value["intent"] not in {"REJECT", "vehicle_availability_status"}:
        return {}
    if conditions.get("payment_option_unavailable") and value["intent"] not in {"REJECT", "payment_troubleshooting"}:
        return {}
    return value


def one_edit_apart(left: str, right: str) -> bool:
    if left == right or abs(len(left) - len(right)) > 1:
        return False
    if len(left) > len(right):
        left, right = right, left
    if len(left) == len(right):
        mismatches = [index for index, (a, b) in enumerate(zip(left, right)) if a != b]
        if len(mismatches) == 1:
            return True
        return bool(
            len(mismatches) == 2
            and mismatches[1] == mismatches[0] + 1
            and left[mismatches[0]] == right[mismatches[1]]
            and left[mismatches[1]] == right[mismatches[0]]
        )
    index_left = 0
    index_right = 0
    edits = 0
    while index_left < len(left) and index_right < len(right):
        if left[index_left] == right[index_right]:
            index_left += 1
            index_right += 1
            continue
        edits += 1
        index_right += 1
        if edits > 1:
            return False
    return True


def build_unique_typo_vocabulary(items: List[Dict[str, Any]]) -> Set[str]:
    vocabulary = {
        token
        for token in FILIPINO_TOKENS.union(ENGLISH_TOKENS)
        if len(token) >= UNIQUE_TYPO_MIN_LENGTH and token.isalpha()
    }
    for item in items:
        for example in item["examples"]:
            for token in tokenize(normalize_for_match(example)):
                if len(token) >= UNIQUE_TYPO_MIN_LENGTH and token.isalpha():
                    vocabulary.add(token)
    for brand in VEHICLE_BRAND_BY_NORMALIZED:
        vocabulary.update(
            token
            for token in brand.split()
            if len(token) >= UNIQUE_TYPO_MIN_LENGTH and token.isalpha()
        )
    return vocabulary


def normalize_unique_known_typos(normalized_text: str) -> str:
    corrected_tokens: List[str] = []
    brand_tokens = set(vehicle_brand_lookup())
    for token in normalized_text.split():
        if (
            len(token) < UNIQUE_TYPO_MIN_LENGTH
            or not token.isalpha()
            or token in UNIQUE_TYPO_VOCABULARY
            or token in {word for item in INVENTORY_VOCABULARY.get().get("models", []) for word in normalize_for_match(item["model"]).split()}
            or token in {word for values in vehicle_subtypes().values() for subtype in values for word in subtype.split()}
            or token == "motors"
            or any(one_edit_apart(token, brand) for brand in brand_tokens)
        ):
            corrected_tokens.append(token)
            continue
        matches = {
            candidate
            for candidate in UNIQUE_TYPO_VOCABULARY
            if candidate[0] == token[0]
            and abs(len(candidate) - len(token)) <= 1
            and one_edit_apart(token, candidate)
        }
        corrected_tokens.append(next(iter(matches)) if len(matches) == 1 else token)
    return " ".join(corrected_tokens)


def find_safe_brand_typo(message: str) -> Optional[str]:
    normalized = normalize_for_match(message)
    tokens = normalized.split()
    if not tokens:
        return None
    has_brand_context = len(tokens) == 1 or bool(
        {"brand", "car", "cars", "vehicle", "vehicles", "hanap", "gusto", "have"}.intersection(tokens)
    )
    if not has_brand_context:
        return None
    suggestions = {
        canonical
        for token in tokens
        if len(token) >= 5
        for candidate, canonical in vehicle_brand_lookup().items()
        if len(candidate) >= 5 and one_edit_apart(token, candidate)
    }
    return next(iter(suggestions)) if len(suggestions) == 1 else None


def brand_typo_reply(brand: str, style: str) -> str:
    if style == "fil":
        return f"Ang ibig mo bang sabihin ay {brand}? Kung oo, hahanapin ko ang kasalukuyang RentifyPro listings."
    if style == "taglish":
        return f"Did you mean {brand}? If yes, hahanapin ko ang current RentifyPro listings."
    return f"Did you mean {brand}? If so, I can search the current RentifyPro listings."


def dedupe_keep_order(values: Any, max_length: int = MAX_MESSAGE_LENGTH) -> List[str]:
    source = values if isinstance(values, list) else []
    seen: Set[str] = set()
    result: List[str] = []
    for value in source:
        text = clean_text(value, max_length)
        key = normalize_for_match(text) if max_length == MAX_MESSAGE_LENGTH else text.casefold()
        if not text or not key or key in seen:
            continue
        seen.add(key)
        result.append(text)
    return result


def normalize_responses(value: Any) -> Dict[str, List[str]]:
    responses = value if isinstance(value, dict) else {}
    if any(isinstance(answer, str) and len(answer) > 4000 for style in SUPPORTED_STYLES
           for answer in (responses.get(style) or [])):
        raise RuntimeError("Approved chatbot replies must fit the 4000-character response contract")
    return {
        "en": dedupe_keep_order(responses.get("en"), 4000),
        "fil": dedupe_keep_order(responses.get("fil"), 4000),
        "taglish": dedupe_keep_order(responses.get("taglish"), 4000),
    }


def normalize_clarification(value: Any) -> Dict[str, str]:
    clarification = value if isinstance(value, dict) else {}
    return {
        style: clean_text(clarification.get(style, ""))
        for style in SUPPORTED_STYLES
    }


def parse_dataset_item(item: Dict[str, Any], index: int) -> Dict[str, Any]:
    intent_id = clean_text(item.get("id"))
    examples = dedupe_keep_order(item.get("examples"))
    aliases = dedupe_keep_order(item.get("aliases"))
    hard_negatives = dedupe_keep_order(item.get("hard_negatives"))
    responses = normalize_responses(item.get("responses"))
    if not intent_id or not examples or any(not responses[style] for style in SUPPORTED_STYLES):
        raise RuntimeError(f"Invalid v6 chatbot intent at index {index}: {DATASET_PATH}")
    variants = item.get("response_variants", {})
    if not isinstance(variants, dict) or len(variants) > 16:
        raise RuntimeError(f"Invalid response variants for {intent_id}")
    for key, answers in variants.items():
        if (not re.fullmatch(r"[a-z][a-z0-9_]{0,31}", key) or not isinstance(answers, dict)
                or set(answers) != SUPPORTED_STYLES
                or any(not isinstance(answers[style], list) or not answers[style]
                       or any(not isinstance(answer, str) or not answer.strip() for answer in answers[style])
                       for style in SUPPORTED_STYLES)):
            raise RuntimeError(f"Incomplete response variant {intent_id}.{key}")

    offers = validate_offers(intent_id, variants, item.get("assistant_offers", {}))
    return {
        **item,
        "id": intent_id,
        "description": clean_text(item.get("description")),
        "aliases": aliases,
        "examples": examples,
        "hard_negatives": hard_negatives,
        "clarification": normalize_clarification(item.get("clarification")),
        "requires_live_data": bool(item.get("requires_live_data", False)),
        "live_source": clean_text(item.get("live_source")),
        "policy_source": clean_text(item.get("policy_source")),
        "reviewed_at": clean_text(item.get("reviewed_at")),
        "priority": int(item.get("priority", 0) or 0),
        "fallback_only": bool(item.get("fallback_only", False)),
        "responses": responses,
        "response_variants": {key: normalize_responses(answers) for key, answers in variants.items()},
        "assistant_offers": offers,
    }


def load_dataset(path: Path) -> List[Dict[str, Any]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or raw.get("schema_version") != DATASET_SCHEMA_VERSION:
        raise RuntimeError(f"Chatbot dataset must use schema {DATASET_SCHEMA_VERSION}: {path}")

    intents: List[Dict[str, Any]] = []
    intent_ids: Set[str] = set()
    example_owners: Dict[str, str] = {}
    for index, item in enumerate(raw.get("items", [])):
        parsed = parse_dataset_item(item, index)
        intent_id = parsed["id"]
        if intent_id in intent_ids:
            raise RuntimeError(f"Duplicate v6 chatbot intent id '{intent_id}': {path}")
        intent_ids.add(intent_id)

        for example in parsed["examples"]:
            normalized = normalize_for_match(example)
            owner = example_owners.get(normalized)
            if owner and owner != intent_id:
                raise RuntimeError(
                    f"Duplicate normalized example '{example}' in '{owner}' and '{intent_id}'"
                )
            example_owners[normalized] = intent_id
        intents.append(parsed)

    if not intents:
        raise RuntimeError(f"No valid intents loaded from dataset: {path}")
    return intents


def detect_style(text: str) -> str:
    original = normalize_for_match(text)
    normalized = normalize_informal_text(text)
    tokens = tokenize(normalized)
    fil_hits = [token for token in tokens if token in FILIPINO_TOKENS and token not in ENGLISH_TOKENS]
    en_hits = [token for token in tokenize(original) if token in ENGLISH_TOKENS and token not in FILIPINO_TOKENS]
    if re.fullmatch(r"(?:okay|ok) (?:maraming )?salamat(?: po)?", original):
        en_hits.append("okay")
    filipino_grammar = bool(FILIPINO_GRAMMAR_PATTERN.search(normalized))
    if not filipino_grammar:
        if en_hits and not any(token not in {"at", "may"} for token in fil_hits):
            fil_hits = [token for token in fil_hits if token != "at"]
        if re.match(r"^may\s+(?:i|we|you|two|a|an|the)\b", normalized):
            fil_hits = [token for token in fil_hits if token != "may"]
    # Borrowed payment terms do not change a Filipino question's grammar.
    filipino_policy_question = re.match(r"^(?:paano|pano|ano ang (?:policy|patakaran)|may refund)\b", original)
    if filipino_policy_question and filipino_grammar and fil_hits and not re.search(r"\b(?:how|what|why|where|when|can|could|do|does|i|you|please|per|due date)\b", original):
        neutral_terms = {"booking", "payment", "refund", "policy", "late", "return"}
        if en_hits and all(token in neutral_terms for token in en_hits):
            en_hits = []
    english_domain = bool(ENGLISH_DOMAIN_PATTERN.search(original)) and bool(en_hits)
    if (fil_hits or filipino_grammar) and (en_hits or english_domain):
        return "taglish"
    if fil_hits:
        return "fil"
    return "en"


def extract_style_directive(message: str) -> Tuple[Optional[str], str]:
    match = STYLE_DIRECTIVE_PATTERN.match(message)
    if not match:
        return None, message
    style = "en" if match.group("en") else "fil" if match.group("fil") else "taglish"
    return style, message[match.end():].strip()


def resolve_style(requested_language: Optional[str], text: str, previous_language: Optional[str] = None) -> str:
    requested = normalize_for_match(requested_language or "")
    if requested and requested != "auto":
        mapped = REQUESTED_LANGUAGE_TO_STYLE.get(requested)
        if mapped in SUPPORTED_STYLES:
            return mapped
    directive, _ = extract_style_directive(text)
    if directive:
        return directive
    normalized = normalize_for_match(text)
    short_preference = re.fullmatch(
        r"(?:please\s+)?(english|filipino|tagalog|taglish)(?:\s+(?:lang|please|pls))*", normalized
    )
    if short_preference:
        return SUPPORTED_REPLY_LANGUAGES[LANGUAGE_ALIASES[short_preference.group(1)]]
    tokens = tokenize(normalized)
    previous = REQUESTED_LANGUAGE_TO_STYLE.get(normalize_for_match(previous_language or ""))
    has_language_signal = any(token in FILIPINO_TOKENS or token in ENGLISH_TOKENS for token in tokens)
    if previous and (short_followup_action(normalized) or contextual_request(normalized) or conversational_repair(normalized) or (len(tokens) <= 2 and (normalized in AMBIGUOUS_SHORT_FOLLOWUPS or not has_language_signal))):
        return previous
    return detect_style(text)


def build_indexes(intent_items: List[Dict[str, Any]]) -> Tuple[
    List[Dict[str, str]], Any, List[Dict[str, str]], Any, Dict[str, Set[str]], Dict[str, Set[str]]
]:
    positive_rows: List[Dict[str, str]] = []
    negative_rows: List[Dict[str, str]] = []
    exact_examples: Dict[str, Set[str]] = defaultdict(set)
    exact_aliases: Dict[str, Set[str]] = defaultdict(set)

    for item in intent_items:
        intent_id = item["id"]
        for example in item["examples"]:
            normalized = normalize_for_match(example)
            exact_examples[normalized].add(intent_id)
            if not item["fallback_only"]:
                positive_rows.append({"intent": intent_id, "text": example, "source": "example"})
        for alias in item["aliases"]:
            normalized = normalize_for_match(alias)
            exact_aliases[normalized].add(intent_id)
            if not item["fallback_only"]:
                positive_rows.append({"intent": intent_id, "text": alias, "source": "alias"})
        for hard_negative in item["hard_negatives"]:
            negative_rows.append({"intent": intent_id, "text": hard_negative, "source": "hard_negative"})

    if not positive_rows:
        raise RuntimeError("Intent example index is empty.")

    positive_embeddings = embedder.encode(
        [row["text"] for row in positive_rows], normalize_embeddings=True
    )
    negative_embeddings = (
        embedder.encode([row["text"] for row in negative_rows], normalize_embeddings=True)
        if negative_rows
        else None
    )
    return (
        positive_rows,
        positive_embeddings,
        negative_rows,
        negative_embeddings,
        exact_examples,
        exact_aliases,
    )


def phrase_in_query(alias: str, query: str) -> bool:
    if not alias or not query:
        return False
    return f" {alias} " in f" {query} "


def find_controlled_alias_matches(normalized_query: str) -> List[Dict[str, Any]]:
    matches: Dict[str, Dict[str, Any]] = {}
    for item in intent_items:
        for alias in item["aliases"]:
            normalized_alias = normalize_for_match(alias)
            if item["id"] == "chat_acknowledgement" and normalized_alias != normalized_query:
                continue
            if not phrase_in_query(normalized_alias, normalized_query):
                continue
            candidate = {
                "intent": item["id"],
                "alias": alias,
                "priority": item["priority"],
                "specificity": len(tokenize(normalized_alias)) * 100 + len(normalized_alias),
            }
            current = matches.get(item["id"])
            if current is None or (candidate["specificity"], candidate["priority"]) > (
                current["specificity"], current["priority"]
            ):
                matches[item["id"]] = candidate
    return sorted(
        matches.values(),
        key=lambda candidate: (candidate["specificity"], candidate["priority"], candidate["intent"]),
        reverse=True,
    )


def semantic_contextual_action(query):
    if not has_indirect_reference(query):
        return None
    similarities = cosine_similarity(embedder.encode([query], normalize_embeddings=True), CONTEXTUAL_EMBEDDINGS)[0]
    ranked = sorted(((max(float(similarities[i]) for i, (kind, _) in enumerate(CONTEXTUAL_ROWS) if kind == action), action)
                     for action in CONTEXTUAL_EXAMPLES), reverse=True)
    return ranked[0][1] if ranked[0][0] >= 0.72 and ranked[0][0] - ranked[1][0] >= 0.08 else None


def retrieve_intents(query: str, top_k: int = TOP_PREDICTIONS) -> List[Dict[str, Any]]:
    user_embedding = embedder.encode([query], normalize_embeddings=True)
    positive_similarities = cosine_similarity(user_embedding, POSITIVE_EMBEDDINGS)[0]
    best_by_intent: Dict[str, Dict[str, Any]] = {}
    for row, raw_score in zip(POSITIVE_ROWS, positive_similarities):
        score = float(raw_score)
        current = best_by_intent.get(row["intent"])
        if current is None or score > current["raw_score"]:
            best_by_intent[row["intent"]] = {
                "intent": row["intent"],
                "raw_score": score,
                "score": score,
                "matched_source": row["source"],
            }

    if NEGATIVE_EMBEDDINGS is not None:
        negative_similarities = cosine_similarity(user_embedding, NEGATIVE_EMBEDDINGS)[0]
        best_negative_by_intent: Dict[str, float] = {}
        for row, negative_score in zip(NEGATIVE_ROWS, negative_similarities):
            value = float(negative_score)
            best_negative_by_intent[row["intent"]] = max(
                best_negative_by_intent.get(row["intent"], -1.0), value
            )
        for intent_id, candidate in best_by_intent.items():
            negative_score = best_negative_by_intent.get(intent_id, -1.0)
            penalty = max(0.0, negative_score - HARD_NEGATIVE_FLOOR) * HARD_NEGATIVE_PENALTY
            candidate["hard_negative_score"] = negative_score
            candidate["score"] = candidate["raw_score"] - penalty

    alias_matches = find_controlled_alias_matches(normalize_for_match(query))
    if alias_matches:
        top_priority = alias_matches[0]["priority"]
        for index, alias_match in enumerate(alias_matches):
            candidate = best_by_intent.get(alias_match["intent"])
            if candidate is None:
                candidate = {
                    "intent": alias_match["intent"],
                    "raw_score": 0.0,
                    "score": 0.0,
                    "matched_source": "controlled_alias",
                }
                best_by_intent[alias_match["intent"]] = candidate
            priority_gap = max(0, top_priority - alias_match["priority"])
            alias_score = 0.94 if index == 0 else max(0.60, 0.90 - priority_gap * 0.01 - index * 0.03)
            if alias_score > candidate["score"]:
                candidate["score"] = alias_score
                candidate["matched_source"] = "controlled_alias"
                candidate["matched_alias"] = alias_match["alias"]

    ranked = sorted(
        best_by_intent.values(),
        key=lambda item: (item["score"], INTENTS_BY_ID[item["intent"]]["priority"], item["intent"]),
        reverse=True,
    )
    for candidate in ranked:
        candidate["score"] = max(0.0, min(1.0, float(candidate["score"])))
    return ranked[: max(1, top_k)]


def exact_candidates(normalized_query: str) -> Tuple[List[str], str]:
    examples = sorted(EXACT_EXAMPLES.get(normalized_query, set()))
    if examples:
        return examples, "exact_example"
    aliases = sorted(EXACT_ALIASES.get(normalized_query, set()))
    if aliases:
        return aliases, "exact_alias"
    return [], ""


def rank_exact_candidates(intent_ids: List[str]) -> List[Dict[str, Any]]:
    ordered = sorted(
        intent_ids,
        key=lambda intent_id: (INTENTS_BY_ID[intent_id]["priority"], intent_id),
        reverse=True,
    )
    if len(ordered) == 1:
        return [{"intent": ordered[0], "score": 0.99, "matched_source": "exact"}]
    base = 0.70
    return [
        {"intent": intent_id, "score": max(0.5, base - index * 0.01), "matched_source": "ambiguous_alias"}
        for index, intent_id in enumerate(ordered)
    ]


def prioritize_intent(
    candidates: List[Dict[str, Any]], intent_id: str, matched_source: str
) -> List[Dict[str, Any]]:
    promoted = {
        "intent": intent_id,
        "score": 0.995,
        "raw_score": 0.995,
        "matched_source": matched_source,
    }
    remaining = [candidate for candidate in candidates if candidate["intent"] != intent_id]
    return [promoted, *remaining[: max(0, TOP_PREDICTIONS - 1)]]


def select_response(intent_id: str, style: str, normalized_query: str) -> str:
    if intent_id == "chat_gender_identity" and FEMBOY_PATTERN.search(normalized_query):
        self_question = any(pattern.search(normalized_query) for pattern in SELF_GENDER_QUESTION_PATTERNS)
        return FEMBOY_REPLIES[style] if self_question else FEMBOY_DEFINITION_REPLIES[style]
    responses = INTENTS_BY_ID[intent_id]["responses"].get(style, [])
    if not responses:
        responses = INTENTS_BY_ID[intent_id]["responses"]["en"]
    if intent_id not in CONVERSATIONAL_INTENTS or len(responses) == 1:
        return responses[0]
    selection_key = f"{intent_id}:{style}:{normalized_query}"
    index = sum((position + 1) * ord(character) for position, character in enumerate(selection_key)) % len(responses)
    return responses[index]


def build_alternatives(candidates: List[Dict[str, Any]], exclude_intent: str = "") -> List[Dict[str, Any]]:
    alternatives = []
    for candidate in candidates:
        if candidate["intent"] == exclude_intent:
            continue
        alternatives.append({
            "intent": candidate["intent"],
            "confidence": round(float(candidate["score"]), 6),
        })
        if len(alternatives) >= MAX_ALTERNATIVES:
            break
    return alternatives


def clarification_reply(candidates: List[Dict[str, Any]], style: str, query: str = "") -> str:
    if not re.search(
        r"\b(?:payment|pay|bayad|balanse|balance|deposit|rate|price|cost|magkano|"
        r"booking|reservation|vehicle|vehicles|car|cars|kotse|suv|van|motorcycle|"
        r"pickup|return|rent|rental)\b",
        query,
        re.IGNORECASE,
    ):
        return GENERIC_CLARIFICATIONS[style]
    for candidate in candidates:
        clarification = INTENTS_BY_ID[candidate["intent"]]["clarification"].get(style)
        if clarification:
            return clarification
    return GENERIC_CLARIFICATIONS[style]


def language_capability_reply(query: str, style: str) -> Optional[str]:
    names = list(dict.fromkeys(
        label for alias, label in LANGUAGE_ALIASES.items() if phrase_in_query(alias, query)
    ))
    general = bool(re.search(
        r"\b(?:what|which|anong?|alin)\b.*\b(?:languages?|dialects?|wika|lenggwahe)\b.*"
        r"\b(?:you|support|use|speak|mo|ka|kaya)\b", query
    ))
    addressed = bool(re.search(
        r"\b(?:can|could|do|will|would)\s+you\s+(?:please\s+)?"
        r"(?:speak|reply|answer|respond|understand|know|translate)\b|"
        r"\bare\s+you\s+(?:good\s+at|fluent\s+in)\b|"
        r"^(?:marunong|kaya|pwede|puwede)\b.*\b(?:ka|mo)\b|"
        r"^(?:hindi|di)\s+ka\b.*\b(?:marunong|magsalita)\b|"
        r"^(?:please\s+)?(?:reply|answer|respond|speak|translate)\b.*\b(?:in|into|sa|using)\b",
        query,
    ))
    short_request = bool(names and len(tokenize(query)) <= 5 and (
        query in LANGUAGE_ALIASES or re.search(r"\b(?:walang?|lang|please|pls|pwede|puwede)\b", query)
    ))
    translation = bool(names and re.search(r"\b(?:word|translate|translation|salita|isalin)\b", query))
    explicit_speech = addressed and bool(re.search(
        r"\b(?:speak|fluent|reply in|respond in|answer in)\b", query
    ))
    if not general and not ((addressed or short_request or translation) and names) and not explicit_speech:
        return None
    supported = [name for name in names if name in SUPPORTED_REPLY_LANGUAGES]
    unsupported = [name for name in names if name not in SUPPORTED_REPLY_LANGUAGES]
    label = ", ".join(unsupported)
    if unsupported:
        reply = {
            "en": f"{label} replies aren't supported yet. I currently support English, Filipino, and Taglish.",
            "fil": f"Hindi pa suportado ang {label} sa mga sagot ko. Maaari kang magtanong sa English, Filipino, o Taglish.",
            "taglish": f"Hindi pa supported ang {label} replies. I currently support English, Filipino, and Taglish.",
        }[style]
        if supported:
            reply += {
                "en": f" I can reply in {', '.join(supported)}.",
                "fil": f" Maaari akong sumagot sa {', '.join(supported)}.",
                "taglish": f" I can reply in {', '.join(supported)}.",
            }[style]
        return reply
    return {
        "en": "I can understand and reply in English, Filipino, or Taglish. Ask your RentifyPro question in any of these.",
        "fil": "Naiintindihan at nasasagot ko ang English, Filipino, at Taglish. Magtanong tungkol sa RentifyPro sa alinman sa mga ito.",
        "taglish": "I can understand and reply in English, Filipino, or Taglish. Magtanong tungkol sa RentifyPro in any of these.",
    }[style]


def _classify_single(
    message: str, requested_language: Optional[str] = "auto", previous_language: Optional[str] = None,
    previous_context: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    clean_message = clean_text(message)
    style = resolve_style(requested_language, clean_message, previous_language)
    directive_style, question = extract_style_directive(clean_message)
    query_message = question if directive_style and question else clean_message
    normalized_message = normalize_for_match(query_message)
    informal_query = normalize_informal_text(query_message)
    if outside_scope(informal_query) or other_person_private_query(informal_query):
        private = other_person_private_query(informal_query)
        replies = {
            "en": "I can check only the signed-in renter's own booking status and balances. I cannot share another person's private records." if private else "I can help with RentifyPro vehicles, bookings, payments, accounts, and owner tasks. That question is outside those topics.",
            "fil": "Ang sariling booking status at balanse lamang ng naka-sign in na renter ang maaari kong tingnan. Hindi ko maibabahagi ang pribadong record ng iba." if private else "Makatutulong ako sa RentifyPro vehicles, bookings, payments, accounts, at owner tasks. Labas sa mga paksang iyon ang tanong mo.",
            "taglish": "I can check only the signed-in renter's own bookings and balances. Hindi ko maibabahagi ang private records ng iba." if private else "I can help with RentifyPro vehicles, bookings, payments, accounts, and owner tasks. Outside those topics ang question mo.",
        }
        return {"intent": "REJECT", "intent_id": "REJECT", "confidence": 0.99, "score": 0.99,
                "reply": replies[style], "language": style, "reply_lang": style,
                "entities": {"brand": None, "model": None}, "conditions": {}, "alternatives": [], "top_preds": [],
                "requires_clarification": False, "clarification": {"required": False, "type": None, "field": None},
                "requires_live_data": False, "live_source": "", "reason_code": "private_record_scope" if private else "outside_scope"}
    normalized_query = (
        informal_query
        if find_controlled_alias_matches(informal_query)
        else normalize_unique_known_typos(informal_query)
    )
    used_controlled_normalization = normalized_query != normalized_message
    entities = extract_query_entities(normalized_query, query_message)
    current_entities = dict(entities)
    conversation = validated_conversation_context(previous_context)
    reset_requested = conversation_reset_request(informal_query)
    if reset_requested or re.search(r"^(?:new (?:chat|conversation|search)|start over|reset|bagong usapan)\b", normalized_query):
        conversation = {}
    followup_action = short_followup_action(informal_query) or contextual_request(informal_query)
    repair = conversational_repair(informal_query)
    answer_type = requested_answer_type(informal_query)
    valid_task = conversation.get("intent") in INTENTS_BY_ID and conversation["intent"] not in CONVERSATIONAL_INTENTS
    frustration = frustration_variant(informal_query)
    if informal_query in {"huh", "hindi ko gets", "di ko gets"} and not valid_task:
        followup_action = None
    support_intent, support_variant = support_response_route(informal_query, conversation)
    if not support_intent:
        support_intent, support_variant = support_response_route(normalized_query, conversation)
    if support_variant == "unsupported_tricycle" and any(
            item["name"] == "tricycle" for item in INVENTORY_VOCABULARY.get().get("subtypes", [])):
        support_intent, support_variant = None, None
    explicit_intent = support_intent or practical_intent(normalized_query)
    if explicit_intent == "unclear_message" and followup_action:
        explicit_intent = None
    explicit_topic = topic_for_query(normalized_query, TOPICS)
    prior_task_topic = conversation.get("topic") or topic_for_intent(conversation.get("intent"), TOPICS)
    explicit_new_task = bool(valid_task and (
        (explicit_intent and explicit_intent != conversation["intent"])
        or (explicit_topic and prior_task_topic and explicit_topic != prior_task_topic)))
    if explicit_new_task:
        followup_action, repair = None, None
    elif not followup_action and not repair and valid_task:
        followup_action = semantic_contextual_action(informal_query)
    pending_offer = conversation.get("pending_offer") if not explicit_new_task else None
    offer_reply = offer_response(informal_query) if pending_offer else None
    offer_action = pending_offer["action"] if pending_offer and (offer_reply == "accept" or followup_action in {"continue", "explain", "reference"} or repair) else None
    if offer_action:
        followup_action = "offer"
        answer_type = "instructions" if offer_action == "instructions" else "overview"
    if repair:
        answer_type = "instructions" if offer_action == "instructions" else repair if repair != "unspecified" else conversation.get("requested_answer_type")
        if answer_type is None and valid_task:
            prior_variant = conversation.get("response_variant")
            answer_type = prior_variant if prior_variant in REQUESTED_ANSWER_TYPES else None
            if not prior_variant and conversation["intent"] in {"how_to_book", "owner_listing_guidance", "owner_booking_guidance"}:
                answer_type = "instructions"
        followup_action = "offer" if offer_action else "repair"
    if informal_query == "sure" and valid_task and not offer_action:
        followup_action = "confirm"
    contextual_intent = conversation.get("intent") if (followup_action
        and conversation.get("intent") in INTENTS_BY_ID and conversation["intent"] not in CONVERSATIONAL_INTENTS) else None
    search_result_explanation = (contextual_intent in {"available_vehicles", "available_transmission", "passenger_capacity", "vehicle_brand_search"}
        and (followup_action == "explain" or repair == "explanation")
        and answer_type != "instructions" and informal_query not in {"how", "paano", "pano", "can you show me how"}
        and conversation.get("response_variant") not in {"instructions", "navigation", "explanation", "troubleshooting", "continuation"})
    social_intent = social_question_intent(informal_query)
    if contextual_intent:
        social_intent = None
    if (conversation and topic_for_intent(conversation.get("intent"), TOPICS) == "vehicles"
        and re.search(r"\b(?:this car|that car|same car|this vehicle|that vehicle|this kotse|itong kotse|iyang kotse)\b", normalized_query)
        and not re.search(r"\b(?:sedans?|suvs?|vans?|trucks?|pickups?|motorcycles?|motor|motorsiklo)\b", normalized_query)):
        entities.pop("category", None)
        current_entities.pop("category", None)
    query_topic = topic_for_query(normalized_query, TOPICS)
    if contextual_intent:
        query_topic = topic_for_intent(contextual_intent, TOPICS)
    if support_intent:
        query_topic = topic_for_intent(support_intent, TOPICS)
    prior_topic = conversation.get("topic") or topic_for_intent(conversation.get("intent"), TOPICS)
    if (prior_topic == "vehicles" and query_topic == "booking"
        and any(key in current_entities for key in ("requested_date", "requested_return_date", "pickup_time", "return_time"))
        and not PICKUP_TIME_PATTERN.search(normalized_query)
        and not practical_intent(normalized_query)):
        query_topic = "vehicles"
    topic_changed = bool(query_topic and prior_topic and query_topic != prior_topic)
    clarified_intent = clarification_selection(normalized_query, conversation.get("candidate_intents", [])) if conversation.get("clarification", {}).get("required") else None
    unresolved_choice = False
    vehicle_context_intents = {"available_vehicles", "vehicle_brand_search", "available_transmission", "passenger_capacity", "rental_rate", "vehicle_availability_status", "vehicle_unavailability"}
    if conversation.get("intent") == "vehicle_categories" and conversation.get("entities", {}).get("category"):
        vehicle_context_intents.add("vehicle_categories")
    reference_followup = bool(conversation and not topic_changed and conversation["intent"] in vehicle_context_intents and (re.search(
        r"^(?:what about|how about|and|same|that one|the first|first one|second one|third one|it|cheaper|per day|per hour|daily|hourly|tomorrow|bukas|mas mura|yung una|yung pangalawa|how much.*(?:it|that|first|second|third)|magkano.*(?:iyan|ito|una))\b", normalized_query
    ) or (conversation.get("clarification", {}).get("required") and normalized_query in {"yes", "oo", "opo"})
      or (prior_topic == "vehicles" and re.fullmatch(r"(?:the )?(?:unavailable|not available|unavailable vehicles|unavailable listings|which ones|show them|list them|how many|why|bakit|how|paano|tell me more|more details|explain|explain please|hindi ko gets|di ko gets)", normalized_query))))
    if contextual_intent and prior_topic == "vehicles":
        reference_followup = True
    filter_followup = bool(conversation and not topic_changed and prior_topic == "vehicles"
        and not entities.get("brand") and not entities.get("category")
        and (any(key in entities for key in ("pax", "specification_requested", "transmission", "fuel", "excluded_fuels", "excluded_subtypes", "self_drive_only", "max_budget", "duration_value", "rate_unit", "sort_by", "driver_requested", "requested_schedule", "requested_date", "requested_return_date", "pickup_time", "return_time", "location"))
             or RATE_QUERY_PATTERN.search(normalized_query) or entities.get("quote_requested")))
    reference_followup = reference_followup or filter_followup
    if (conversation and not topic_changed and prior_topic == "vehicles" and current_entities.get("brand")
            and re.search(r"\b(?:same (?:filters|requirements|seat requirement|seats|capacity|budget|location|schedule)|parehong (?:filters|upuan))\b", informal_query)):
        reference_followup = True
    if (conversation.get("entities", {}).get("specification_requested")
        and conversation.get("clarification", {}).get("field") == "model"
        and ((entities.get("brand") and len(tokenize(normalized_query)) <= 5)
             or re.fullmatch(r"(?:the )?(?:first|second|third)(?: one| option)?", normalized_query))):
        reference_followup = True
    if (conversation.get("intent") == "rental_rate" and not topic_changed
        and conversation.get("clarification", {}).get("field") == "model"
        and entities.get("brand") and len(tokenize(normalized_query)) <= 5):
        reference_followup = True
    if (conversation.get("intent") == "vehicle_availability_status" and not topic_changed
        and entities.get("brand") and len(tokenize(normalized_query)) <= 4
        and not RATE_QUERY_PATTERN.search(normalized_query)):
        reference_followup = True
    explicit_followup_intent = practical_intent(informal_query) or practical_intent(normalized_query)
    policy_aliases = {match["intent"] for match in find_controlled_alias_matches(normalized_query)
                      if match["intent"] in BRAND_CONTEXT_POLICY_INTENTS}
    if not explicit_followup_intent and len(policy_aliases) == 1:
        explicit_followup_intent = next(iter(policy_aliases))
    if RATE_QUERY_PATTERN.search(normalized_query) and not explicit_followup_intent:
        explicit_followup_intent = "rental_rate"
    status_followup = bool(reference_followup and conversation["intent"] == "vehicle_availability_status"
        and explicit_followup_intent in {None, "unclear_message", "vehicle_availability_status"})
    if reference_followup:
        prior_entities = conversation.get("entities", {})
        if current_entities.get("brand") and not re.search(r"\b(?:same (?:filters|requirements|seat requirement|seats|capacity)|parehong (?:filters|upuan))\b", informal_query):
            prior_entities = ({key: value for key, value in prior_entities.items() if key not in {"pax", "seat_match"}}
                              if conversation.get("intent") == "rental_rate" else {key: value for key, value in prior_entities.items()
                              if (key == "category" and value in {"car", "truck", "van", "motorcycle"}
                                  and not any(prior_entities.get(field) for field in ("brand", "vehicle_subtype", "pax")))
                              or (key == "specification_requested" and conversation.get("clarification", {}).get("field") == "model")})
        if (current_entities.get("vehicle_subtype") and current_entities["vehicle_subtype"] != prior_entities.get("vehicle_subtype")
                and not current_entities.get("brand") and not re.search(r"\b(?:same brand|same filters|parehong brand)\b", informal_query)):
            prior_entities = {key: value for key, value in prior_entities.items() if key not in {"brand", "model", "listing_id"}}
        if prior_entities.get("brand") and not entities.get("brand") and not entities.get("model"):
            refinement = re.fullmatch(r"(?:how about|what about|and) (.+)", normalized_query)
            models = {choice["model"] for choice in conversation.get("choices", [])
                      if choice.get("brand") == prior_entities["brand"] and choice.get("model")
                      and refinement and normalize_for_match(choice["model"]) == refinement.group(1)}
            if len(models) == 1:
                entities["model"] = current_entities["model"] = models.pop()
        if (current_entities.get("category") and current_entities["category"] != prior_entities.get("category")
            and not re.search(r"\b(?:same filters|same requirements|parehong filters)\b", informal_query)):
            carried = set()
            for pattern, keys in (
                (r"\b(?:same budget|parehong budget)\b", ("max_budget", "currency", "rate_unit")),
                (r"\b(?:same location|same place|parehong lugar)\b", ("location",)),
                (r"\b(?:same schedule|same dates|parehong schedule)\b", ("requested_schedule", "requested_date", "requested_return_date", "pickup_time", "return_time")),
            ):
                if re.search(pattern, informal_query):
                    carried.update(keys)
            prior_entities = {key: value for key, value in prior_entities.items() if key in carried}
        entities = {**prior_entities, **{key: item for key, item in entities.items() if item is not None}}
        if entities.get("vehicle_subtype") in entities.get("excluded_subtypes", []):
            entities.pop("vehicle_subtype", None)
        if (current_entities.get("category") and current_entities["category"] != prior_entities.get("category")):
            for key in ("brand", "model", "listing_id", "vehicle_subtype"):
                if not current_entities.get(key):
                    entities.pop(key, None)
        if current_entities.get("brand") and entities.get("brand") != prior_entities.get("brand"):
            entities["model"] = extract_vehicle_entities(normalized_query).get("model")
            entities.pop("listing_id", None)
        elif current_entities.get("model") and current_entities["model"] != prior_entities.get("model"):
            entities.pop("listing_id", None)
        if current_entities.get("requested_date"):
            for key in ("requested_return_date", "pickup_time", "return_time"):
                if key not in current_entities:
                    entities.pop(key, None)
            if all(key in current_entities for key in ("requested_return_date", "pickup_time", "return_time")) and "duration_value" not in current_entities:
                entities.pop("duration_value", None)
                entities.pop("duration_unit", None)
        if current_entities.get("transmission"):
            entities["excluded_transmissions"] = [item for item in entities.get("excluded_transmissions", []) if item != current_entities["transmission"]]
        if current_entities.get("fuel"):
            entities["excluded_fuels"] = [item for item in entities.get("excluded_fuels", []) if item != current_entities["fuel"]]
        if current_entities.get("vehicle_subtype"):
            entities["excluded_subtypes"] = [item for item in entities.get("excluded_subtypes", []) if item != current_entities["vehicle_subtype"]]
        if "driver_requested" in current_entities and not current_entities.get("self_drive_only"):
            entities.pop("self_drive_only", None)
        if "driver_requested" in current_entities and not current_entities.get("driver_included_required"):
            entities.pop("driver_included_required", None)
        choice_index = next((index for index, pattern in enumerate((r"\b(?:first|una)\b", r"\b(?:second|pangalawa)\b", r"\b(?:third|pangatlo)\b")) if re.search(pattern, normalized_query)), None)
        if choice_index is not None and choice_index < len(conversation.get("choices", [])):
            entities.update(conversation["choices"][choice_index])
        elif choice_index is not None:
            unresolved_choice = True
        elif re.search(r"\b(?:this car|that car|same car|this vehicle|that vehicle|this suv|itong kotse|iyang kotse|this one|that one|same one|it|iyan|ito|yung isa)\b", normalized_query) and not current_entities.get("brand"):
            if len(conversation.get("choices", [])) == 1:
                entities.update(conversation["choices"][0])
            elif len(conversation.get("choices", [])) > 1 and not entities.get("listing_id"):
                unresolved_choice = True
        if entities.get("duration_value") and (RATE_QUERY_PATTERN.search(normalized_query)
            or re.search(r"^(?:how about|what about|paano kung|kung)", normalized_query)
            or "duration_value" in current_entities
            or (conversation.get("intent") == "rental_rate" and (conversation.get("clarification", {}).get("required") or "duration_value" in current_entities))):
            entities["quote_requested"] = True
        if re.search(r"\b(?:cheaper|mas mura)\b", normalized_query):
            entities.pop("brand", None)
            entities.pop("model", None)
            entities.pop("listing_id", None)
            entities.update({"brand": None, "model": None})
    pending = validated_pending_search(previous_context)
    context_followup = reference_followup or bool(pending and entities.get("rate_unit")
                            and len(tokenize(normalized_query)) <= 3
                            and not entities.get("brand") and not entities.get("category")
                            and "max_budget" not in entities)
    if pending and context_followup:
        entities = {"brand": None, "model": None, **pending, "rate_unit": entities["rate_unit"]}
    entities.setdefault("brand", None)
    entities.setdefault("model", None)
    if current_entities.get("specification_requested"):
        selector = {key: entities[key] for key in ("brand", "model", "listing_id") if entities.get(key)}
        entities = {"brand": None, "model": None, **selector,
                    "specification_requested": current_entities["specification_requested"]}
    elif reference_followup and any(key in current_entities for key in (
        "category", "pax", "fuel", "transmission", "driver_requested", "self_drive_only", "duration_value")):
        entities.pop("specification_requested", None)
    if (current_entities.get("rate_unit") and RATE_QUERY_PATTERN.search(normalized_query)
        and not current_entities.get("duration_value") and not current_entities.get("quote_requested")
        and (entities.get("duration_value") or entities.get("quote_requested"))):
        entities["quote_requested"] = False
    conditions = extract_conditions(normalized_query)
    if status_followup:
        conditions.update(conversation.get("conditions", {}))
        if entities.get("model"):
            for key in STATUS_CONDITIONS:
                conditions.pop(key, None)
    if status_followup and not entities.get("brand") and not conversation.get("clarification", {}).get("required"):
        conditions["vehicle_status_overview"] = True

    def with_details(result: Dict[str, Any], clarification_type: Optional[str] = None,
                     clarification_field: Optional[str] = None) -> Dict[str, Any]:
        if result.get("intent") not in {"REJECT", "vehicle_availability_status"}:
            for key in STATUS_CONDITIONS:
                conditions.pop(key, None)
        if result.get("intent") not in {"REJECT", "payment_troubleshooting"}:
            conditions.pop("payment_option_unavailable", None)
        return {
            **result,
            **({"requested_answer_type": answer_type} if answer_type in REQUESTED_ANSWER_TYPES and result.get("intent") not in CONVERSATIONAL_INTENTS else {}),
            "language": style,
            "reply_lang": style,
            "entities": entities,
            "conditions": conditions,
            "topic": topic_for_intent(result.get("intent"), TOPICS) or result.get("topic"),
            "candidate_intents": result.get("candidate_intents", []),
            "clarification": {
                "required": bool(result.get("requires_clarification")),
                "type": clarification_type,
                "field": clarification_field,
            },
        }

    if reset_requested:
        entities, conditions = {"brand": None, "model": None}, {}
        return with_details({"intent": "chat_greeting", "intent_id": "chat_greeting", "confidence": 0.99, "score": 0.99,
            "reply": INTENTS_BY_ID["chat_greeting"]["response_variants"]["reset"][style][0], "response_variant": "reset",
            "requires_clarification": False, "requires_live_data": False, "live_source": "",
            "alternatives": [], "top_preds": [], "reason_code": "conversation_reset"})
    if frustration:
        entities, conditions = {"brand": None, "model": None}, {}
        variant = frustration + ("_context" if valid_task else "")
        return with_details({"intent": "chat_acknowledgement", "intent_id": "chat_acknowledgement",
            "confidence": 0.99, "score": 0.99,
            "reply": INTENTS_BY_ID["chat_acknowledgement"]["response_variants"][variant][style][0],
            "response_variant": variant, "requires_clarification": False, "requires_live_data": False,
            "live_source": "", "alternatives": [], "top_preds": [], "reason_code": "conversational_frustration"})
    conflict = specification_conflict(query_message)
    if conflict and (entities.get("category") or re.search(r"\b(?:find|show|looking|need|hanap)\b", informal_query)):
        return with_details({"intent": "available_vehicles", "confidence": 0.99, "score": 0.99,
            "reply": TOPICS["vehicles"]["clarification"][style], "requires_clarification": True,
            "requires_live_data": False, "live_source": "", "alternatives": [], "top_preds": [],
            "reason_code": "conflicting_vehicle_specifications"}, "ambiguous_entity", conflict)
    if offer_reply == "decline":
        entities, conditions = {"brand": None, "model": None}, {}
        return with_details({"intent": "chat_acknowledgement", "confidence": 0.99,
            "reply": INTENTS_BY_ID["chat_acknowledgement"]["responses"][style][0],
            "requires_clarification": False, "requires_live_data": False,
            "reason_code": "assistant_offer_declined"})
    if (conversation.get("clarification", {}).get("required") and len(conversation.get("candidate_intents", [])) > 1
        and re.fullmatch(r"(?:yes|oo|opo)(?: po)?", informal_query)):
        spec = TOPICS.get(conversation.get("topic"))
        reply = spec["clarification"][style] if spec else {
            "en": "Do you mean unavailable vehicles or an unavailable payment option?",
            "fil": "Unavailable na sasakyan o hindi available na payment option ba ang tinutukoy mo?",
            "taglish": "Unavailable vehicles or an unavailable payment option ba ang tinutukoy mo?",
        }[style]
        entities, conditions = conversation.get("entities", {}), conversation.get("conditions", {})
        return with_details({"intent": "REJECT", "intent_id": "REJECT", "confidence": 0.99, "score": 0.99,
            "reply": reply, "topic": conversation.get("topic"),
            "candidate_intents": conversation["candidate_intents"], "requires_clarification": True,
            "requires_live_data": False, "live_source": "", "alternatives": [], "top_preds": [],
            "reason_code": "clarification_selection_required"}, "ambiguous_intent")
    if repair and (not valid_task or answer_type not in {"instructions", "navigation", "explanation", "troubleshooting"}):
        entities, conditions = {"brand": None, "model": None}, {}
        reply = {
            "en": "Which task do you mean: messaging the owner, booking, payment, or verification?" if not valid_task else "For that task, do you need the steps, where to click, or help with an error?",
            "fil": "Aling gawain ang tinutukoy mo: pag-message sa owner, booking, pagbabayad, o verification?" if not valid_task else "Para sa gawaing iyon, kailangan mo ba ng mga hakbang, kung saan pipindutin, o tulong sa error?",
            "taglish": "Which task ang tinutukoy mo: messaging the owner, booking, payment, or verification?" if not valid_task else "For that task, steps, where to click, or help with an error ba ang kailangan mo?",
        }[style]
        return with_details({"intent": "REJECT", "intent_id": "REJECT", "confidence": 0.99, "score": 0.99,
            "reply": reply, "requires_clarification": True, "requires_live_data": False, "live_source": "",
            "alternatives": [], "top_preds": [], "reason_code": "conversation_repair_clarification"}, "ambiguous_intent")
    if followup_action and not contextual_intent:
        spec = TOPICS.get(conversation.get("topic")) if conversation.get("intent") not in CONVERSATIONAL_INTENTS else None
        entities, conditions = {"brand": None, "model": None}, {}
        reply = spec["clarification"][style] if spec else {
            "en": "Which task do you mean: verification, messaging the owner, booking, payment, or finding a vehicle?",
            "fil": "Aling gawain ang tinutukoy mo: verification, pag-message sa owner, booking, pagbabayad, o paghahanap ng sasakyan?",
            "taglish": "Which task ang tinutukoy mo: verification, messaging the owner, booking, payment, or finding a vehicle?",
        }[style]
        return with_details({"intent": "REJECT", "intent_id": "REJECT", "confidence": 0.99, "score": 0.99,
            "reply": reply, "requires_clarification": True, "requires_live_data": False, "live_source": "",
            "topic": conversation.get("topic"), "candidate_intents": spec["candidates"] if spec else [],
            "alternatives": [], "top_preds": [], "reason_code": "missing_followup_context"}, "ambiguous_intent")
    if social_intent:
        entities, conditions = {"brand": None, "model": None}, {}
        item = INTENTS_BY_ID[social_intent]
        variant = "working" if social_intent == "chat_wellbeing" else None
        return with_details({"intent": social_intent, "intent_id": social_intent, "confidence": 0.99, "score": 0.99,
            "reply": item["response_variants"][variant][style][0] if variant else item["responses"][style][0],
            **({"response_variant": variant} if variant else {}), "requires_clarification": False,
            "requires_live_data": False, "live_source": "", "alternatives": [], "top_preds": [], "reason_code": "conversational_question"})

    if directive_style and not question:
        reply = {
            "en": "I'll reply in English. What would you like to know about your rental?",
            "fil": "Sasagot ako sa Filipino. Ano ang gusto mong malaman tungkol sa rental mo?",
            "taglish": "I'll reply in Taglish. Ano ang gusto mong malaman sa rental mo?",
        }[style]
        return with_details({
            "intent": "chat_language_support", "intent_id": "chat_language_support",
            "confidence": 0.99, "score": 0.99, "reply": reply,
            "alternatives": [], "top_preds": [], "requires_clarification": False,
            "matched_alias": "", "reason_code": "language_preference",
            "requires_live_data": False, "live_source": "",
        })

    capability_reply = language_capability_reply(informal_query, style)
    if capability_reply:
        entities = {"brand": None, "model": None}
        conditions = {}
        return with_details({
            "intent": "chat_language_support", "intent_id": "chat_language_support",
            "confidence": 0.99, "score": 0.99, "reply": capability_reply,
            "alternatives": [], "top_preds": [], "requires_clarification": False,
            "matched_alias": "", "reason_code": "language_capability",
            "requires_live_data": False, "live_source": "",
        })

    if conversation.get("suggested_brand") and normalized_query in {"yes", "yes please", "oo", "opo", "sige"}:
        entities = {"brand": conversation["suggested_brand"], "model": None}
        context_followup = True

    if unresolved_choice:
        return with_details({"intent": "REJECT", "intent_id": "REJECT", "confidence": 0.99, "score": 0.99,
            "reply": {"en": "Which vehicle do you mean? Please provide its name; I do not have that numbered option in the current conversation.",
                      "fil": "Aling sasakyan ang tinutukoy mo? Ibigay ang pangalan nito; wala ang numerong iyon sa kasalukuyang pagpipilian.",
                      "taglish": "Which vehicle ang tinutukoy mo? Please give its name; wala ang numbered option na iyon sa current conversation."}[style],
            "requires_clarification": True, "requires_live_data": False, "live_source": "", "alternatives": [], "top_preds": [],
            "reason_code": "missing_vehicle_choice"}, "ambiguous_entity", "model")

    if entities.get("specification_requested"):
        missing = not (entities.get("listing_id") or (entities.get("brand") and entities.get("model")))
        return with_details({"intent": "available_vehicles", "confidence": 0.99, "score": 0.99,
            "reply": {"en": "Which vehicle listing do you mean?", "fil": "Aling vehicle listing ang tinutukoy mo?", "taglish": "Which vehicle listing ang tinutukoy mo?"}[style],
            "requires_clarification": missing, "requires_live_data": not missing,
            "live_source": "GET /api/vehicles", "reason_code": "listing_specification_question",
            "alternatives": [], "top_preds": []}, "missing_entity" if missing else None, "model" if missing else None)
    bare_unavailable = bool(re.fullmatch(r"(?:the )?(?:unavailable|not available)", normalized_query))
    if bare_unavailable and not reference_followup:
        conditions["vehicle_status_unavailable"] = True
        return with_details({"intent": "REJECT", "intent_id": "REJECT", "confidence": 0.99, "score": 0.99,
            "reply": {"en": "Do you mean unavailable vehicles or an unavailable payment option?",
                      "fil": "Unavailable na sasakyan o hindi available na payment option ba ang tinutukoy mo?",
                      "taglish": "Unavailable vehicles or an unavailable payment option ba ang tinutukoy mo?"}[style],
            "candidate_intents": ["vehicle_availability_status", "payment_troubleshooting"],
            "alternatives": [], "top_preds": [], "requires_clarification": True,
            "requires_live_data": False, "live_source": "", "reason_code": "topic_clarification"}, "ambiguous_intent")

    if normalized_query in {"account", "my account", "verification", "owner", "support", "payment", "payments", "vehicle", "vehicles", "sasakyan"} and not clarified_intent:
        topic = {"my account": "account", "payments": "payment", "vehicle": "vehicles", "sasakyan": "vehicles"}.get(normalized_query, normalized_query)
        spec = TOPICS[topic]
        return with_details({"intent": "REJECT", "intent_id": "REJECT", "confidence": 0.99, "score": 0.99,
            "reply": spec["clarification"][style], "topic": topic, "candidate_intents": spec["candidates"],
            "alternatives": build_alternatives(rank_exact_candidates(spec["candidates"])), "top_preds": [], "requires_clarification": True,
            "requires_live_data": False, "live_source": "", "reason_code": "topic_clarification"}, "ambiguous_intent")

    unavailable_intent, status_conditions = availability_request(
        normalized_query, entities, reference_followup and prior_topic == "vehicles"
    )
    if search_result_explanation or (support_intent == "choose_specific_model" and support_variant == "unavailable"):
        unavailable_intent, status_conditions = None, {}
    conditions.update(status_conditions)
    if status_followup:
        if re.fullmatch(r"(?:which ones|show them|list them)", normalized_query):
            conditions["vehicle_status_list"] = True
        elif re.fullmatch(r"how many", normalized_query):
            conditions.pop("vehicle_status_list", None)
    if clarified_intent == "vehicle_availability_status":
        unavailable_intent = clarified_intent
        conditions.update(conversation.get("conditions", {}))
        conditions["vehicle_status_overview"] = True
    if status_followup and not unavailable_intent:
        unavailable_intent = "vehicle_availability_status"
    if unavailable_intent:
        if unavailable_intent == "available_vehicles":
            entities = {key: value for key, value in entities.items() if key not in {"brand", "model"}}
            entities.update({"brand": None, "model": None})
        elif unavailable_intent == "vehicle_availability_status":
            if "max_budget" in entities and "rate_unit" not in entities:
                amount = f"PHP {entities['max_budget']:,.0f}"
                reply = {"en": f"Is your {amount} budget per day or per hour?", "fil": f"Ang {amount} budget mo ba ay bawat araw o bawat oras?", "taglish": f"Yung {amount} budget mo ba ay per day or per hour?"}[style]
                return with_details({"intent": unavailable_intent, "intent_id": unavailable_intent, "confidence": 0.99, "score": 0.99,
                    "reply": reply, "alternatives": [], "top_preds": [], "requires_clarification": True,
                    "matched_alias": "", "reason_code": "missing_rate_unit", "requires_live_data": False,
                    "live_source": INTENTS_BY_ID[unavailable_intent]["live_source"]}, "missing_entity", "rate_unit")
            overview = conditions.get("vehicle_status_overview")
            if overview or (reference_followup and not entities.get("brand") and conversation.get("clarification", {}).get("field") == "rate_unit"):
                conditions["vehicle_status_overview"] = True
            elif not entities.get("brand") and not conditions.get("vehicle_status_overview"):
                item = INTENTS_BY_ID[unavailable_intent]
                return with_details({
                    "intent": unavailable_intent, "intent_id": unavailable_intent,
                    "confidence": 0.99, "score": 0.99,
                    "reply": item["clarification"][style],
                    "alternatives": [], "top_preds": [], "requires_clarification": True,
                    "matched_alias": "", "reason_code": "missing_vehicle",
                    "requires_live_data": False, "live_source": item["live_source"],
                }, "missing_entity", "model")
        if unavailable_intent != "available_vehicles":
            item = INTENTS_BY_ID[unavailable_intent]
            return with_details({
                "intent": unavailable_intent, "intent_id": unavailable_intent,
                "confidence": 0.99, "score": 0.99,
                "reply": item["responses"][style][0],
                "alternatives": [], "top_preds": [], "requires_clarification": False,
                "matched_alias": "", "reason_code": "vehicle_unavailability_context",
                "requires_live_data": item["requires_live_data"], "live_source": item["live_source"],
            })

    if not normalized_query:
        return with_details({
            "intent": "REJECT",
            "intent_id": "REJECT",
            "confidence": 0.0,
            "score": 0.0,
            "language": style,
            "reply_lang": style,
            "reply": GENERIC_CLARIFICATIONS[style],
            "alternatives": [],
            "top_preds": [],
            "requires_clarification": True,
            "matched_alias": "",
            "reason_code": "empty_message",
            "requires_live_data": False,
            "live_source": "",
            "entities": entities,
        }, "unknown_intent")

    brands = [brand for brand in mentioned_brands(normalized_query) if brand not in entities.get("excluded_brands", [])]
    if len(brands) > 1:
        entities = {"brand": None, "model": None}
        names = " and ".join(brands)
        reply = {
            "en": f"Are you asking me to compare current {names} vehicle listings?",
            "fil": f"Gusto mo bang ihambing ang kasalukuyang {names} vehicle listings?",
            "taglish": f"Gusto mo bang i-compare ang current {names} vehicle listings?",
        }[style]
        return with_details({
            "intent": "REJECT", "intent_id": "REJECT", "confidence": 0.7, "score": 0.7,
            "reply": reply, "alternatives": [], "top_preds": [], "requires_clarification": True,
            "matched_alias": "", "reason_code": "multiple_brands",
            "requires_live_data": False, "live_source": "",
        }, "ambiguous_entity", "brand")

    suggested_brand = find_safe_brand_typo(normalized_query) if not entities["brand"] else None
    if suggested_brand:
        typo_candidates = [{
            "intent": "vehicle_brand_search",
            "score": 0.74,
            "matched_source": "brand_spelling_clarification",
        }]
        return with_details({
            "intent": "REJECT",
            "intent_id": "REJECT",
            "confidence": 0.74,
            "score": 0.74,
            "language": style,
            "reply_lang": style,
            "reply": brand_typo_reply(suggested_brand, style),
            "alternatives": build_alternatives(typo_candidates),
            "top_preds": [{
                "intent_id": "vehicle_brand_search",
                "id": "vehicle_brand_search",
                "score": 0.74,
            }],
            "requires_clarification": True,
            "matched_alias": "",
            "reason_code": "brand_spelling_clarification",
            "requires_live_data": False,
            "live_source": "",
            "entities": entities,
            "suggested_brand": suggested_brand,
        }, "spelling_confirmation", "brand")

    matched_ids, exact_reason = exact_candidates(normalized_query)
    candidates = rank_exact_candidates(matched_ids) if matched_ids else retrieve_intents(normalized_query)
    decision_reason = (
        "controlled_text_normalization"
        if used_controlled_normalization
        and not exact_reason
        and candidates
        and candidates[0].get("matched_source") != "controlled_alias"
        else ""
    )
    self_gender_question = any(pattern.search(normalized_query) for pattern in SELF_GENDER_QUESTION_PATTERNS)
    personal_booking_intent = next(
        (intent_id for intent_id, patterns in PERSONAL_BOOKING_PATTERNS
         if any(pattern.search(normalized_query) for pattern in patterns)),
        None,
    )
    pickup_time = bool(PICKUP_TIME_PATTERN.search(normalized_query))
    vehicle_budget_search = "max_budget" in entities and bool(entities.get("brand") or entities.get("category") or re.search(r"\b(?:vehicles?|sasakyan|rental)\b", normalized_query))
    practical = contextual_intent or support_intent or practical_intent(informal_query) or practical_intent(normalized_query)
    if not pickup_time and re.search(r"\bpick ?up (?:my|our|the|your|this|that) (?:truck|vehicle|car|van|motorcycle)\b", normalized_query):
        practical = "pickup_location"
    rental_intent = rental_search_intent(normalized_query, entities)
    if rental_intent == "available_vehicles" and practical == "driver_option":
        practical = None
    if reference_followup and conversation.get("intent") == "rental_rate" and "driver_requested" in current_entities:
        rental_intent = "rental_rate"
    if reference_followup and not practical and not rental_intent and explicit_followup_intent in BRAND_CONTEXT_POLICY_INTENTS:
        practical = explicit_followup_intent
    if practical == "unpaid_balance":
        personal_booking_intent = None
    if re.search(r"\b(?:gcash|maya|payment|checkout)\b", normalized_query) and re.search(r"\b(?:unavailable|not available|disabled|not working)\b", normalized_query):
        practical = "payment_troubleshooting"
        conditions["payment_option_unavailable"] = True
    if vehicle_budget_search and practical == "available_transmission":
        practical = None
    policy_followup = bool(conversation and not topic_changed and conversation["intent"] in INTENTS_BY_ID
        and conversation["intent"] not in CONVERSATIONAL_INTENTS and re.fullmatch(
            r"(?:why|bakit|how|paano|explain|explain please|tell me more|more details|i don'?t understand|hindi ko gets|di ko gets)", normalized_query))
    if conversation and not topic_changed and conversation["intent"] in INTENTS_BY_ID and (practical == "unclear_message" or policy_followup):
        practical = conversation["intent"]
        if conversation["intent"] == "payment_troubleshooting":
            conditions.update(conversation.get("conditions", {}))
    if clarified_intent and clarified_intent != "vehicle_availability_status":
        candidates = prioritize_intent(candidates, clarified_intent, "clarification_answer")
        decision_reason = "clarification_answer"
        conditions = {"payment_option_unavailable": True} if clarified_intent == "payment_troubleshooting" and conversation.get("conditions", {}).get("vehicle_status_unavailable") else {}
    elif unavailable_intent == "available_vehicles":
        candidates = prioritize_intent(candidates, "available_vehicles", "vehicle_alternatives")
        decision_reason = "vehicle_alternatives"
    elif self_gender_question:
        candidates = prioritize_intent(candidates, "chat_gender_identity", "assistant_gender_question")
        decision_reason = "assistant_gender_question"
    elif personal_booking_intent:
        candidates = prioritize_intent(candidates, personal_booking_intent, "renter_booking_status_question")
        decision_reason = "renter_booking_status_question"
    elif practical:
        candidates = prioritize_intent(candidates, practical, "practical_question")
        decision_reason = "practical_question"
    elif rental_intent:
        candidates = prioritize_intent(candidates, rental_intent, "rental_search_request")
        decision_reason = "rental_search_request"
    elif pickup_time:
        candidates = prioritize_intent(candidates, "booking_pickup_time", "pickup_time_context")
        decision_reason = "pickup_time_context"
    elif vehicle_budget_search or context_followup:
        target = "rental_rate" if reference_followup and (RATE_QUERY_PATTERN.search(normalized_query) or entities.get("quote_requested")) else "available_vehicles"
        candidates = prioritize_intent(candidates, target, "vehicle_budget_context")
        decision_reason = "vehicle_budget_context"
    elif entities["brand"]:
        current_intent = candidates[0]["intent"] if candidates else ""
        if RATE_QUERY_PATTERN.search(normalized_query):
            target_intent = "rental_rate"
            decision_reason = "brand_rate_context"
        elif current_intent in BRAND_CONTEXT_POLICY_INTENTS and re.search(
            r"\b(?:insurance|deposit|deposito|full tank|refill|refuel|fuel|gasolina|driver|chauffeur|drayber)\b", normalized_query
        ):
            target_intent = current_intent
        else:
            target_intent = "vehicle_brand_search"
            decision_reason = "recognized_brand"
        if (
            target_intent in {"rental_rate", "vehicle_brand_search"}
            or not candidates
            or candidates[0]["intent"] != target_intent
        ):
            candidates = prioritize_intent(candidates, target_intent, decision_reason or "recognized_brand")

    top_score = float(candidates[0]["score"]) if candidates else 0.0
    second_score = float(candidates[1]["score"]) if len(candidates) > 1 else 0.0
    margin = top_score - second_score
    exact_ambiguous = exact_reason == "exact_alias" and len(matched_ids) > 1
    low_confidence = top_score < CONFIDENCE_THRESHOLD
    gender_reference = re.search(
        rf"\b(?:gender|sex|sexuality|sexual\s+orientation|kasarian|{ASSISTANT_IDENTITY_TERMS})\b", normalized_query)
    assistant_reference = re.search(r"\b(?:you|your|chatbot|assistant|rentify\s+ai|ikaw|ka|mo)\b", normalized_query)
    femboy_definition = FEMBOY_PATTERN.search(normalized_query) and re.search(
        r"\b(?:what\s+(?:is|does)|meaning|mean|definition|define|explain|ano|ibig\s+sabihin|sexual\s+orientation)\b", normalized_query)
    # Semantic similarity alone cannot establish an assistant gender question.
    unsupported_gender_match = bool(candidates and candidates[0]["intent"] == "chat_gender_identity"
        and not (self_gender_question or (gender_reference and assistant_reference) or femboy_definition))
    ambiguous = (len(candidates) > 1 and margin < CLARIFICATION_MARGIN and top_score < HIGH_CONFIDENCE_THRESHOLD
                 or unsupported_gender_match)
    missing_brand = bool(
        candidates
        and candidates[0]["intent"] == "vehicle_brand_search"
        and not entities["brand"]
    )
    requires_clarification = not candidates or exact_ambiguous or low_confidence or ambiguous or missing_brand

    if requires_clarification:
        reason_code = (
            "missing_brand"
            if missing_brand
            else "ambiguous_alias"
            if exact_ambiguous
            else "low_confidence"
            if low_confidence
            else "ambiguous_intent"
        )
        clarification_topic = query_topic or (prior_topic if policy_followup else None)
        topic_spec = TOPICS.get(clarification_topic)
        return with_details({
            "intent": "REJECT",
            "intent_id": "REJECT",
            "confidence": round(top_score, 6),
            "score": round(top_score, 6),
            "language": style,
            "reply_lang": style,
            "reply": topic_spec["clarification"][style] if topic_spec else clarification_reply(candidates, style, normalized_query),
            "topic": clarification_topic,
            "candidate_intents": topic_spec["candidates"] if topic_spec else [],
            "alternatives": build_alternatives(candidates),
            "top_preds": [
                {"intent_id": candidate["intent"], "id": candidate["intent"], "score": round(float(candidate["score"]), 6)}
                for candidate in candidates
            ],
            "requires_clarification": True,
            "matched_alias": candidates[0].get("matched_alias", "") if candidates else "",
            "reason_code": reason_code,
            "requires_live_data": False,
            "live_source": "",
            "entities": entities,
        }, "ambiguous_intent" if ambiguous or exact_ambiguous else "unknown_intent")

    selected_intent = candidates[0]["intent"]
    selected_item = INTENTS_BY_ID[selected_intent]
    response_variant = (support_variant if support_intent == selected_intent else
                        support_response_variant(selected_intent, normalized_query, conversation))
    if contextual_intent == selected_intent:
        variants = selected_item["response_variants"]
        if followup_action == "offer":
            response_variant = "instructions" if offer_action == "instructions" else None
        elif followup_action == "reference":
            response_variant = conversation.get("response_variant")
            answer_type = conversation.get("assistant_action") or conversation.get("requested_answer_type")
        elif followup_action == "navigation":
            response_variant, answer_type = "navigation", "navigation"
        elif followup_action == "repair":
            response_variant = answer_type
            if selected_intent == "messaging" and answer_type == "instructions" and conversation.get("response_variant") in {"instructions", "instructions_detail"}:
                response_variant = "instructions_detail"
        elif followup_action == "confirm":
            previous_variant = conversation.get("response_variant")
            response_variant = previous_variant if previous_variant and previous_variant not in {"overview", "instructions", "continuation"} else "confirm_policy"
        elif followup_action == "continue":
            response_variant = "instructions" if selected_intent == "verification_security" and conversation.get("assistant_action") not in {"instructions", "continuation"} else "continuation"
        else:
            response_variant = "explanation" if re.fullmatch(r"(?:why|bakit|how so)", informal_query) and "explanation" in variants else "instructions" if "instructions" in variants else "explanation"
            answer_type = "explanation" if response_variant == "explanation" else "instructions"
        if search_result_explanation:
            response_variant, answer_type = None, "explanation"
        elif followup_action == "explain" and informal_query in {"explain that", "explain it"}:
            response_variant, answer_type = "explanation", "explanation"
        if answer_type is None:
            answer_type = "confirmation" if followup_action == "confirm" else "continuation" if followup_action == "continue" else "explanation" if informal_query in {"why", "bakit"} else "instructions"
    elif not response_variant and answer_type in {"navigation", "troubleshooting", "explanation", "overview"}:
        response_variant = answer_type
    if selected_intent == "payment_methods" and contextual_intent and answer_type == "instructions" and conversation.get("response_variant") in {"gcash", "maya", "card"}:
        response_variant = conversation["response_variant"]
    if selected_intent == "payment_downpayment" and contextual_intent and answer_type == "instructions" and conversation.get("response_variant") in {"full_payment", "full_payment_instructions"}:
        response_variant = "full_payment_instructions"
    if response_variant not in selected_item["response_variants"]:
        response_variant = None
    if answer_type is None:
        answer_type = response_variant if response_variant in REQUESTED_ANSWER_TYPES else {
            "instructions_detail": "instructions", "no_reply": "troubleshooting",
            "gcash": "instructions", "maya": "instructions", "card": "instructions",
            "full_payment_instructions": "instructions", "approval_timing": "explanation",
        }.get(response_variant)
    if (selected_intent == "vehicle_availability_status" and not entities.get("brand")
            and not conditions.get("vehicle_status_overview")):
        return with_details({
            "intent": selected_intent, "intent_id": selected_intent,
            "confidence": round(top_score, 6), "score": round(top_score, 6),
            "reply": selected_item["clarification"][style],
            "alternatives": build_alternatives(candidates, exclude_intent=selected_intent),
            "top_preds": [], "requires_clarification": True,
            "matched_alias": "", "reason_code": "missing_vehicle",
            "requires_live_data": False, "live_source": selected_item["live_source"],
        }, "missing_entity", "model")
    missing_rate_unit = selected_intent == "available_vehicles" and response_variant not in {"instructions", "navigation", "explanation", "troubleshooting", "continuation"} and "max_budget" in entities and "rate_unit" not in entities
    missing_booking = selected_intent == "booking_pickup_time"
    if missing_rate_unit:
        currency_amount = f"PHP {entities['max_budget']:,.0f}"
        reply = {
            "en": f"Is your {currency_amount} budget per day or per hour?",
            "fil": f"Ang {currency_amount} budget mo ba ay bawat araw o bawat oras?",
            "taglish": f"Yung {currency_amount} budget mo ba ay per day or per hour?",
        }[style]
    elif missing_booking:
        reply = {
            "en": "Pickup time is set for each booking. Which booking or vehicle are you asking about? Check your booking details for the scheduled time.",
            "fil": "Nakatakda ang oras ng pagkuha sa bawat booking. Aling booking o sasakyan ang tinutukoy mo? Tingnan ang detalye ng booking para sa oras nito.",
            "taglish": "Pickup time depends on your booking. Aling booking or vehicle ang tinutukoy mo? Check your booking details for the scheduled time.",
        }[style]
    else:
        reply = (selected_item["response_variants"][response_variant][style][0] if response_variant else
                 select_response(selected_intent, style, normalized_query))
    return with_details({
        "intent": selected_intent,
        "intent_id": selected_intent,
        "confidence": round(top_score, 6),
        "score": round(top_score, 6),
        "language": style,
        "reply_lang": style,
        "reply": reply,
        **({"response_variant": response_variant} if response_variant and not (missing_rate_unit or missing_booking) else {}),
        "alternatives": build_alternatives(candidates, exclude_intent=selected_intent),
        "top_preds": [
            {"intent_id": candidate["intent"], "id": candidate["intent"], "score": round(float(candidate["score"]), 6)}
            for candidate in candidates
        ],
        "requires_clarification": missing_rate_unit or missing_booking,
        "matched_alias": candidates[0].get("matched_alias", "") or (clean_message if exact_reason == "exact_alias" else ""),
        "reason_code": "missing_rate_unit" if missing_rate_unit else "missing_booking" if missing_booking else "assistant_offer_fulfilled" if offer_action else "conversation_repair" if repair else decision_reason or exact_reason or candidates[0].get("matched_source", "semantic_match"),
        "requires_live_data": selected_item["requires_live_data"] and not (missing_rate_unit or missing_booking),
        "live_source": selected_item["live_source"],
        "entities": entities,
    }, "missing_entity" if missing_rate_unit or missing_booking else None,
        "rate_unit" if missing_rate_unit else "booking" if missing_booking else None)


def _classify_message(message: str, requested_language: Optional[str] = "auto", previous_language: Optional[str] = None,
                     previous_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    parts = split_questions(clean_text(message))
    linked_parts = []
    for part in parts:
        query = normalize_informal_text(part)
        if linked_parts and vehicle_subject_fragment(normalize_informal_text(linked_parts[-1])):
            prior = extract_query_entities(normalize_informal_text(linked_parts[-1]), linked_parts[-1])
            current = extract_query_entities(query, part)
            existence = re.fullmatch(r"(?:do you have(?: any| them| those)?|(?:meron|mayroon)(?: ba)? kayo)", query)
            same_subject = (current.get("category") == prior.get("category")
                and re.match(r"(?:do you have|may|meron|mayroon)\b", query)
                and practical_intent(query) in {None, "available_vehicles", "available_transmission"}
                and not any(current.get(key) is not None and prior.get(key) is not None and current[key] != prior[key]
                            for key in current))
            if existence or same_subject:
                linked_parts[-1] += " " + part
                continue
        linked_parts.append(part)
    parts = linked_parts
    if not parts:
        return _classify_single(message, requested_language, previous_language, previous_context)
    if len(parts) > 3:
        result = _classify_single("help", requested_language, previous_language)
        result.update({"intent": "REJECT", "intent_id": "REJECT", "reason_code": "too_many_questions",
                       "reply": {"en": "Please ask up to three questions at a time so I can answer each clearly.", "fil": "Magtanong ng hanggang tatlong tanong bawat mensahe para masagot ko ang bawat isa.", "taglish": "Please ask up to three questions at a time para malinaw ang bawat sagot."}[result["language"]]})
        return result
    style = resolve_style(requested_language, clean_text(message), previous_language)
    results = []
    clause_context = previous_context
    for index, part in enumerate(parts):
        if index:
            previous = results[-1]
            current = extract_query_entities(normalize_informal_text(part), part)
            related_vehicle = previous.get("topic") == "vehicles" and (
                current.get("quote_requested") or RATE_QUERY_PATTERN.search(normalize_for_match(part)))
            same_vehicle = not any(current.get(key) and current[key] != previous.get("entities", {}).get(key)
                                   for key in ("brand", "model", "category", "location"))
            clause_context = {key: previous[key] for key in ("intent", "entities", "topic", "conditions", "clarification", "candidate_intents", "response_variant", "requested_answer_type") if key in previous} if related_vehicle and same_vehicle else None
        results.append(_classify_single(part, style, style, clause_context))
    distinct = []
    for part, result in zip(parts, results):
        if len(parts) > 1:
            result["question"] = part
        if not any(all(item.get(key) == result.get(key) for key in ("intent", "entities", "conditions", "response_variant", "clarification")) for item in distinct):
            distinct.append(result)
        query = normalize_informal_text(part)
        related = None
        if result["intent"] == "payment_downpayment" and re.search(r"\b(?:gcash|maya|card)\b", query):
            related = ("payment_methods", "What payment methods are supported?")
        elif result["intent"] == "booking_cancellation" and re.search(r"\b(?:refund|money.*back|get back)\b", query):
            related = ("rental_refund_guidance", "What happens to a rental refund?")
        if related and not any(item["intent"] == related[0] for item in distinct):
            extra = _classify_single(related[1], style, style)
            extra["question"] = part
            distinct.append(extra)
    if len(distinct) > 3:
        return classify_message("help;help;help;help", requested_language, previous_language)
    primary = distinct[0]
    if len(distinct) > 1:
        primary["additional_answers"] = distinct[1:]
    return primary


if not DATASET_PATH.is_file():
    raise RuntimeError(f"Required chatbot dataset v6 is missing: {DATASET_PATH}")

intent_items = load_dataset(DATASET_PATH)
INTENTS_BY_ID: Dict[str, Dict[str, Any]] = {item["id"]: item for item in intent_items}
DATASET_SHA256 = hashlib.sha256(DATASET_PATH.read_bytes()).hexdigest()
topic_intents = [intent for spec in TOPICS.values() for intent in spec["intents"]]
if set(topic_intents) != set(INTENTS_BY_ID) or len(topic_intents) != len(set(topic_intents)):
    raise RuntimeError("Every chatbot intent must belong to exactly one configured topic")
UNIQUE_TYPO_VOCABULARY = build_unique_typo_vocabulary(intent_items)
embedder = SentenceTransformer(MODEL_NAME)
(
    POSITIVE_ROWS,
    POSITIVE_EMBEDDINGS,
    NEGATIVE_ROWS,
    NEGATIVE_EMBEDDINGS,
    EXACT_EXAMPLES,
    EXACT_ALIASES,
) = build_indexes(intent_items)
CONTEXTUAL_ROWS = [(action, example) for action, examples in CONTEXTUAL_EXAMPLES.items() for example in examples]
CONTEXTUAL_EMBEDDINGS = embedder.encode([example for _, example in CONTEXTUAL_ROWS], normalize_embeddings=True)

app = FastAPI(title="RentifyPro Chatbot Service (Deterministic Multilingual)")
app.add_middleware(InternalServiceAuthMiddleware)


@app.get("/")
def root() -> Dict[str, Any]:
    return {
        "status": "ok",
        "service": "RentifyPro Chatbot Service",
        "model": MODEL_NAME,
        "dataset": DATASET_PATH.name,
        "dataset_sha256": DATASET_SHA256,
        "config_sha256": CONFIG_SHA256,
        "routing_revision": "search-relevance-limits-2026-10-12",
        "intent_count": len(INTENTS_BY_ID),
        "example_count": len(POSITIVE_ROWS),
        "confidence_threshold": CONFIDENCE_THRESHOLD,
        "high_confidence_threshold": HIGH_CONFIDENCE_THRESHOLD,
        "clarification_margin": CLARIFICATION_MARGIN,
    }



def classify_message(message, requested_language="auto", previous_language=None, previous_context=None,
                     inventory_vocabulary=None):
    token = INVENTORY_VOCABULARY.set(validate_inventory_vocabulary(inventory_vocabulary)) if inventory_vocabulary is not None else None
    try:
        result = _classify_message(message, requested_language, previous_language, previous_context)
        query = normalize_informal_text(message)
        if (inventory_vocabulary is None and result["intent"] in CONVERSATIONAL_INTENTS
                and result.get("reason_code") == "example"
                and not exact_candidates(query)[0] and not social_question_intent(query)):
            result["inventory_vocabulary_requested"] = True
        return result
    finally:
        if token is not None:
            INVENTORY_VOCABULARY.reset(token)


@app.get("/health")
@app.head("/health", include_in_schema=False)
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/chat")
def chat(req: ChatRequest) -> Dict[str, Any]:
    return classify_message(req.message, req.language, req.previous_language, req.previous_context, req.inventory_vocabulary)
