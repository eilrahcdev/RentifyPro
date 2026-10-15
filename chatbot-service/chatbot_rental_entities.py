"""Public rental preferences; these never certify prices or booking availability."""

import math
import re
from datetime import date, datetime, timedelta, timezone

MANILA = timezone(timedelta(hours=8), "Asia/Manila")
NUMBER_WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
    "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "isa": 1, "isang": 1, "dalawa": 2, "dalawang": 2, "tatlo": 3,
    "tatlong": 3, "apat": 4, "limang": 5, "lima": 5, "anim": 6, "pitong": 7, "pito": 7,
}
NUMBER = r"(?:\d+(?:\.\d+)?|" + "|".join(NUMBER_WORDS) + r")"
DURATION = re.compile(rf"\b({NUMBER})\s*[- ]?\s*(days?|hours?|araw|oras)\b", re.I)
RENTAL_FIELDS = {"duration_value", "duration_unit", "sort_by", "quote_requested",
                 "driver_requested", "listing_id", "requested_date", "requested_return_date",
                 "pickup_time", "return_time", "fuel", "excluded_fuels", "self_drive_only",
                 "seat_match", "specification_requested", "driver_included_required"}
FUELS = {"gasoline", "diesel", "electric", "hybrid"}
SPECIFICATION_FIELDS = {"seats", "fuel", "transmission", "driver", "self_drive", "subtype"}


def requested_vehicle_specification(message):
    text = message.lower()
    if re.search(r"\b(?:how many|ilang)\b.*\b(?:seats|passengers|upuan|pasahero)\b", text):
        return "seats"
    if re.search(r"\b(?:what|which|anong|ano ang)\b.*\b(?:fuel|gasolina)\b", text):
        return "fuel"
    if re.search(r"\b(?:what type|what kind|anong uri|anong type|subtype|sub-type)\b", text):
        return "subtype"
    if re.search(r"\b(?:is|does|can|may|puwede|pwede)\b.*\bself[- ]?drive\b", text):
        return "self_drive"
    if re.search(r"\b(?:is|does|has|may|kasama)\b.*\bdriver\b", text):
        return "driver"
    if re.search(r"\b(?:what|which|is|anong)\b.*\b(?:transmission|automatic|manual|matic)\b", text):
        return "transmission"
    return None


def specification_mentions(message):
    text = message.lower()
    values = {"fuel": [], "transmission": [], "driver": []}
    exclusions = {"fuel": [], "transmission": []}
    for field, pattern, aliases in (
        ("fuel", r"\b(?:gasoline|gasolina|gas|petrol|diesel|deisel|electric|hybrid)\b", {"gas": "gasoline", "gasolina": "gasoline", "petrol": "gasoline", "deisel": "diesel"}),
        ("transmission", r"\b(?:automatic|manual|matic)\b", {"matic": "automatic"}),
    ):
        for match in re.finditer(pattern, text):
            value = aliases.get(match.group(), match.group())
            negative = re.search(r"\b(?:not|no|without|exclude|except|hindi|ayaw(?: ko)?)(?: ng)?\s*$", text[:match.start()])
            target = exclusions[field] if negative else values[field]
            if value not in target:
                target.append(value)
    for match in re.finditer(r"\b(?:AT|MT)\b", message, re.I):
        after = text[match.end():].strip(" .,?!:")
        if ((not after and (match.group().isupper() or match.group().lower() == "mt")) or re.search(r"\btransmission\s*[:=]?\s*$", text[:match.start()])
            or re.match(r"(?:(?:na|diesel|gasoline|petrol|electric|hybrid)\s+)*(?:transmission|cars?|vehicles?|vans?|suvs?|trucks?|motorcycles?)\b", after)):
            value = "automatic" if match.group().upper() == "AT" else "manual"
            negative = re.search(r"\b(?:not|no|without|exclude|except|hindi|ayaw(?: ko)?)(?: ng)?\s*$", text[:match.start()])
            target = exclusions["transmission"] if negative else values["transmission"]
            if value not in target:
                target.append(value)
    if re.search(r"\b(?:without (?:a )?driver|no driver|self[- ]?drive|walang driver|walang tsuper)\b", text):
        values["driver"].append(False)
    if re.search(r"\b(?:with (?:a )?driver|may driver|kasama(?:ng)? driver|includes? (?:a )?driver|driver available|with (?:a )?chauffeur)\b", text):
        values["driver"].append(True)
    return values, exclusions


