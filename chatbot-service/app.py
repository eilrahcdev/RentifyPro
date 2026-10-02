import json
import hashlib
import os
import re
import unicodedata
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

# Keep routine startup and evaluation logs readable without changing model behavior.
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
os.environ.setdefault("TRANSFORMERS_NO_ADVISORY_WARNINGS", "1")

from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
from chatbot_routing import (outside_scope, other_person_private_query, practical_intent,
                            split_questions, topic_for_query, topic_for_intent, availability_request,
                            clarification_selection)


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
    "van": "van", "vans": "van", "truck": "pickup", "trucks": "pickup",
    "pickup": "pickup", "motorcycle": "motorcycle", "motorcycles": "motorcycle",
    "motorbike": "motorcycle", "motorbikes": "motorcycle", "car": "sedan",
    "cars": "sedan", "kotse": "sedan",
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
    "kumusta", "lang", "magsoli", "makapagbook", "may", "mayroon", "meron", "mga", "mo", "muna",
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
}
ENGLISH_TOKENS = {
    "account", "available", "balance", "book", "booking", "can", "cancel",
    "car", "cash", "day", "deposit", "do", "driver", "extend", "fee", "gcash",
    "automatic", "book", "date", "dates", "fuel", "help", "how", "insurance",
    "late", "level", "methods", "pax", "payment", "pending", "price", "rate", "rent",
    "rental", "requirements", "return", "same", "status", "vehicle", "what", "when",
    "where", "which", "why",
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


def clean_text(value: Any) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).translate(APOSTROPHE_TRANSLATION)
    text = re.sub(r"\s+", " ", text, flags=re.UNICODE).strip()
    return text[:MAX_MESSAGE_LENGTH]


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


