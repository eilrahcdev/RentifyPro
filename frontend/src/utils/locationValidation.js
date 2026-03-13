const normalizeLocation = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return { normalized: "", tokens: [] };

  const normalized = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    normalized,
    tokens: normalized ? normalized.split(" ") : [],
  };
};

const PHRASE_MATCHERS = new Set([
  "national capital region",
  "metro manila",
  "metro manila ncr",
  "calabarzon",
  "mimaropa",
  "bicol region",
  "western visayas",
  "central visayas",
  "eastern visayas",
  "zamboanga peninsula",
  "northern mindanao",
  "davao region",
  "soccsksargen",
  "caraga",
  "cordillera administrative region",
  "bangsamoro",
  "barmm",
  "davao de oro",
  "davao del norte",
  "davao del sur",
  "davao occidental",
  "davao oriental",
  "agusan del norte",
  "agusan del sur",
  "cagayan de oro",
  "lanao del norte",
  "lanao del sur",
  "maguindanao del norte",
  "maguindanao del sur",
  "zamboanga del norte",
  "zamboanga del sur",
  "zamboanga sibugay",
  "nueva ecija",
  "nueva vizcaya",
  "ilocos norte",
  "ilocos sur",
  "la union",
  "mountain province",
  "eastern samar",
  "northern samar",
  "southern leyte",
  "occidental mindoro",
  "oriental mindoro",
  "cotabato city",
  "san jose del monte",
  "general santos",
  "quezon city",
  "cebu city",
  "davao city",
  "dagupan city",
  "las pinas",
  "san juan",
  "puerto princesa",
]);

const PH_TOKENS = new Set([
  "philippines",
  "philippine",
  "ph",
  "pinas",
  "ncr",
  "luzon",
  "visayas",
  "mindanao",
  "barangay",
  "brgy",
  "sitio",
  "purok",
  "manila",
  "quezon",
  "cebu",
  "davao",
  "pangasinan",
  "dagupan",
  "caloocan",
  "makati",
  "malabon",
  "mandaluyong",
  "marikina",
  "muntinlupa",
  "navotas",
  "paranaque",
  "pasay",
  "pasig",
  "pateros",
  "taguig",
  "valenzuela",
  "bataan",
  "batanes",
  "batangas",
  "benguet",
  "biliran",
  "bohol",
  "bukidnon",
  "bulacan",
  "cagayan",
  "camarines",
  "camiguin",
  "capiz",
  "catanduanes",
  "cavite",
  "dinagat",
  "guimaras",
  "ifugao",
  "iloilo",
  "isabela",
  "kalinga",
  "laguna",
  "leyte",
  "marinduque",
  "masbate",
  "misamis",
  "negros",
  "palawan",
  "pampanga",
  "quezon",
  "quirino",
  "rizal",
  "romblon",
  "samar",
  "sarangani",
  "siquijor",
  "sorsogon",
  "sultan",
  "kudarat",
  "sulu",
  "surigao",
  "tarlac",
  "tawi",
  "zambales",
  "abra",
  "aklan",
  "albay",
  "antique",
  "apayao",
  "aurora",
  "basilan",
  "cotabato",
  "iloilo",
  "laoag",
  "tacloban",
  "tagum",
  "iligan",
  "butuan",
  "bacolod",
  "baguio",
  "naga",
  "roxas",
  "olongapo",
  "angeles",
  "lucena",
]);

const FOREIGN_PHRASES = new Set([
  "new york",
  "los angeles",
  "san francisco",
  "hong kong",
  "kuala lumpur",
  "ho chi minh",
  "kota kinabalu",
  "abu dhabi",
  "rio de janeiro",
  "saint petersburg",
  "kuala",
  "dubai",
  "united states",
  "united kingdom",
  "south korea",
  "north korea",
  "new zealand",
  "saudi arabia",
  "czech republic",
  "united arab emirates",
  "hong kong",
]);

const FOREIGN_TOKENS = new Set([
  "tokyo",
  "japan",
  "bangkok",
  "thailand",
  "singapore",
  "malaysia",
  "indonesia",
  "vietnam",
  "korea",
  "seoul",
  "china",
  "beijing",
  "shanghai",
  "taiwan",
  "taipei",
  "usa",
  "america",
  "canada",
  "toronto",
  "vancouver",
  "australia",
  "sydney",
  "melbourne",
  "london",
  "paris",
  "rome",
  "milan",
  "germany",
  "berlin",
  "france",
  "spain",
  "madrid",
  "italy",
  "dubai",
  "uae",
  "india",
  "delhi",
  "mumbai",
]);

const containsToken = (tokens, token) => tokens.includes(token);

const containsAnyToken = (tokens, tokenSet) => {
  for (const token of tokenSet) {
    if (containsToken(tokens, token)) return true;
  }
  return false;
};

const containsAnyPhrase = (normalized, phraseSet) => {
  for (const phrase of phraseSet) {
    if (normalized.includes(phrase)) return true;
  }
  return false;
};

export const isPhilippineLocation = (value) => {
  const { normalized, tokens } = normalizeLocation(value);
  if (!normalized) return false;

  if (containsAnyPhrase(normalized, FOREIGN_PHRASES) || containsAnyToken(tokens, FOREIGN_TOKENS)) {
    return false;
  }

  if (containsAnyPhrase(normalized, PHRASE_MATCHERS) || containsAnyToken(tokens, PH_TOKENS)) {
    return true;
  }

  return false;
};