def specification_conflict(message):
    values, _ = specification_mentions(message)
    return next((field for field, options in values.items() if len(options) > 1), None)


def valid_rental_fields(entities):
    if "seat_match" in entities and (not isinstance(entities["seat_match"], str)
        or entities["seat_match"] not in {"exact", "minimum"} or not entities.get("pax")):
        return False
    if "specification_requested" in entities and (not isinstance(entities["specification_requested"], str)
        or entities["specification_requested"] not in SPECIFICATION_FIELDS):
        return False
    if "fuel" in entities and (not isinstance(entities["fuel"], str) or entities["fuel"] not in FUELS):
        return False
    excluded = entities.get("excluded_fuels", [])
    if not isinstance(excluded, list) or len(excluded) > 4 or any(not isinstance(item, str) or item not in FUELS for item in excluded):
        return False
    value, unit = entities.get("duration_value"), entities.get("duration_unit")
    if ("duration_value" in entities) != ("duration_unit" in entities):
        return False
    if "duration_value" in entities and (isinstance(value, bool) or not isinstance(value, (int, float))
                             or not math.isfinite(value) or not isinstance(unit, str) or unit not in {"day", "hour"}
                             or not 0 < value <= (365 if unit == "day" else 8760)
                             or value * (1440 if unit == "day" else 60) % 1 != 0):
        return False
    if "sort_by" in entities and entities["sort_by"] != "lowest_price":
        return False
    for field in ("quote_requested", "driver_requested", "self_drive_only", "driver_included_required"):
        if field in entities and not isinstance(entities[field], bool):
            return False
    if entities.get("self_drive_only") and entities.get("driver_requested") is not False:
        return False
    if "listing_id" in entities and (not isinstance(entities["listing_id"], str)
                                    or not re.fullmatch(r"[a-f0-9]{24}", entities["listing_id"])):
        return False
    for field in ("requested_date", "requested_return_date"):
        if field in entities:
            try:
                if not isinstance(entities[field], str) or date.fromisoformat(entities[field]).isoformat() != entities[field]:
                    return False
            except ValueError:
                return False
    for field in ("pickup_time", "return_time"):
        if field in entities and (not isinstance(entities[field], str)
                                 or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", entities[field])):
            return False
    return True


def extract_rental_preferences(message, now=None):
    text = message.lower()
    entities = {}
    passengers = re.search(rf"\b({NUMBER})\s*[- ]?\s*(pax|passengers?|persons?|people|katao|tao|pasahero|seats?|seaters?|upuan)\b", text)
    seats_first = re.search(rf"\bseats?\s+for\s+({NUMBER})\b", text)
    if not passengers and seats_first:
        passengers = seats_first
    if not passengers:
        passengers = re.search(rf"\b(?:kasya(?: ang)?|pang)\s+({NUMBER})\b", text)
    if passengers and not text[:passengers.start()].rstrip().endswith("-"):
        amount = passengers.group(1)
        count = NUMBER_WORDS[amount] if amount in NUMBER_WORDS else float(amount)
        if count % 1 == 0 and 0 < count <= 99:
            entities["pax"] = int(count)
            capacity = bool(re.search(r"\b(?:at least|minimum|no less than|fit|pang|kasya)\b", text))
            explicit_seats = seats_first or re.search(r"\b(?:seats?|seaters?|upuan)\b", passengers.group())
            exact_passengers = re.search(r"\bpassengers?\s+vehicles?\b", text)
            entities["seat_match"] = "exact" if (explicit_seats and (seats_first or not capacity)
                or exact_passengers) else "minimum"
    durations = [match for match in DURATION.finditer(text) if not text[:match.start()].rstrip().endswith("-")]
    if len(durations) == 1:
        amount, unit = durations[0].groups()
        entities["duration_value"] = NUMBER_WORDS[amount] if amount in NUMBER_WORDS else float(amount)
        entities["duration_unit"] = "day" if unit.startswith("day") or unit == "araw" else "hour"
        if not valid_rental_fields(entities):
            entities.pop("duration_value", None)
            entities.pop("duration_unit", None)
    if re.search(r"\b(?:cheapest|lowest[- ]price|most affordable|pinaka[- ]?mura(?:ng)?|pinakamababang presyo)\b", text):
        entities["sort_by"] = "lowest_price"
    if re.search(r"\b(?:total|quotation|quote|(?:magkano|how much) lahat|magkano.*kabuuan|kabuuang.*(?:presyo|bayad))\b", text):
        entities["quote_requested"] = True
    specifications, exclusions = specification_mentions(message)
    for field in ("fuel", "transmission"):
        if specifications[field]:
            entities[field] = specifications[field][0]
    if exclusions["fuel"]:
        entities["excluded_fuels"] = exclusions["fuel"]
    if exclusions["transmission"]:
        entities["excluded_transmissions"] = exclusions["transmission"]
    if specifications["driver"]:
        entities["driver_requested"] = specifications["driver"][0]
    if re.search(r"\b(?:self[- ]?drive only|without (?:a )?driver only|walang driver lang)\b", text):
        entities["self_drive_only"] = True
    if re.search(r"\bdriver\b.*\bincluded\b.*\b(?:price|rate|cost)\b|\b(?:price|rate)\b.*\bincludes?\b.*\bdriver\b", text):
        entities["driver_included_required"] = True

    today = (now or datetime.now(MANILA)).astimezone(MANILA).date()
    dates = []
    for match in re.finditer(r"\b(?:day after tomorrow|tomorrow|today|tonight|bukas|ngayon|\d{4}-\d{2}-\d{2}|(?:next )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b", text):
        token = match.group()
        if token in {"tomorrow", "bukas", "day after tomorrow", "today", "tonight", "ngayon"}:
            parsed = today + timedelta(days=2 if token == "day after tomorrow" else 1 if token in {"tomorrow", "bukas"} else 0)
        elif re.match(r"\d{4}-", token):
            try:
                parsed = date.fromisoformat(token)
            except ValueError:
                continue
        else:
            weekday = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].index(token.replace("next ", ""))
            offset = (weekday - today.weekday()) % 7
            parsed = today + timedelta(days=offset or 7)
        dates.append(parsed.isoformat())
    if dates:
        return_only = len(dates) == 1 and re.search(r"\b(?:return|dropoff|ibalik)\b", text) and not re.search(r"\b(?:pickup|pick up|collect|kunin)\b", text)
        entities["requested_return_date" if return_only else "requested_date"] = dates[0]
        if len(dates) > 1:
            entities["requested_return_date"] = dates[1]
    times = []
    time_fields = []
    previous_time_end = 0
    for match in re.finditer(r"\b(\d{1,2})(?::([0-5]\d))?\s*(am|pm)\b|\b([01]?\d|2[0-3]):([0-5]\d)\b", text):
        hour, minute, meridiem, hour24, minute24 = match.groups()
        if meridiem:
            if not 1 <= int(hour) <= 12:
                continue
            times.append(f"{int(hour) % 12 + (12 if meridiem == 'pm' else 0):02d}:{minute or '00'}")
        else:
            times.append(f"{int(hour24):02d}:{minute24}")
        actions = list(re.finditer(r"\b(?:return|dropoff|ibalik|pickup|pick up|collect|kunin)\b", text[previous_time_end:match.start()]))
        action = actions[-1].group() if actions else None
        time_fields.append("return_time" if action in {"return", "dropoff", "ibalik"} or (action is None and len(times) > 1) else "pickup_time")
        previous_time_end = match.end()
    if times:
        for field, clock in zip(time_fields[:2], times[:2]):
            entities[field] = clock
    return entities
