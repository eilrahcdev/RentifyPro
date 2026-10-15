"""Public, bounded assistant actions; never account state or authorization."""

import re


OFFER_ACTIONS = {"instructions", "search"}
SEARCH_OFFER_INTENTS = {"available_vehicles"}
ASSISTANT_ACTIONS = {"overview", "instructions", "navigation", "explanation", "troubleshooting", "confirmation", "continuation", "search"}
REFERENCE = re.compile(r"\b(?:you (?:(?:just|already) )?(?:said|mentioned|offered|suggested)|you were referring|sabi mo|sinabi mo|sinabi mong|the steps you offered|what were you referring)\b")
CONTINUATION = re.compile(
    r"(?:what(?:'s| is)? (?:the )?(?:next(?: step)?|next steps)|what (?:should|do) i do (?:next|now)|"
    r"what (?:happens|comes) (?:next|after that)|then what|and then|"
    r"ano(?: ang)? (?:susunod(?: na step)?|next(?: step)?)|anong gagawin ko pagkatapos|(?:the )?next step)"
)

# A small purpose index uses the existing multilingual embedder for indirect
# references. Explicit task routes and privacy checks run before it can apply.
CONTEXTUAL_EXAMPLES = {
    "continue": ["What should I do after that?", "What would the following step be?", "Ano ang gagawin pagkatapos nito?"],
    "explain": ["Could you walk me through that?", "Explain what you just suggested.", "Paki-explain yung sinabi mo."],
    "navigation": ["Where should I click for that?", "Where exactly can I find it?", "Saan ko makikita iyon?"],
}


def validate_offers(intent, variants, offers):
    if (not isinstance(offers, dict) or len(offers) > 4
            or any(not isinstance(source, str) or source not in {"base", *variants}
                   or not isinstance(action, str) or action not in OFFER_ACTIONS
                   or (action == "instructions" and "instructions" not in variants)
                   or (action == "search" and intent not in SEARCH_OFFER_INTENTS)
                   for source, action in offers.items())):
        raise RuntimeError(f"Invalid assistant offers for {intent}")
    return offers


def valid_assistant_state(context, intents):
    action = context.get("assistant_action")
    if action is not None and (not isinstance(action, str) or action not in ASSISTANT_ACTIONS):
        return False
    offer = context.get("pending_offer")
    if offer is None:
        return True
    if not isinstance(offer, dict) or set(offer) != {"intent", "action", "source_variant"}:
        return False
    intent, purpose, source = offer["intent"], offer["action"], offer["source_variant"]
    return (all(isinstance(item, str) for item in (intent, purpose, source))
            and intent == context.get("intent") and purpose in OFFER_ACTIONS
            and source == (context.get("response_variant") or "base")
            and intents.get(intent, {}).get("assistant_offers", {}).get(source) == purpose)


def contextual_request(query):
    """Compose polite acceptance, continuation and assistant-reference clauses."""
    polite = re.sub(r"^(?:(?:okay|ok|yes|sure|oo|opo|sige|please)\s+)+", "", query)
    polite = re.sub(r"^(?:i asked (?:for )?|ang tanong ko )", "", polite)
    polite = re.sub(r"\s+(?:po|please)$", "", polite)
    if CONTINUATION.fullmatch(polite):
        return "continue"
    if re.fullmatch(
        r"(?:huh|what do you mean|paano (?:yung|ang) sinabi mo|(?:please )?explain how|"
        r"why (?:couldn'?t|could not|didn'?t|did not|can'?t|cannot) you find (?:any|one|a match|anything)|"
        r"bakit (?:wala kang (?:mahanap|nahanap)|walang (?:tugma|match))|"
        r"why walang (?:match|mahanap)|ano (?:ang ibig sabihin|ibig mong sabihin)|hindi ko gets|di ko gets|explain (?:that|it))", polite):
        return "explain"
    if re.fullmatch(r"(?:repeat (?:that|your (?:answer|reply))|say that again|pak(i)?ulit(?: ng sagot)?|ulit(?:in)? mo)", polite):
        return "reference"
    if REFERENCE.search(query):
        if re.search(r"\b(?:next|susunod|pagkatapos)\b", query):
            return "continue"
        if re.search(r"\b(?:steps|how|paano|explain)\b", query):
            return "explain"
        return "reference"
    return None


def offer_response(query):
    if re.fullmatch(r"(?:no(?: thanks| thank you)?|not now|maybe later|no need|hindi muna|ayoko|wag muna)", query):
        return "decline"
    query = re.sub(r"\s+(?:po|please)$", "", query)
    if re.fullmatch(r"(?:yes|sure|oo|opo|sige)(?: (?:please|show me|go ahead))?|okay how|yes please explain how", query):
        return "accept"
    return None


def has_indirect_reference(query):
    return bool(REFERENCE.search(query) or re.search(r"\b(?:that|it|iyon|yun|yan|next|afterward|afterwards)\b", query))
