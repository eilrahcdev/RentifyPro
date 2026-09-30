import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import API from "../utils/api";
import RotatingSearchHint from "./RotatingSearchHint";

export default function VehicleSearchInput({ value, onChange, onSelectVehicle, location, vehicleType, error, maxLength }) {
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(-1);
  const [result, setResult] = useState(null);
  const inputRef = useRef(null);
  const search = value.trim();
  const queryKey = `${search}\u0000${location}\u0000${vehicleType}`;
  const resultKey = result?.key;
  const suggestions = resultKey === queryKey ? result.suggestions : [];
  const open = focused && !error;
  const shouldFetch = !error && (focused || !search);
  const status = resultKey === queryKey ? result.status : "Finding vehicle suggestions…";
  const hintItems = !search && resultKey === queryKey
    ? suggestions.map((entry) => entry.name)
    : [];

  useEffect(() => {
    if (!shouldFetch || resultKey === queryKey) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await API.getVehicleSearchSuggestions({ search, location, vehicleType }, controller.signal);
        if (controller.signal.aborted) return;
        const next = (response.suggestions || []).slice(0, 3);
        setActive(-1);
        setResult({ key: queryKey, suggestions: next, status: next.length
          ? search ? "Matching vehicles. Select one to preview." : "Suggested vehicles. Select one to preview."
          : search ? "No matching vehicle names. Your search still runs below." : "No vehicles to suggest right now." });
      } catch {
        if (!controller.signal.aborted) setResult({ key: queryKey, suggestions: [], status: "Suggestions are unavailable. You can still search." });
      }
    }, search ? 250 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [shouldFetch, resultKey, queryKey, search, location, vehicleType]);

  const choose = async (entry) => {
    inputRef.current?.blur();
    setFocused(false);
    setActive(-1);
    const message = await onSelectVehicle(entry);
    if (message) {
      setResult((current) => current?.key === queryKey ? { ...current, status: message } : current);
      inputRef.current?.focus();
      setFocused(true);
    }
  };

  return (
    <div className="rp-vehicle-search">
      <label htmlFor="vehicle-market-search">Search vehicles</label>
      <div className="rp-vehicle-search__control" data-hint-active={!focused && !value && hintItems.length > 0}>
        <Search size={20} strokeWidth={2} aria-hidden="true" />
        <input
          ref={inputRef}
          id="vehicle-market-search"
          type="search"
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? "vehicle-search-options" : undefined}
          aria-activedescendant={open && suggestions[active] ? `vehicle-search-option-${active}` : undefined}
          aria-invalid={Boolean(error)}
          aria-describedby="vehicle-search-help"
          placeholder="Search by vehicle name"
          maxLength={maxLength}
          value={value}
          onFocus={() => { setFocused(true); setActive(-1); }}
          onClick={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(event) => { onChange(event.target.value); setResult(null); setActive(-1); setFocused(true); }}
          onKeyDown={(event) => {
            if (event.key === "Escape") { event.preventDefault(); setFocused(false); }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault(); setFocused(true);
              if (suggestions.length) setActive((previous) => previous < 0
                ? (event.key === "ArrowDown" ? 0 : suggestions.length - 1)
                : (previous + (event.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length);
            }
            if (event.key === "Enter" && open && active >= 0 && suggestions[active]) {
              event.preventDefault(); void choose(suggestions[active]);
            }
          }}
        />
        {!focused && !value && <RotatingSearchHint key={hintItems.join("\u0000")} items={hintItems} />}
      </div>
      <span id="vehicle-search-help" className={error ? "is-error" : ""} role={error ? "alert" : undefined}>
        {error || "Search by name, type, or vehicle details."}
      </span>
      {open && (
        <div className="rp-vehicle-search__options">
          <p role="status">{status}</p>
          <ul id="vehicle-search-options" role="listbox" aria-label="Vehicle search suggestions">
            {suggestions.map((entry, index) => (
              <li
                key={entry.id}
                id={`vehicle-search-option-${index}`}
                role="option"
                aria-selected={active === index}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => { void choose(entry); }}
                onMouseEnter={() => setActive(index)}
                className={active === index ? "is-active" : ""}
              >
                <span className="rp-vehicle-search__name">{entry.name}</span>
                <span className="rp-vehicle-search__meta">
                  <span>{entry.location}</span>
                  {Number.isFinite(Number(entry.hourlyRate)) && <span>₱{Number(entry.hourlyRate).toLocaleString("en-PH")}/hour</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
