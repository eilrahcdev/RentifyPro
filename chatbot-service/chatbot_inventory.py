from contextvars import ContextVar
import re
import unicodedata


INVENTORY_VOCABULARY = ContextVar('inventory_vocabulary', default={})


def validate_inventory_vocabulary(value):
    """Only public listing vocabulary crosses the private Node/Python boundary."""
    if not isinstance(value, dict) or set(value) - {'brands', 'models', 'subtypes'}:
        return {}
    def label(text, limit):
        return isinstance(text, str) and 0 < len(text) <= limit and bool(re.fullmatch(r"[\w .&'/-]+", text, re.UNICODE))
    brands, models, subtypes = (value.get(key, []) for key in ('brands', 'models', 'subtypes'))
    if not all(isinstance(items, list) for items in (brands, models, subtypes)):
        return {}
    if len(brands) > 128 or len(models) > 512 or len(subtypes) > 256:
        return {}
    if any(not label(brand, 60) for brand in brands):
        return {}
    if any(not isinstance(item, dict) or set(item) != {'brand', 'model'}
           or item['brand'] not in brands or not label(item['model'], 80) for item in models):
        return {}
    if any(not isinstance(item, dict) or set(item) != {'category', 'name'}
           or item['category'] not in {'car', 'van', 'truck', 'motorcycle'}
           or not label(item['name'], 60) for item in subtypes):
        return {}
    return {'brands': brands, 'models': models, 'subtypes': subtypes}


def normalize_subtype(value):
    text = unicodedata.normalize('NFKC', str(value or '')).lower().replace('-', ' ')
    text = re.sub(r'\s+', ' ', text).strip()
    return {'pick up': 'pickup', 'sportsbike': 'sports bike', 'sportscar': 'sports car', 'bigbike': 'big bike'}.get(text, text)