def find_brand_token_span(message: str) -> Tuple[Optional[str], int, int, List[str]]:
    original_tokens = TOKEN_PATTERN.findall(clean_text(message))
    normalized_tokens = [normalize_for_match(token) for token in original_tokens]
    for normalized_brand, canonical_brand in sorted(
        VEHICLE_BRAND_BY_NORMALIZED.items(), key=lambda item: len(item[0]), reverse=True
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
    for normalized_brand, canonical in VEHICLE_BRAND_BY_NORMALIZED.items():
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
    for token in tokenize(normalized):
        category = VEHICLE_CATEGORIES.get(token)
        if category:
            entities["category"] = category
            break
    day_unit = bool(DAY_UNIT_PATTERN.search(normalized))
    hour_unit = bool(HOUR_UNIT_PATTERN.search(normalized))
    if day_unit != hour_unit:
        entities["rate_unit"] = "day" if day_unit else "hour"
    budget_match = BUDGET_PATTERN.search(clean_text(original_message or message))
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
    pax = re.search(r"\b(\d{1,2})\s*(?:pax|passengers?|persons?|people|katao|tao|seats?|seater)\b|\bfor\s+(\d{1,2})\b", normalized)
    if pax:
        entities["pax"] = int(pax.group(1) or pax.group(2))
    location = re.search(r"\b(?:in|near|around|sa)\s+([a-z][a-z '-]{1,70})", normalized)
    if location:
        words = []
        stops = {"tomorrow", "today", "bukas", "ngayon", "under", "below", "per", "for", "with", "and", "automatic", "manual", "on", "from", "until", "to", "available", "please", "po", "php", "p", "budget", "bawat", "kada"}
        for word in location.group(1).split():
            if word in stops or len(words) >= 4:
                break
            words.append(word)
        place = " ".join(words)
        if place and place not in {"english", "filipino", "tagalog", "taglish", "progress", "my account", "the booking", "booking ko", "oras ng pagsoli"}:
            entities["location"] = place
    schedule_tokens = re.findall(
        r"\b(?:day after tomorrow|tomorrow|today|tonight|bukas|ngayon|weekend|next week|"
        r"(?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|"
        r"\d{4}-\d{2}-\d{2}|\d{1,2}[/]\d{1,2}(?:[/]\d{2,4})?)\b",
        clean_text(original_message or message).lower(),
    )
    if schedule_tokens:
        entities["requested_schedule"] = " to ".join(dict.fromkeys(schedule_tokens))[:100]
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
    if brand not in VEHICLE_BRAND_BY_NORMALIZED.values() and brand is not None:
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
    if not isinstance(value, dict) or set(value) - {"intent", "entities", "clarification", "choices", "suggested_brand", "topic", "conditions", "candidate_intents"}:
        return {}
    if not isinstance(value.get("intent"), str) or (value["intent"] not in INTENTS_BY_ID and value["intent"] != "REJECT"):
        return {}
    entities = value.get("entities", {})
    allowed = {"brand", "model", "category", "max_budget", "currency", "rate_unit", "transmission", "location", "pax", "excluded_brands", "excluded_transmissions", "requested_schedule"}
    if not isinstance(entities, dict) or set(entities) - allowed:
        return {}
    if entities.get("brand") is not None and entities["brand"] not in VEHICLE_BRAND_BY_NORMALIZED.values():
        return {}
    if entities.get("category") is not None and entities["category"] not in VEHICLE_CATEGORIES.values():
        return {}
    for key, options in (("rate_unit", {"day", "hour"}), ("transmission", {"automatic", "manual"}), ("currency", {"PHP"})):
        if entities.get(key) is not None and (not isinstance(entities[key], str) or entities[key] not in options):
            return {}
    for key, limit in (("model", 80), ("location", 80), ("requested_schedule", 100)):
        if entities.get(key) is not None and (not isinstance(entities[key], str) or len(entities[key]) > limit):
            return {}
    for key, maximum in (("max_budget", 10_000_000), ("pax", 99)):
        if key in entities and (isinstance(entities[key], bool) or not isinstance(entities[key], (int, float)) or not 0 < entities[key] <= maximum):
            return {}
    if entities.get("max_budget") and entities.get("currency") != "PHP":
        return {}
    excluded = entities.get("excluded_brands", [])
    if not isinstance(excluded, list) or len(excluded) > 12 or any(brand not in VEHICLE_BRAND_BY_NORMALIZED.values() for brand in excluded):
        return {}
    excluded_transmissions = entities.get("excluded_transmissions", [])
    if not isinstance(excluded_transmissions, list) or len(excluded_transmissions) > 2 or any(not isinstance(item, str) or item not in {"automatic", "manual"} for item in excluded_transmissions):
        return {}
    choices = value.get("choices", [])
    if not isinstance(choices, list) or len(choices) > 3:
        return {}
    for choice in choices:
        if not isinstance(choice, dict) or set(choice) - {"brand", "model"}:
            return {}
        if choice.get("brand") not in VEHICLE_BRAND_BY_NORMALIZED.values() or not isinstance(choice.get("model"), str) or len(choice["model"]) > 80:
            return {}
    clarification = value.get("clarification", {})
    if not isinstance(clarification, dict) or set(clarification) - {"required", "type", "field"}:
        return {}
    if value.get("suggested_brand") is not None and value["suggested_brand"] not in VEHICLE_BRAND_BY_NORMALIZED.values():
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
        or clarification.get("field") not in (None, "rate_unit", "booking", "brand", "model")):
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
    brand_tokens = set(VEHICLE_BRAND_BY_NORMALIZED)
    for token in normalized_text.split():
        if (
            len(token) < UNIQUE_TYPO_MIN_LENGTH
            or not token.isalpha()
            or token in UNIQUE_TYPO_VOCABULARY
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
        for candidate, canonical in VEHICLE_BRAND_BY_NORMALIZED.items()
        if len(candidate) >= 5 and one_edit_apart(token, candidate)
    }
    return next(iter(suggestions)) if len(suggestions) == 1 else None


def brand_typo_reply(brand: str, style: str) -> str:
    if style == "fil":
        return f"Ang ibig mo bang sabihin ay {brand}? Kung oo, hahanapin ko ang kasalukuyang RentifyPro listings."
    if style == "taglish":
        return f"Did you mean {brand}? If yes, hahanapin ko ang current RentifyPro listings."
    return f"Did you mean {brand}? If so, I can search the current RentifyPro listings."


def dedupe_keep_order(values: Any) -> List[str]:
    source = values if isinstance(values, list) else []
    seen: Set[str] = set()
    result: List[str] = []
    for value in source:
        text = clean_text(value)
        key = normalize_for_match(text)
        if not text or not key or key in seen:
            continue
        seen.add(key)
        result.append(text)
    return result


