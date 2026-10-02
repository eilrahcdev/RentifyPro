"""Bounded RentifyPro scope and high-specificity routing before semantic retrieval."""

import re


OUTSIDE_SCOPE_PATTERNS = tuple(re.compile(pattern) for pattern in (
    r"\b(?:netflix|spotify|amazon|shopee|lazada|youtube|facebook|tiktok)\b",
    r"\b(?:electricity|electric|water|internet|utility|phone)\s+bills?\b",
    r"(?<!in )\bstocks?\b|\b(?:shares|stock market|cryptocurrency|bitcoin|forex|savings|interest rate)\b",
    r"\b(?:airplanes?|aeroplanes?|aircraft|library|libraries|travel insurance|flight insurance)\b",
    r"\b(?:generators?|lawnmowers?|chainsaws?)\b",
    r"\b(?:how to|teach me to|how do i|paano|pano)\s+(?:drive|magdrive|magmaneho)\b",
    r"\b(?:get|obtain|apply for|renew)\b.*\b(?:driver'?s? licen[cs]e|passport)\b",
    r"\b(?:write|generate|make)\s+(?:me\s+)?(?:a\s+)?(?:poem|essay|story|code|program)\b",
    r"\b(?:weather forecast|capital of|president of|solve this|medical diagnosis)\b",
    r"\b(?:student|tourist|work|travel)\s+visa\b|\bvisa\s+(?:extension|application|renewal)\b",
    r"\b(?:book|reserve|cancel)\b.{0,35}\b(?:hotels?|hostels?|resorts?|flights?|airline tickets?)\b",
))


def outside_scope(query):
    return any(pattern.search(query) for pattern in OUTSIDE_SCOPE_PATTERNS)


def other_person_private_query(query):
    return bool(re.search(
        r"\b(?:another|other|someone else's|someone elses|my friend's|my friends|his|her|their|ibang)\b"
        r".*\b(?:renter|user|account|booking|balance|payment|utang|balanse|earnings|income)\b|"
        r"\b(?:renter|user)\s+(?:id\s+)?[a-f0-9]{24}\b.*\b(?:balance|booking|payment)\b|"
        r"\b(?!my\b|your\b)[a-z]+'s\s+(?:balance|bookings?|payments?|earnings)\b", query
    ))


