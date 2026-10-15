"""Bounded RentifyPro scope and high-specificity routing before semantic retrieval."""

import re


OUTSIDE_SCOPE_PATTERNS = tuple(re.compile(pattern) for pattern in (
    r"\b(?:ignore|override|bypass)\b.*\b(?:instructions|rules|security|validation|identity verification|kyc)\b|\b(?:reveal|print|show)\b.*\b(?:api keys?|tokens?|passwords?|environment variables|system prompt)\b",
    r"\b(?:netflix|spotify|amazon|shopee|lazada|youtube|facebook|tiktok)\b",
    r"\b(?:electricity|electric|water|internet|utility|phone)\s+bills?\b",
    r"(?<!in )\bstocks?\b|\b(?:shares|stock market|cryptocurrency|bitcoin|forex|savings|interest rate)\b",
    r"\b(?:airplanes?|aeroplanes?|aircraft|library|libraries|travel insurance|flight insurance)\b",
    r"\b(?:generators?|lawnmowers?|chainsaws?)\b",
    r"\b(?:how to|teach me to|how do i|paano|pano)\s+(?:drive|magdrive|magmaneho)\b",
    r"\b(?:get|obtain|apply for|renew)\b.*\b(?:driver'?s? licen[cs]e|passport)\b",
    r"\b(?:write|generate|make)\s+(?:me\s+)?(?:a\s+)?(?:poem|essay|story|code|program)\b",
    r"\b(?:weather forecast|capital of|president of|solve this|medical diagnosis)\b|\b(?:what|how).{0,15}\bweather\b",
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


SHORT_FOLLOWUPS = {
    "confirm": re.compile(r"(?:you sure|are you sure|really|is that true|are you certain|sigurado ka(?: ba)?|sure ka(?: ba)?|totoo ba|legit ba|talaga|sure ba (?:yan|iyan)|is that okay|okay lang ba|ok lang ba)"),
    "explain": re.compile(r"(?:how|why|bakit|how so|how does that work|can you explain|explain(?: further| please)?|tell me more|more details|paano|pano|paano (?:yun|iyon|gagawin)|(?:paano|pano) gawin (?:yun|iyon|yan)|how do i do that|can you show me how)"),
    "continue": re.compile(r"(?:and|then|what next|what'?s next|after that|continue|go on|anything else|tapos|tapos ano|pagkatapos|ano kasunod|and then)"),
}


def short_followup_action(query):
    return next((action for action, pattern in SHORT_FOLLOWUPS.items() if pattern.fullmatch(query)), None)


REQUESTED_ANSWER_TYPES = {"instructions", "navigation", "explanation", "overview", "troubleshooting", "confirmation", "continuation"}
REPAIR_REQUESTS = {
    "instructions": re.compile(r"(?:i (?:asked|said|meant) how(?: not if| to (?:do|request) it)?|no i meant how to do it|(?:explain|show me) the steps|(?:the )?steps(?: please)?|how do i actually do that|paano nga|ang tanong ko paano|paano ko gagawin)"),
    "explanation": re.compile(r"(?:i (?:asked|said|meant) why|ang tanong ko bakit|bakit nga)"),
    "navigation": re.compile(r"(?:where(?: exactly)?|where do i click|saan(?: ko (?:makikita|pipindutin)| nga)?)"),
    "unspecified": re.compile(r"(?:that'?s not (?:what i asked|helpful)|you'?re not answering my question|i already asked that|hindi (?:yan|iyan) yung tanong ko|hindi mo sinagot yung tanong ko)"),
}


def conversational_repair(query):
    return next((kind for kind, pattern in REPAIR_REQUESTS.items() if pattern.fullmatch(query)), None)


def requested_answer_type(query):
    if re.search(r"\b(?:why|bakit)\b", query):
        return "troubleshooting" if re.search(r"\b(?:can'?t|cannot|not|unable|hindi|di|ayaw)\b", query) else "explanation"
    if re.search(r"^(?:please (?:tell me )?)?(?:where|saan)\b|\bwhere (?:can|do|should|is)\b", query):
        return "navigation"
    if re.search(r"\b(?:how (?:do|can|to|should|would)|steps|paano|pano)\b", query):
        return "instructions"
    if re.match(r"(?:can|could|may|is|do|does|pwede|puwede|puwedeng)\b", query):
        return "overview"
    return None


def social_question_intent(query):
    if re.fullmatch(r"(?:(?:okay|ok|sige) )?(?:thanks(?: a lot| so much| po)?|thank you(?: so much| very much| po)?|(?:maraming )?salamat(?: po)?)", query):
        return "chat_gratitude"
    if re.fullmatch(r"(?:you (?:okay|ok|alright)|are you (?:okay|ok|alright)|okay ka(?: lang)? ba|ok ka ba|ayos ka ba|kamusta ka|kumusta ka)", query):
        return "chat_wellbeing"
    if re.fullmatch(r"(?:okay|ok|got it|understood|noted|sige|gets ko|sure)(?: po)?", query):
        return "chat_acknowledgement"
    return None


def frustration_variant(query):
    query = re.sub(r"\s+po$", "", query)
    if re.fullmatch(r"(?:hay (?:nako|naku)(?: naman)?|ugh|oh come on|sigh|haa?y)", query):
        return "frustration"
    if re.fullmatch(
        r"(?:nakakainis (?:ka(?: kausap)?|kang kausap)|nakakafrustrate (?:ka|kang kausap)|"
        r"ang hirap mong kausap|you(?:'re| are) (?:annoying|frustrating)|"
        r"(?:talking to you|this conversation) is (?:annoying|frustrating)|"
        r"you(?:'re| are) nakakainis(?: kausap)?|nakakainis (?:talking to you|ka kausap talaga))", query):
        return "dissatisfaction"
    return None


VEHICLE_SUBJECT = re.compile(
    r"(?:(?:eh|what about|how about|paano naman(?: ang)?) )?"
    r"(?:(?:manual|automatic|matic)(?: transmission)? )?"
    r"(?:cars?|kotse|sedans?|suvs?|vans?|trucks?|pick(?:up| up)(?: trucks?)?|"
    r"motorcycles?|motorbikes?|motorsiklo|motor|(?:big bike|sports bike|cruiser|scooter)(?: motorcycle)?)"
)


def vehicle_subject_fragment(query):
    return bool(VEHICLE_SUBJECT.fullmatch(query))


def conversation_reset_request(query):
    return bool(re.fullmatch(r"(?:start (?:a )?new (?:chat|conversation)|new (?:chat|conversation|search)|start over|reset|bagong usapan|magsimula ng bagong usapan)", query))


PRACTICAL_ROUTES = (
    ("chat_greeting", r"^(?:hello|hi|hey|good day)(?: there)?(?: rentify(?: ai)?)?$"),
    ("chat_identity", r"\bwho\b.*\b(?:am i (?:chatting|talking|speaking) (?:to|with)|is (?:replying|responding) to me)\b"),
    ("unclear_message", r"\b(?:confused|don'?t understand|did not understand|didn't understand)\b.*\b(?:answer|explanation|reply|that)\b"),
    ("nonsense_message", r"^[qzxjv]{6,20}$"),
    ("payment_checkout_expired", r"\b(?:checkout|payment|paymongo|link)\b.*\b(?:expired|expires|expiration)\b|\bexpired\b.*\b(?:checkout|payment|link)\b"),
    ("payment_troubleshooting", r"\b(?:paid|pay|payment|charged|deducted|debited|gcash|maya|card|bayad|nabawasan|binayaran)\b.*\b(?:twice|double|duplicate|unpaid|not paid|not updated|pending|processing|failed|unavailable|not available|disabled|offline|not working|dalawa|dalawang|hindi updated|ayaw gumana)\b|\b(?:charged|deducted|debited|nabawasan)\b.*\b(?:booking|account|rental|gcash|maya)\b"),
    ("account_password_reset", r"\b(?:forgot|forget|reset|forgotten|nakalimutan|limot)\b.*\b(?:password|login|sign in)\b|\bpassword\b.*\b(?:reset|forgot|nakalimutan)\b"),
    ("id_or_proof_of_address", r"\b(?:proof of (?:address|where i live)|address evidence|patunay ng tirahan)\b"),
    ("verification_troubleshooting", r"\b(?:verification|verify|identity|document|id|selfie|face|liveness)\b.*\b(?:rejected|declined|failed|fail|mismatch|not match|does not match|doesn't match|cannot|can't|ayaw|reject)\b|\b(?:rejected|failed|mismatch)\b.*\b(?:verification|selfie|document|id)\b"),
    ("rental_problem_support", r"\b(?:owner|pickup|pick up|vehicle|car|sasakyan|kotse)\b.*\b(?:no show|not show|didn't show|did not show|not arrive|missing|breakdown|broke down|broken down|won't start|nasira|sira|hindi dumating)\b|\b(?:breakdown|broke down|nasira)\b.*\b(?:rental|car|vehicle|sasakyan)\b"),
    ("owner_listing_guidance", r"\b(?:how|where|paano|pano)\b.*\b(?:list|listings?|add|publish|edit|change|update|maglist|ilista)\b.*\b(?:vehicle|car|listings?|price|rate|sasakyan)\b|\b(?:change|edit|update)\s+(?:my\s+)?(?:listing|vehicle)\s+(?:price|rate)\b|\bowner\b.*\b(?:put|offer)\b.*\b(?:car|vehicle)\b.*\b(?:rent|rental)\b"),
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
    ("choose_specific_model", r"\b(?:choose|select|request|pick|pumili|piliin)\b.*\b(?:exact|specific|particular|partikular|tiyak)\b.*\b(?:model|modelo)\b"),
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


HOW_TO = re.compile(r"\b(?:how|where|steps|paano|pano|saan)\b")
WALK_IN = re.compile(r"\b(?:walk[ -]?in|in person|cash|cash payment)\b")
PAYMENT_PROBLEM = re.compile(r"\b(?:fail|fails|failed|unavailable|not working|not updated|not recorded|deducted|charged|expired|twice|double|duplicate|nabawasan)\b")
REQUEST_REFERENCE = re.compile(
    r"(?:how|where|paano|pano|saan)(?: do i| can i| to| ko| ako| ba| po)? (?:request|apply|mag request|i request|ire-?request)(?: for)? (?:it|this|that|ito|iyon|yun|yan)(?: po)?|"
    r"(?:paano|pano)(?: ko| ba| po){0,3} (?:ito|iyon|yun|yan) (?:i request|i-request|ire-?request)|"
    r"(?:steps|the steps|steps please|show me the steps)"
)


def support_response_route(query, context):
    """Choose a policy answer's purpose in Python; Node serves its approved text."""
    previous = context.get("intent")
    query = re.sub(r"^(?:anyway|by the way|sige)[ ,]+", "", query)
    purpose = requested_answer_type(query)
    if (re.search(r"\b(?:policies|patakaran)\b", query)
            and not re.search(r"\b(?:cancel|cancellation|refund|return|late|extend|extension|deposit|insurance)\b", query)):
        return "help_request", "policies"
    if re.fullmatch(r"where is (?:the )?(?:message|chat) button", query):
        return "messaging", "navigation"
    if re.search(r"\b(?:what (?:do you|did you|does) mean|what does|explain|ano(?: ang)? ibig sabihin)\b.*\b(?:got it|noted)\b", query):
        return "chat_acknowledgement", "explanation"
    if re.search(r"\btricycles?\b", query) and re.search(r"\b(?:may|meron|mayroon|have|rent|available|show|tricycles?)\b", query):
        return "vehicle_categories", "unsupported_tricycle"
    if (previous == "messaging" and re.fullmatch(
        r"(?:what if|what happens if|paano kung|kapag|kung) (?:the owner|owner|they|he|she|si owner) (?:doesn'?t|does not|don'?t|do not|won'?t|will not|hindi) (?:reply|respond|answer|sumagot|magreply|mag reply)", query)):
        return "messaging", "no_reply"
    if purpose and re.search(r"\b(?:message|messaging|chat|contact|talk|mag message|mag-message)\b.*\b(?:owner|may ari)\b", query):
        return "messaging", purpose
    if purpose in {"instructions", "navigation", "troubleshooting"}:
        if re.search(r"\breport\b.*\b(?:rental|booking|problem|issue)\b", query):
            return "rental_problem_support", purpose
        if (re.search(r"\b(?:manage|list|add|edit|publish)\b", query)
                and re.search(r"\b(?:vehicles?|listings?|sasakyan)\b", query)
                and not re.search(r"\b(?:bookings?|requests?)\b", query)):
            return "owner_listing_guidance", purpose
        if re.search(r"\b(?:browse|search|find|filter|maghanap|hanapin)\b.*\b(?:vehicles?|cars?|listings?|sasakyan)\b", query):
            return "available_vehicles", purpose
        if re.search(r"\b(?:verify|verification|identity|kyc)\b", query) and not re.search(r"\b(?:rejected|failed|expired|different|update|change)\b", query):
            return "verification_security", purpose
        if re.search(r"\b(?:book|magbook|mag-book)\b", query) and not re.search(r"\b(?:cancel|extend|extension|payment|pay|approve|decline|owner)\b", query):
            return "how_to_book", purpose if purpose != "instructions" else None
    rental_reference = previous == "rental_problem_support" or bool(re.search(r"\b(?:rentals?|rented|rentifypro|booking|owner|pickup|sasakyan|kotse|renta|nirentahan)\b", query))
    if rental_reference:
        for variant, pattern in (
            ("emergency", r"\b(?:accidents?|crash|crashed|collision|injured|injury|hurt|naaksidente|aksidente|nasaktan|sugatan)\b"),
            ("theft", r"\b(?:stolen|theft|carnapped|ninakaw|nakaw)\b"),
            ("lost_keys", r"\b(?:lost|missing|nawala)\b.*\b(?:keys?|susi)\b"),
            ("breakdown", r"\b(?:breakdown|broke down|broken down|won't start|nasira|nasiraan)\b"),
            ("damage", r"\b(?:scratches?|scratched|damage|damaged|dent|dents|gasgas|sira|dispute|disputed|blames|blamed)\b|\b(?:different|match|mismatch)\b.*\b(?:photos?|pictures?|listing)\b"),
        ):
            if re.search(pattern, query):
                return "rental_problem_support", variant
    if re.search(r"\b(?:reschedule|shorten|earlier return|change.*(?:pickup|pick up|collection)|move.*(?:pickup|pick up)|change.*(?:rental|booking).*dates?)\b", query):
        return "booking_changes_guidance", None
    if re.search(r"\b(?:mileage|kilomet(?:er|re)s?|tolls?|parking|traffic fines?|traffic tickets?|additional charges?|extra charges?)\b", query):
        return "rental_terms_guidance", None
    if re.search(r"\b(?:id|document|verification|kyc)\b", query):
        if re.search(r"\b(?:protects?|protected|private|privacy|secure|security|safe)\b", query):
            return "verification_security", None
        for variant, pattern in (
            ("expired_id", r"\b(?:expired|expiry|expiration|paso)\b"),
            ("different_id", r"\b(?:different|another|other|ibang)\b.*\b(?:id|document)\b"),
            ("update", r"\b(?:update|change|edit|palitan|baguhin)\b"),
        ):
            if re.search(pattern, query):
                return "verification_troubleshooting", variant
    if re.search(r"\b(?:receipt|invoice|resibo)\b", query) and re.search(r"\b(?:payment|pay|rental|bayad|booking)\b", query) and not WALK_IN.search(query) and previous != "walk_in_payment":
        return "payment_troubleshooting", "receipt"
    if re.search(r"\bdeposit\b", query) and re.search(r"\b(?:down ?payment|30 percent)\b|30\s*%", query):
        return "security_deposit", "distinction"
    if re.search(r"\b(?:discount|promo)\b", query) and re.search(r"\b(?:booking|rental|rent|renta|suv|van|car|vehicle|advance|early)\b", query):
        return "advance_booking_discount", None
    if (previous == "choose_specific_model" and not context.get("entities", {}).get("model")
            and re.search(r"\b(?:unavailable|not available|di available|hindi available)\b", query)):
        return "choose_specific_model", "unavailable"
    if re.search(r"\b(?:owner|may ari)\b", query) and re.search(r"\b(?:rejects?|rejected|declines?|declined|tanggihan|tumanggi)\b", query):
        if previous == "walk_in_payment" and not re.search(r"\bbooking\b", query):
            return "walk_in_payment", "rejection"
        if previous in {"how_to_book", "choose_specific_model", "booking_status"} or re.search(r"\b(?:booking|reservation)\b", query):
            return "booking_status", "rejection"
    if PAYMENT_PROBLEM.search(query) and re.search(r"\b(?:payment|pay|gcash|maya|card|bayad)\b", query):
        return "payment_checkout_expired" if re.search(r"\bexpired\b", query) else "payment_troubleshooting", None
    if (purpose == "instructions" and re.search(r"\b(?:pay|magbayad|makapagbayad|pagbabayad|bayaran)\b", query)
            and not WALK_IN.search(query)
            and not re.search(r"\b(?:downpayment|down payment|partial|balance|balanse|deposit)\b|\d+\s*%", query)):
        return "payment_methods", support_response_variant("payment_methods", query) or "instructions"
    if re.fullmatch(r"(?:what about|how about|and|paano ang|paano naman ang) (?:payment|payments|bayad|pagbabayad)", query):
        return "payment_methods", None
    if re.fullmatch(r"(?:how|paano|pano)(?: do i| can i)? (?:cancel|mag cancel|magcancel)", query):
        return "booking_cancellation", "instructions"
    if previous in {"how_to_book", "choose_specific_model", "booking_status", "booking_extension"} and re.search(
        r"\b(?:how long|gaano katagal|ilang oras)\b.*\b(?:approval|approve|approved|pag apruba)\b", query):
        return "booking_status", "approval_timing"
    if WALK_IN.search(query) and practical_intent(query) in {
        "rental_refund_guidance", "booking_cancellation", "booking_extension",
        "payment_troubleshooting", "payment_checkout_expired",
    }:
        return None, None
    explicit_walk_in = bool(WALK_IN.search(query)) and bool(re.search(
        r"\b(?:walk[ -]?in|payment|pay|accept|checkout|balance|remaining|bayad|magbayad|balanse)\b", query))
    walk_followup = previous == "walk_in_payment" and bool(re.fullmatch(
        r"(?:how|where|paano|pano|saan)(?: do i| can i| ko| ako| ba)? (?:request|apply|check|see|mag request|i request|irequest|makikita)(?: for)? (?:it|this|that|ito|iyon|yun|yan|ang status|yung status)(?: po)?|"
        r"(?:does|will|must|can|kailangan|need|dapat|paano|what if|what happens if|paano kung).{0,35}(?:owner|may ari).{0,45}(?:approve|approval|reject|decline|confirm|aprubahan|apruba|tanggihan|tumanggi).{0,25}|"
        r"(?:what if|paano kung|kapag|kung).{0,35}(?:reject|decline|rejected|denied|tumanggi).{0,25}|"
        r"(?:can i|pwede|puwede|pde).{0,25}(?:without|no|walang).{0,12}(?:down ?payment|deposit)|"
        r"(?:why|bakit|requirements|conditions|how|paano|explain|tell me more|more details)|"
        r"(?:yes|yes please|oo|opo|sige)", query))
    if previous == "walk_in_payment" and (REQUEST_REFERENCE.fullmatch(query) or (
        len(query) <= 150 and re.search(r"\b(?:owner|may ari|it|ito|request)\b", query)
        and re.search(r"\b(?:approval|approves?|rejects?|rejected|declined|confirm|aprubahan|apruba|tanggihan)\b", query)
    )):
        walk_followup = True
    if re.search(r"\b(?:booking|extension|cancel|cancellation|refund|earnings|listing|verification)\b", query):
        walk_followup = False
    if query in {"yes", "yes please", "oo", "opo", "sige"} and (context.get("response_variant") not in (None, "overview")
            or (context.get("assistant_action") and not context.get("pending_offer"))):
        walk_followup = False
    # A failed online payment needs troubleshooting, even when cash is mentioned.
    if (explicit_walk_in or walk_followup) and not PAYMENT_PROBLEM.search(query):
        return "walk_in_payment", support_response_variant("walk_in_payment", query, context)
    if previous in {"booking_extension", "booking_cancellation"} and REQUEST_REFERENCE.fullmatch(query):
        return previous, "instructions"
    if (re.search(r"\b(?:pay|payment|bayad|magbayad|bayaran)\b", query)
            and re.search(r"\b(?:full|buong|whole|everything)\b|100\s*%", query)
            and not PAYMENT_PROBLEM.search(query)):
        return "payment_downpayment", "full_payment"
    if re.search(r"\b(?:down ?payment|partial payment|30 percent)\b|\b30\s*%", query) and not re.search(r"\b(?:block|prevent|affect|stop|overdue|due date|deadline)\b", query):
        return "payment_downpayment", support_response_variant("payment_downpayment", query, context)
    if not re.search(r"\b(?:down ?payment|partial|balance|remaining|percent)\b|\d+\s*%", query) and not PAYMENT_PROBLEM.search(query):
        if re.search(r"\b(?:gcash|maya|credit card|debit card)\b", query) and re.search(r"\b(?:pay|payment|accept|use|using|bayad|magbayad|pwede|puwede)\b", query):
            return "payment_methods", support_response_variant("payment_methods", query)
        if re.search(r"\b(?:methods?|ways|options|paraan)\b", query) and re.search(r"\b(?:pay|payment|payments|bayad|pagbabayad|magbayad)\b", query):
            return "payment_methods", support_response_variant("payment_methods", query)
    return None, None


def support_response_variant(intent, query, context=None):
    context = context or {}
    purpose = requested_answer_type(query)
    if intent == "walk_in_payment":
        if re.search(r"\b(?:without|no|walang|wala pang|hindi pa).{0,20}\b(?:down ?payment|deposit)\b", query):
            return "no_downpayment"
        if re.search(r"\b(?:without|before|no|walang|bago).{0,25}\b(?:approval|approve|apruba|aprubahan)\b", query):
            return "no_approval"
        if re.search(r"\b(?:initial|first payment|checkout|upfront|buong|full amount)\b", query):
            return "initial_payment"
        if re.search(r"\b(?:rejects?|rejected|declines?|declined|denied|tanggihan|tumanggi)\b", query):
            return "rejection"
        if re.search(r"\b(?:status|pending|check|see|makikita)\b", query):
            return "status"
        if re.search(r"\b(?:confirms?|confirmation|confirmed|received|receipt|paid|nabayaran|natanggap)\b", query):
            return "confirmation"
        if re.search(r"\b(?:approves?|approval|aprubahan|apruba)\b", query):
            return "approval"
        if re.search(r"\b(?:requirements|conditions|eligible|eligibility|required|need|kailangan|why|bakit|explain|tell me more|more details)\b", query):
            return "requirements"
        if purpose == "navigation":
            return "navigation"
        if HOW_TO.search(query) or (query in {"yes", "yes please", "oo", "opo", "sige"}
                                   and context.get("response_variant") in (None, "overview")):
            return "instructions"
        return "overview"
    if intent == "payment_methods":
        channels = [channel for channel in ("gcash", "maya", "card") if re.search(r"\b" + channel + r"\b", query)]
        return channels[0] if len(channels) == 1 else "instructions" if HOW_TO.search(query) else None
    if purpose in {"navigation", "explanation", "troubleshooting"}:
        return purpose
    if intent == "payment_downpayment":
        if HOW_TO.search(query):
            return "instructions"
        if re.search(r"\b(?:full|buong|whole|everything)\b|100\s*%", query):
            return "full_payment"
    if intent == "booking_extension" and HOW_TO.search(query):
        return "instructions"
    if intent == "booking_cancellation" and HOW_TO.search(query):
        return "instructions"
    if purpose == "instructions" and intent in {"messaging", "available_vehicles", "verification_security", "rental_requirements", "owner_listing_guidance", "owner_booking_guidance", "rental_problem_support"}:
        return "instructions"
    return None


def rental_search_intent(query, entities):
    if entities.get("driver_included_required") and re.search(r"\b(?:find|show|looking|hanap)\b", query):
        return "available_vehicles"
    if entities.get("quote_requested") or ((entities.get("duration_value") or "driver_requested" in entities) and re.search(r"\b(?:how much|magkano|cost|price|presyo)\b", query)):
        return "rental_rate"
    vehicle = entities.get("category") or entities.get("brand") or entities.get("model") or entities.get("pax") or entities.get("fuel") or entities.get("excluded_fuels") or entities.get("excluded_subtypes") or entities.get("self_drive_only")
    if not vehicle:
        return None
    if re.search(r"\bpick ?up (?:my|our|the|your|this|that)\b", query):
        return None
    if entities.get("sort_by") == "lowest_price":
        return "available_vehicles"
    if re.search(r"\b(?:paperwork|requirements|documents|licen[cs]e|insurance|deposit|payment|pay|bookings?|policy|policies|refuel|full tank)\b", query):
        return None
    if ((entities.get("pax") and not re.search(r"\b(?:how many|capacity of|capacity ng|kasya ba|fit)\b", query))
        or entities.get("fuel") or entities.get("excluded_fuels") or entities.get("excluded_subtypes") or entities.get("self_drive_only")
        or ("driver_requested" in entities and (entities.get("category") or re.search(r"\b(?:find|show|looking|hanap|vehicles|sasakyan)\b", query)))):
        return "available_vehicles"
    if entities.get("brand"):
        return None
    if re.search(r"\b(?:fuel|driver|drive)\b", query):
        return None
    if entities.get("category") and re.match(r"(?:i (?:meant|mean)|ang ibig kong sabihin)\b", query):
        return "available_vehicles"
    subject_query = re.sub(r"\s+do you have(?: any| them| those)?$", "", query)
    bare_category = vehicle_subject_fragment(subject_query)
    capacity_search = entities.get("pax") and entities.get("category") and not re.search(r"\b(?:can (?:it|this|that)|how many|capacity of|capacity ng|fit (?:in|into) (?:the|this|that))\b", query)
    if bare_category or capacity_search or entities.get("vehicle_subtype") or entities.get("duration_value") or entities.get("location") or re.search(r"\b(?:may|meron|mayroon|availability|show|find|looking|recommend|magrenta|irerent|rentahan)\b|\b(?:can|could|may) i (?:rent|hire)\b|\bavailable\b.*\b(?:now|today|tomorrow|bukas|ngayon)\b", query):
        return "rental_rate" if re.search(r"\b(?:how much|magkano|cost|price|presyo)\b", query) else "available_vehicles"
    return None


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
        r"[?;]+\s*|\s*,?\s+(?:and|also|at|tapos)\s+(?=(?:can|could|how|what|where|when|do|is|are|may|pwede|paano|magkano|quote|pay|will)\b)",
        message, flags=re.IGNORECASE,
    )
    return [part.strip(" .,") for part in parts if part.strip(" .,")]
