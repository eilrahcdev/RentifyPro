import json
import random
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity


# Config
BASE_DIR = Path(__file__).parent
DATASET_PATH = BASE_DIR / "rentifypro_chatbot_dataset_v4.json"

MODEL_NAME = "paraphrase-multilingual-MiniLM-L12-v2"
THRESHOLD = 0.45
TOP_K = 3

# Intent IDs that can return recommendations
RECO_INTENT_IDS = {
    "available_vehicles",
    "available_transmission",
    "passenger_capacity",
}

# Load the dataset once
# items: [{ id, english:{question,answers}, filipino:{question,answers} }, ...]
dataset = json.loads(DATASET_PATH.read_text(encoding="utf-8"))
items = dataset["items"]

# Build one index for English and Filipino questions
index: List[Dict[str, str]] = []  # {id, lang, question}
answer_bank: Dict[Tuple[str, str], List[str]] = {}  # (id, lang) -> answers

for it in items:
    iid = it["id"]

    en_q = it["english"]["question"]
    en_a = it["english"]["answers"]
    index.append({"id": iid, "lang": "en", "question": en_q})
    answer_bank[(iid, "en")] = en_a

    fil_q = it["filipino"]["question"]
    fil_a = it["filipino"]["answers"]
    index.append({"id": iid, "lang": "fil", "question": fil_q})
    answer_bank[(iid, "fil")] = fil_a

questions = [x["question"] for x in index]

# Load the model once
embedder = SentenceTransformer(MODEL_NAME)
q_emb = embedder.encode(questions, normalize_embeddings=True)

app = FastAPI(title="RentifyPro Chatbot Service (V4)")


# Request and response models
class ChatRequest(BaseModel):
    message: str
    # Optional vehicle list from Node
    vehicles: Optional[List[Dict[str, Any]]] = None


# Basic language check
def detect_language(text: str) -> str:
    t = text.lower()
    filipino_markers = [
        "magkano", "ano", "anong", "paano", "kailangan", "pwede", "ilang",
        "pasahero", "sasakyan", "renta", "edad", "bayad", "tinatanggap",
        "deposito", "beripikasyon", "diskwento"
    ]
    return "fil" if any(w in t for w in filipino_markers) else "en"


# Retrieval with cosine similarity
def retrieve_intents(user_text: str, top_k: int = 3) -> List[Dict[str, Any]]:
    user_emb = embedder.encode([user_text], normalize_embeddings=True)
    sims = cosine_similarity(user_emb, q_emb)[0]
    idxs = np.argsort(-sims)[:top_k]

    results = []
    for i in idxs:
        results.append({
            "id": index[i]["id"],
            "lang": index[i]["lang"],
            "question": index[i]["question"],
            "score": float(sims[i]),
        })
    return results


def chatbot_reply(user_text: str, threshold: float = THRESHOLD) -> Dict[str, Any]:
    user_lang = detect_language(user_text)
    preds = retrieve_intents(user_text, top_k=TOP_K)
    best = preds[0]

    if best["score"] < threshold:
        fallback = {
            "en": "Sorry, I’m not sure I understood. Can you rephrase? (booking, rates, requirements, deposit, payment, insurance)",
            "fil": "Paumanhin, hindi ko sigurado ang sagot. Maaari mo bang ulitin o ayusin ang tanong? (booking, presyo, requirements, deposito, bayad, insurance)",
        }
        return {
            "intent_id": "REJECT",
            "reply_lang": user_lang,
            "score": best["score"],
            "reply": fallback[user_lang],
            "top_preds": preds,
        }

    # Reply in the same language as the user
    answers = answer_bank[(best["id"], user_lang)]
    reply = random.choice(answers)

    return {
        "intent_id": best["id"],
        "reply_lang": user_lang,
        "score": best["score"],
        "reply": reply,
        "top_preds": preds,
    }


# Optional vehicle recommendation rules
# Expected fields:
# name, type, transmission, seats, dailyRate, isAvailable
def extract_slots(text: str) -> Dict[str, Any]:
    t = text.lower()

    pax = None
    m = re.search(r"\b(\d{1,2})\s*(pax|passengers|katao|tao|persons)?\b", t)
    if m:
        pax = int(m.group(1))

    transmission = None
    if "automatic" in t or "auto" in t:
        transmission = "automatic"
    elif "manual" in t:
        transmission = "manual"

    vtype = None
    for k in ["sedan", "suv", "van", "pickup", "truck"]:
        if k in t:
            vtype = "pickup" if k in ["pickup", "truck"] else k

    budget = None
    m = re.search(r"(?:₱|php|budget)\s*([0-9]{3,6})", t)
    if m:
        budget = int(m.group(1))

    return {"pax": pax, "transmission": transmission, "type": vtype, "budget": budget}


def score_vehicle(v: Dict[str, Any], slots: Dict[str, Any]) -> float:
    score = 0.0

    if slots["type"] and str(v.get("type", "")).lower() == slots["type"]:
        score += 3
    if slots["transmission"] and str(v.get("transmission", "")).lower() == slots["transmission"]:
        score += 2

    seats = int(v.get("seats", 0) or 0)
    if slots["pax"] is not None:
        if seats >= slots["pax"]:
            score += 3
        score -= abs(seats - slots["pax"]) * 0.05

    rate = float(v.get("dailyRate", 10**9) or 10**9)
    if slots["budget"] is not None and rate <= slots["budget"]:
        score += 2

    return score


def recommend_vehicles(vehicles: List[Dict[str, Any]], slots: Dict[str, Any], top_n: int = 3):
    filtered = [v for v in vehicles if v.get("isAvailable", True)]

    if slots["type"]:
        filtered = [v for v in filtered if str(v.get("type", "")).lower() == slots["type"]]
    if slots["transmission"]:
        filtered = [v for v in filtered if str(v.get("transmission", "")).lower() == slots["transmission"]]
    if slots["pax"] is not None:
        filtered = [v for v in filtered if int(v.get("seats", 0) or 0) >= slots["pax"]]
    if slots["budget"] is not None:
        filtered = [v for v in filtered if float(v.get("dailyRate", 10**9) or 10**9) <= slots["budget"]]

    ranked = sorted(filtered, key=lambda x: score_vehicle(x, slots), reverse=True)
    return ranked[:top_n]


# API
@app.post("/chat")
def chat(req: ChatRequest):
    base = chatbot_reply(req.message)

    # Add recommendations when needed
    if base["intent_id"] in RECO_INTENT_IDS and req.vehicles:
        slots = extract_slots(req.message)
        reco = recommend_vehicles(req.vehicles, slots, top_n=3)

        if reco:
            if base["reply_lang"] == "fil":
                intro = "Narito ang ilang inirerekomendang sasakyan batay sa iyong request:"
            else:
                intro = "Here are some recommended vehicles based on your request:"

            lines = [intro]
            for v in reco:
                lines.append(
                    f"- {v.get('name','(Unnamed)')} | {v.get('type')} | {v.get('transmission')} | seats: {v.get('seats')} | ₱{v.get('dailyRate')}/day"
                )

            base["reply"] = "\n".join(lines)
            base["recommendations"] = reco
            base["slots"] = slots
        else:
            base["recommendations"] = []
            base["slots"] = slots
            base["reply"] = (
                "Wala akong mahanap na available na sasakyan na tugma sa request mo. Subukang baguhin ang passengers/budget/transmission."
                if base["reply_lang"] == "fil"
                else "I couldn’t find an available vehicle that matches your request. Try changing passengers/budget/transmission."
            )

    return base