PRACTICAL_ROUTES = (
    ("chat_greeting", r"^(?:hello|hi|hey|good day)(?: there)?(?: rentify(?: ai)?)?$"),
    ("chat_identity", r"\bwho\b.*\b(?:am i (?:chatting|talking|speaking) (?:to|with)|is (?:replying|responding) to me)\b"),
    ("unclear_message", r"\b(?:confused|don'?t understand|did not understand|didn't understand)\b.*\b(?:answer|explanation|reply|that)\b"),
    ("nonsense_message", r"^[qzxjv]{6,20}$"),
    ("payment_checkout_expired", r"\b(?:checkout|payment|paymongo|link)\b.*\b(?:expired|expires|expiration)\b|\bexpired\b.*\b(?:checkout|payment|link)\b"),
    ("payment_troubleshooting", r"\b(?:paid|pay|payment|charged|deducted|debited|gcash|maya|card|bayad|nabawasan|binayaran)\b.*\b(?:twice|double|duplicate|unpaid|not paid|not updated|pending|processing|failed|unavailable|not available|disabled|offline|not working|dalawa|dalawang|hindi updated|ayaw gumana)\b|\b(?:charged|deducted|debited|nabawasan)\b.*\b(?:booking|account|rental|gcash|maya)\b"),
    ("account_password_reset", r"\b(?:forgot|forget|reset|forgotten|nakalimutan|limot)\b.*\b(?:password|login|sign in)\b|\bpassword\b.*\b(?:reset|forgot|nakalimutan)\b"),
    ("verification_troubleshooting", r"\b(?:verification|verify|identity|document|id|selfie|face|liveness)\b.*\b(?:rejected|declined|failed|fail|mismatch|not match|does not match|doesn't match|cannot|can't|ayaw|reject)\b|\b(?:rejected|failed|mismatch)\b.*\b(?:verification|selfie|document|id)\b"),
    ("rental_problem_support", r"\b(?:owner|pickup|pick up|vehicle|car|sasakyan|kotse)\b.*\b(?:no show|not show|didn't show|did not show|not arrive|missing|breakdown|broke down|broken down|won't start|nasira|sira|hindi dumating)\b|\b(?:breakdown|broke down|nasira)\b.*\b(?:rental|car|vehicle|sasakyan)\b"),
    ("owner_listing_guidance", r"\b(?:how|where|paano|pano)\b.*\b(?:list|listing|add|publish|edit|change|update|maglist|ilista)\b.*\b(?:vehicle|car|listing|price|rate|sasakyan)\b|\b(?:change|edit|update)\s+(?:my\s+)?(?:listing|vehicle)\s+(?:price|rate)\b|\bowner\b.*\b(?:put|offer)\b.*\b(?:car|vehicle)\b.*\b(?:rent|rental)\b"),
    ("booking_status", r"\b(?:has|have|did|is|was)\b.*\bmy\b.*\b(?:request|reservation|booking)\b.*\b(?:accepted|approved|declined|confirmed|rejected)\b"),
    ("owner_booking_guidance", r"\b(?:approve|decline|accept|reject|manage)\b.*\b(?:rental|booking|request)\b|\b(?:owner|may ari)\b.*\b(?:requests|approval|approvals)\b"),
    ("owner_earnings_guidance", r"\b(?:earnings|revenue|income|kita)\b.*\b(?:owner|my|ko|dashboard|see|view|check)\b|\b(?:owner|my|see|view|check|saan)\b.*\b(?:earnings|revenue|income|kita)\b"),
    ("pickup_location", r"\b(?:where|saan|location|address|place)\b.*\b(?:pickup|pick up|pick it up|collect|kunin|kukunin|pagkuha)\b|\b(?:pickup|pick up)\s+(?:location|address|place)\b"),
    ("security_deposit", r"\b(?:security|refundable)\s+deposit\b|\bdeposit\b.*\b(?:refund|return)\b"),
    ("booking_cancellation", r"\b(?:cancel|icancel|magcancel|kanselahin|cancellation)\b.*\b(?:booking|reservation|rental|renta)\b"),
    ("rental_refund_guidance", r"\b(?:refund|money back|get back|ibabalik.*bayad)\b"),
    ("my_unpaid_balance", r"\b(?:how much|magkano)\b.*\b(?:i have left|i still|i need|do i|my|ko|kong|ako|kulang)\b.*\b(?:pay|payment|bayad|bayaran|balance|balanse|rental|cleared)\b|\b(?:have i|am i)\b.*\b(?:cleared|fully paid|paid everything)\b|\b(?:may|meron)\b.*\bkulang\b.*\bbayad\b|\b(?:anything|something|amount|money)\b.*\bleft\b.*\b(?:me|i)\b.*\bpay\b|\b(?:my|i)\b.*\b(?:still owe|balance left|left to pay)\b"),
    ("my_active_bookings", r"\b(?:rental|booking)\b.*\b(?:running|in progress)\b.*\b(?:my|account)\b|\b(?:may|meron)\b.*\b(?:ginagamit|tumatakbo)\b.*\b(?:rental|renta|booking)\b"),
    ("my_overdue_return", r"\b(?:lagpas|lampas)\b.*\b(?:ako|ko)\b.*\b(?:soli|pagsoli|balik|return)\b"),
    ("booking_status", r"\b(?:where|saan)\b.*\b(?:status|booking.*ko)\b"),
    ("schedule_conflict", r"\b(?:two|multiple|dalawa|dalawang|sabay)\b.*\b(?:rentals|bookings|renta|booking)\b.*\b(?:same|exact|overlap|sabay|weekend|oras)\b"),
    ("booking_limits", r"\bhow many\b.*\b(?:requests|bookings|rentals)\b.*\b(?:open|keep|pending)\b"),
    ("minimum_age", r"\b(?:minimum age|how old|ilang taon|edad)\b.*\b(?:rent|hire|book|renta|magrenta)\b"),
    ("unpaid_balance", r"\b(?:partial|balance|balanse|payment|bayad)\b.*\b(?:block|prevent|affect|harang|keep me from|stop)\b.*\b(?:rentals?|bookings?|rent|book|reservation)\b"),
    ("insurance_included", r"\binsurance\b.*\b(?:included|include|part of|cover|coverage|price|fee|rental)\b|\b(?:include|cover|kasama)\b.*\binsurance\b"),
    ("choose_specific_model", r"\b(?:choose|select|request|pick)\b.*\b(?:exact|specific|particular)\b.*\bmodel\b"),
    ("vehicle_categories", r"\b(?:what|which|ano|anong)\b.*\b(?:sorts|kinds|types|categories|kategorya)\b.*\b(?:vehicles?|sasakyan)\b"),
    ("same_day_rental", r"\b(?:book|reserve|rent|request)\b.*\b(?:collect|pickup|pick up|rent)\b.*\btoday\b"),
    ("payment_methods", r"\b(?:how|ways|methods|options)\b.*\b(?:pay|payment)\b.*\b(?:online|gcash|maya|card)\b"),
    ("booking_extension", r"\b(?:extend|extension|iextend|magextend|palawigin)\b|\b(?:keep|retain)\b.*\b(?:until|tomorrow|longer|extra)\b"),
    ("how_to_book", r"\b(?:how|paano|pano)\b.*\b(?:book|reserve|reserving|reservation|rent|hire|magbook|magrenta|mag rent)\b"),
    ("rental_requirements", r"\b(?:requirements|reqs|documents|what do i need|ano kailangan)\b.*\b(?:rent|hire|renta|maka rent|book)\b"),
    ("payment_downpayment", r"\b(?:split|partial|part of the bill|part of the payment|rest later|down payment|downpayment)\b.*\b(?:bill|pay|payment|rental|bayad|amount)\b|\bpay\b.*\b(?:rest later|30%)\b"),
    ("walk_in_payment", r"\b(?:settle|pay|bayad)\b.*\b(?:left|remaining|balance|balanse|rest)\b.*\b(?:collect|collection|pickup|pick up|cash|walk in|in person)\b"),
    ("security_deposit", r"\b(?:held temporarily|returned after rental|refundable deposit)\b"),
    ("late_return_policy", r"\b(?:charged|fee|penalty|what happens)\b.*\b(?:bring.*back|brings.*back|return|ibalik)\b.*\b(?:late|after.*(?:time|agreed)|lampas)\b"),
    ("reviews_ratings", r"\b(?:feedback|review|rate)\b.*\b(?:after returning|after.*rental|completed rental)\b"),
    ("messaging", r"\b(?:contact|message|talk)\b.*\b(?:owner|person renting|person who owns|may ari)\b"),
    ("same_day_rental", r"\b(?:same day|on the day.*(?:request|book))\b.*\b(?:rent|rental|car|vehicle|request)\b|\b(?:rent|rental)\b.*\bon the day\b"),
    ("available_transmission", r"\b(?:matic|automatic|manual|no clutch|without.*clutch|do not need.*clutch)\b.*\b(?:have|available|cars|vehicles|ba)\b|\b(?:may|have|cars|vehicles)\b.*\b(?:matic|automatic|manual|clutch pedal)\b"),
    ("unclear_message", r"^(?:di|hindi)\s+(?:ko\s+)?(?:gets|maintindihan|naiintindihan)\b"),
)


