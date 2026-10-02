import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import API from "../utils/api";
import { normalizeLocationSearch, sanitizeLocationInput, validateLocationSearch } from "../utils/locationSearch";
import RotatingSearchHint from "./RotatingSearchHint";

export default function LocationSearchInput({ value, onChange, vehicleType, error, onError, inputRef }) {
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(-1);
  const [result, setResult] = useState(null);
  const search = normalizeLocationSearch(value);
  const validSearch = !validateLocationSearch(search, { minLetters: 1 });
  const open = focused && Boolean(search) && validSearch;
  const shouldFetch = validSearch && (focused || !search);
  const queryKey = `${search}\u0000${vehicleType}`;
  const suggestions = result?.key === queryKey ? result.locations : [];
  const resultKey = result?.key;
  const status = resultKey === queryKey ? result.status : "Finding locations with available vehicles…";
  const hintItems = !search && resultKey === queryKey
    ? suggestions.map(({ location }) => location.split(",").map((part) => part.trim()))
      .filter((parts) => parts.length === 2 && parts.every(Boolean))
      .map((parts) => parts.join(", "))
      .filter((hint, index, hints) => hints.indexOf(hint) === index)
    : [];

  useEffect(() => {
    if (!shouldFetch || resultKey === queryKey) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await API.getVehicleLocations({ search, vehicleType }, controller.signal);
        if (controller.signal.aborted) return;
        const locations = (response.locations || []).slice(0, 3);
        setActive(-1);
        setResult({ key: queryKey, locations, status: locations.length
          ? "Matching areas with vehicles"
          : "No available vehicles found for this location." });
      } catch (err) {
        if (!controller.signal.aborted) setResult({ key: queryKey, locations: [], status: err.message || "Location suggestions are unavailable. You can still search." });
      }
    }, search ? 250 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [shouldFetch, resultKey, search, vehicleType, queryKey]);

  const select = (entry) => {
    onChange(sanitizeLocationInput(entry.location));
    onError("");
    inputRef?.current?.blur();
    setFocused(false);
    setActive(-1);
  };

  return (
    <div className="relative min-w-0">
      <label htmlFor="home-search-location" className="text-xs font-semibold text-slate-600">Search by location <span className="font-normal">(optional)</span></label>
      <div className="rp-location-search__control relative mt-1.5" data-hint-active={!focused && !value && hintItems.length > 0}>
        <MapPin size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#0B75E7]" />
        <input
          id="home-search-location" ref={inputRef} name="location" role="combobox" autoComplete="off"
          aria-autocomplete="list" aria-expanded={open}
          aria-controls={open ? "home-location-options" : undefined} aria-activedescendant={open && suggestions[active] ? `home-location-option-${active}` : undefined}
          aria-invalid={Boolean(error)} aria-describedby={`home-location-help${error ? " home-location-error" : ""}`}
          maxLength={180} value={value} placeholder="City, Province"
          className="rp-input !pl-10"
          onFocus={() => { setFocused(true); setActive(-1); }}
          onClick={() => setFocused(true)}
          onChange={(event) => {
            const next = sanitizeLocationInput(event.target.value);
            onChange(next);
            setResult(null);
            setActive(-1);
            setFocused(true);
            if (error) onError(validateLocationSearch(next));
          }}
          onBlur={() => { setFocused(false); onError(validateLocationSearch(value)); }}
          onKeyDown={(event) => {
            if (event.key === "Escape") { event.preventDefault(); setFocused(false); }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault(); setFocused(true);
              if (suggestions.length) setActive((previous) => previous < 0
                ? (event.key === "ArrowDown" ? 0 : suggestions.length - 1)
                : (previous + (event.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length);
            }
            if (event.key === "Enter" && open && active >= 0 && suggestions[active]) {
              event.preventDefault(); select(suggestions[active]);
            }
          }}
        />
        {!focused && !value && <RotatingSearchHint key={hintItems.join("\u0000")} items={hintItems} />}
      </div>
      <p id="home-location-help" className="mt-2 text-xs leading-5 text-slate-600">Enter a city or province, or leave blank to see all vehicles.</p>
      {error && <p id="home-location-error" role="alert" className="mt-1 text-sm text-red-700">{error}</p>}
      {open && (
        <div className="absolute left-0 right-0 z-40 mt-2 rounded-xl bg-white p-2 shadow-lg ring-1 ring-slate-200">
          <p role="status" className="px-2 py-1 text-xs leading-5 text-slate-600">{status}</p>
          <ul id="home-location-options" role="listbox" aria-label="Locations with available vehicles" className="max-h-60 overflow-y-auto">
            {suggestions.map((entry, index) => (
              <li key={entry.location} id={`home-location-option-${index}`} role="option" aria-selected={active === index}
                onPointerDown={(event) => event.preventDefault()} onClick={() => select(entry)}
                className={`cursor-pointer rounded-lg px-3 py-3 text-sm text-slate-900 hover:bg-blue-50 ${active === index ? "bg-blue-50" : ""}`}>
                <span className="block break-words font-medium">{entry.location}</span>
                <span className="text-xs text-slate-600">{entry.vehicleCount} {entry.vehicleCount === 1 ? "vehicle" : "vehicles"} available</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