def normalize_responses(value: Any) -> Dict[str, List[str]]:
    responses = value if isinstance(value, dict) else {}
    return {
        "en": dedupe_keep_order(responses.get("en")),
        "fil": dedupe_keep_order(responses.get("fil")),
        "taglish": dedupe_keep_order(responses.get("taglish")),
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
    normalized = normalize_for_match(text)
    tokens = tokenize(normalized)
    fil_hits = [token for token in tokens if token in FILIPINO_TOKENS and token not in ENGLISH_TOKENS]
    en_hits = [token for token in tokens if token in ENGLISH_TOKENS and token not in FILIPINO_TOKENS]
    filipino_grammar = bool(FILIPINO_GRAMMAR_PATTERN.search(normalized))
    if not filipino_grammar:
        if en_hits and not any(token not in {"at", "may"} for token in fil_hits):
            fil_hits = [token for token in fil_hits if token != "at"]
        if re.match(r"^may\s+(?:i|we|you|two|a|an|the)\b", normalized):
            fil_hits = [token for token in fil_hits if token != "may"]
    english_domain = bool(ENGLISH_DOMAIN_PATTERN.search(normalized))
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
    if previous and len(tokens) <= 2 and (normalized in AMBIGUOUS_SHORT_FOLLOWUPS or not has_language_signal):
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
            if not phrase_in_query(normalized_alias, normalized_query):
                continue
            candidate = {
                "intent": item["id"],
                "alias": alias,
                "priority": item["priority"],
                "specificity": len(tokenize(normalized_alias)) * 100 + len(normalized_alias),
            }
            current = matches.get(item["id"])
            if current is None or (candidate["priority"], candidate["specificity"]) > (
                current["priority"], current["specificity"]
            ):
                matches[item["id"]] = candidate
    return sorted(
        matches.values(),
        key=lambda candidate: (candidate["priority"], candidate["specificity"], candidate["intent"]),
        reverse=True,
    )


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
            priority_gap = top_priority - alias_match["priority"]
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
    conversation = validated_conversation_context(previous_context)
    query_topic = topic_for_query(normalized_query, TOPICS)
    prior_topic = conversation.get("topic") or topic_for_intent(conversation.get("intent"), TOPICS)
    topic_changed = bool(query_topic and prior_topic and query_topic != prior_topic)
    clarified_intent = clarification_selection(normalized_query, conversation.get("candidate_intents", [])) if conversation.get("clarification", {}).get("required") else None
    unresolved_choice = False
    vehicle_context_intents = {"available_vehicles", "vehicle_brand_search", "available_transmission", "passenger_capacity", "rental_rate", "vehicle_availability_status", "vehicle_unavailability"}
    reference_followup = bool(conversation and not topic_changed and conversation["intent"] in vehicle_context_intents and (re.search(
        r"^(?:what about|how about|and|same|that one|the first|first one|second one|third one|it|cheaper|per day|per hour|daily|hourly|tomorrow|bukas|mas mura|yung una|yung pangalawa|how much.*(?:it|that|first|second|third)|magkano.*(?:iyan|ito|una))\b", normalized_query
    ) or (conversation.get("clarification", {}).get("required") and normalized_query in {"yes", "oo", "opo"})
      or (prior_topic == "vehicles" and re.fullmatch(r"(?:the )?(?:unavailable|not available|unavailable vehicles|unavailable listings|which ones|show them|list them|how many|why|bakit|how|paano|tell me more|more details|explain|explain please|hindi ko gets|di ko gets)", normalized_query))))
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
        entities = {**prior_entities, **{key: item for key, item in entities.items() if item is not None}}
        if entities.get("brand") != prior_entities.get("brand"):
            entities["model"] = extract_vehicle_entities(normalized_query).get("model")
        choice_index = next((index for index, pattern in enumerate((r"\b(?:first|una)\b", r"\b(?:second|pangalawa)\b", r"\b(?:third|pangatlo)\b")) if re.search(pattern, normalized_query)), None)
        if choice_index is not None and choice_index < len(conversation.get("choices", [])):
            entities.update(conversation["choices"][choice_index])
            entities.pop("category", None)
        elif choice_index is not None:
            unresolved_choice = True
        if re.search(r"\b(?:cheaper|mas mura)\b", normalized_query):
            entities.pop("brand", None)
            entities.pop("model", None)
            entities.update({"brand": None, "model": None})
    pending = validated_pending_search(previous_context)
    context_followup = reference_followup or bool(pending and entities.get("rate_unit")
                            and len(tokenize(normalized_query)) <= 3
                            and not entities.get("brand") and not entities.get("category")
                            and "max_budget" not in entities)
    if pending and context_followup:
        entities = {"brand": None, "model": None, **pending, "rate_unit": entities["rate_unit"]}
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

    if normalized_query in {"account", "my account", "verification", "owner", "support", "payment", "payments"} and not clarified_intent:
        topic = {"my account": "account", "payments": "payment"}.get(normalized_query, normalized_query)
        spec = TOPICS[topic]
        return with_details({"intent": "REJECT", "intent_id": "REJECT", "confidence": 0.99, "score": 0.99,
            "reply": spec["clarification"][style], "topic": topic, "candidate_intents": spec["candidates"],
            "alternatives": build_alternatives(rank_exact_candidates(spec["candidates"])), "top_preds": [], "requires_clarification": True,
            "requires_live_data": False, "live_source": "", "reason_code": "topic_clarification"}, "ambiguous_intent")

    unavailable_intent, status_conditions = availability_request(
        normalized_query, entities, reference_followup and prior_topic == "vehicles"
    )
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
    practical = practical_intent(informal_query) or practical_intent(normalized_query)
    if reference_followup and not practical and explicit_followup_intent in BRAND_CONTEXT_POLICY_INTENTS:
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
    elif pickup_time:
        candidates = prioritize_intent(candidates, "booking_pickup_time", "pickup_time_context")
        decision_reason = "pickup_time_context"
    elif vehicle_budget_search or context_followup:
        target = "rental_rate" if reference_followup and RATE_QUERY_PATTERN.search(normalized_query) else "available_vehicles"
        candidates = prioritize_intent(candidates, target, "vehicle_budget_context")
        decision_reason = "vehicle_budget_context"
    elif entities["brand"]:
        current_intent = candidates[0]["intent"] if candidates else ""
        if RATE_QUERY_PATTERN.search(normalized_query):
            target_intent = "rental_rate"
            decision_reason = "brand_rate_context"
        elif current_intent in BRAND_CONTEXT_POLICY_INTENTS:
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
    ambiguous = len(candidates) > 1 and margin < CLARIFICATION_MARGIN and top_score < HIGH_CONFIDENCE_THRESHOLD
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
    missing_rate_unit = selected_intent == "available_vehicles" and "max_budget" in entities and "rate_unit" not in entities
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
        reply = select_response(selected_intent, style, normalized_query)
    return with_details({
        "intent": selected_intent,
        "intent_id": selected_intent,
        "confidence": round(top_score, 6),
        "score": round(top_score, 6),
        "language": style,
        "reply_lang": style,
        "reply": reply,
        "alternatives": build_alternatives(candidates, exclude_intent=selected_intent),
        "top_preds": [
            {"intent_id": candidate["intent"], "id": candidate["intent"], "score": round(float(candidate["score"]), 6)}
            for candidate in candidates
        ],
        "requires_clarification": missing_rate_unit or missing_booking,
        "matched_alias": candidates[0].get("matched_alias", "") or (clean_message if exact_reason == "exact_alias" else ""),
        "reason_code": "missing_rate_unit" if missing_rate_unit else "missing_booking" if missing_booking else decision_reason or exact_reason or candidates[0].get("matched_source", "semantic_match"),
        "requires_live_data": selected_item["requires_live_data"] and not (missing_rate_unit or missing_booking),
        "live_source": selected_item["live_source"],
        "entities": entities,
    }, "missing_entity" if missing_rate_unit or missing_booking else None,
        "rate_unit" if missing_rate_unit else "booking" if missing_booking else None)


def classify_message(message: str, requested_language: Optional[str] = "auto", previous_language: Optional[str] = None,
                     previous_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    parts = split_questions(clean_text(message))
    if not parts:
        return _classify_single(message, requested_language, previous_language, previous_context)
    if len(parts) > 3:
        result = _classify_single("help", requested_language, previous_language)
        result.update({"intent": "REJECT", "intent_id": "REJECT", "reason_code": "too_many_questions",
                       "reply": {"en": "Please ask up to three questions at a time so I can answer each clearly.", "fil": "Magtanong ng hanggang tatlong tanong bawat mensahe para masagot ko ang bawat isa.", "taglish": "Please ask up to three questions at a time para malinaw ang bawat sagot."}[result["language"]]})
        return result
    style = resolve_style(requested_language, clean_text(message), previous_language)
    results = [_classify_single(part, style, style, previous_context) for part in parts]
    distinct = []
    for part, result in zip(parts, results):
        if len(parts) > 1:
            result["question"] = part
        if not any(item["intent"] == result["intent"] and item["entities"] == result["entities"] for item in distinct):
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

app = FastAPI(title="RentifyPro Chatbot Service (Deterministic Multilingual)")


@app.get("/")
def root() -> Dict[str, Any]:
    return {
        "status": "ok",
        "service": "RentifyPro Chatbot Service",
        "model": MODEL_NAME,
        "dataset": DATASET_PATH.name,
        "dataset_sha256": DATASET_SHA256,
        "routing_revision": "topic-followups-2026-10-02",
        "intent_count": len(INTENTS_BY_ID),
        "example_count": len(POSITIVE_ROWS),
        "confidence_threshold": CONFIDENCE_THRESHOLD,
        "high_confidence_threshold": HIGH_CONFIDENCE_THRESHOLD,
        "clarification_margin": CLARIFICATION_MARGIN,
    }


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/chat")
def chat(req: ChatRequest) -> Dict[str, Any]:
    return classify_message(req.message, req.language, req.previous_language, req.previous_context)