def practical_intent(query):
    return next((intent for intent, pattern in PRACTICAL_ROUTES if re.search(pattern, query)
                 and not (intent == "payment_methods" and re.search(r"\b(?:partial|downpayment|down payment|remaining|balance|percent)\b|\d+\s*%", query))), None)


def topic_for_query(query, topics):
    scores = {
        topic: sum(bool(re.search(r"\b" + re.escape(word) + r"\b", query)) for word in spec["keywords"])
        for topic, spec in topics.items()
    }
    best = max(scores.values(), default=0)
    winners = [topic for topic, score in scores.items() if score == best and score]
    return winners[0] if len(winners) == 1 else None


def topic_for_intent(intent, topics):
    return next((topic for topic, spec in topics.items() if intent in spec["intents"]), None)


CLARIFICATION_CHOICES = {
    "available_vehicles": r"(?:available )?(?:vehicles?|cars?|sasakyan|rentals?)|vehicles to rent",
    "rental_rate": r"(?:rental )?(?:prices?|rates?|cost)|magkano",
    "vehicle_availability_status": r"(?:unavailable )?(?:vehicles?|listings?)|(?:unavailable|availability|status)",
    "payment_methods": r"(?:payment )?(?:methods?|ways|options)|how to pay",
    "payment_downpayment": r"(?:the )?(?:downpayment|down payment)|30%",
    "unpaid_balance": r"(?:remaining |unpaid )?(?:balance|balances|balanse)|balance rules",
    "payment_troubleshooting": r"(?:unavailable )?(?:payment|payment option|gcash|maya)|payment problem",
    "how_to_book": r"(?:make |new )?(?:booking|reservation)|how to book|magbook",
    "booking_status": r"(?:my |own )?(?:booking )?status",
    "booking_cancellation": r"(?:cancel|cancellation|cancel booking)",
    "rental_requirements": r"(?:rental )?(?:requirements|documents)",
    "verification_troubleshooting": r"(?:rejected|failed)(?: verification)?|verification problem",
    "verification_security": r"(?:document )?(?:security|privacy|safe)",
    "account_password_reset": r"(?:reset |forgot )?password|password reset",
    "reviews_ratings": r"reviews?|ratings?|feedback",
    "notifications": r"notifications?|alerts?",
    "messaging": r"messaging|messages?|contact owner",
    "owner_listing_guidance": r"(?:vehicle )?listing|list my vehicle",
    "owner_booking_guidance": r"(?:booking )?requests|approvals",
    "owner_earnings_guidance": r"earnings|income|revenue",
    "help_request": r"help|capabilities|what you can do",
    "chat_identity": r"identity|who you are",
    "chat_language_support": r"languages?|dialects?",
}


def clarification_selection(query, candidates):
    answer = re.sub(r"^(?:the |about |what about |how about |and )", "", query).strip()
    matches = [intent for intent in candidates if intent in CLARIFICATION_CHOICES
               and re.fullmatch(CLARIFICATION_CHOICES[intent], answer)]
    return matches[0] if len(matches) == 1 else None


def availability_request(query, entities, vehicle_topic=False):
    unavailable = bool(re.search(r"\b(?:unavailable|not available|hindi available|di available|no longer available)\b", query))
    vehicle = entities.get("brand") or re.search(
        r"\b(?:vehicles?|cars?|kotse|sasakyan|units?|suvs?|vans?|trucks?|motorcycles?|listings?)\b", query
    ) or vehicle_topic or re.search(r"^(?:hindi|di|not)\s+available\b.*\b(?:gusto|wanted)\b", query)
    if not vehicle:
        return None, {}
    if re.search(r"\b(?:not|isn't|aren't|hindi|without) unavailable\b", query):
        return "available_vehicles", {}
    alternatives = re.search(r"\b(?:alternatives?|instead|other|else|ano pa|iba|ibang|pwede pa)\b", query)
    if unavailable and alternatives:
        return "available_vehicles", {}
    explanation = re.search(r"\b(?:why|bakit)\b", query) or (
        re.search(r"\b(?:page|results|shown|showing|visible|displayed|lumalabas|nakikita)\b", query)
        and re.search(r"\b(?:hidden|hide|not|hindi|di|wala|missing|disappeared)\b", query)
    )
    if explanation and not entities.get("brand") and (unavailable or vehicle_topic):
        return "vehicle_unavailability", {}
    future = re.search(r"\b(?:when|kailan)\b.*\bavailable\b.*\b(?:again|ulit)\b", query)
    if not (unavailable or future or (explanation and entities.get("brand"))):
        return None, {}
    general = not entities.get("model") and bool(
        re.search(r"\b(?:vehicles|cars|listings|units|sasakyan|suvs|vans|trucks|motorcycles)\b", query)
        or re.search(r"\b(?:any|all|there|many|which|list|show|display|pakita|ipakita|may|meron|mayroon|ilang|ilan|alin)\b", query)
        or (not entities.get("brand") and not re.search(r"\b(?:my|this|that|it|ko|ito|iyan)\b", query))
    )
    conditions = {"vehicle_status_overview": True} if general else {}
    if future and not re.search(r"\b(?:vehicles|cars|listings|sasakyan)\b", query):
        general = False
        conditions = {}
    if general and unavailable:
        conditions["vehicle_status_unavailable"] = True
    if general and re.search(r"\b(?:which|what|list|show|display|pakita|ipakita|alin|ano)\b", query):
        conditions["vehicle_status_list"] = True
    return "vehicle_availability_status", conditions


def split_questions(message):
    # Split independent questions, preserving clauses such as "pickup and return".
    parts = re.split(
        r"[?;]+\s*|\s+(?:and|also|at|tapos)\s+(?=(?:can|could|how|what|where|when|do|is|are|may|pwede|paano|magkano)\b)",
        message, flags=re.IGNORECASE,
    )
    return [part.strip(" .,") for part in parts if part.strip(" .,")]
