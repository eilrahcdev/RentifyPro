import { useEffect, useMemo, useState } from "react";

const splitCharacters = (value) => {
  if (typeof Intl.Segmenter === "function") {
    return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)]
      .map(({ segment }) => segment);
  }
  return Array.from(value);
};

export default function RotatingSearchHint({ items, prefix = "" }) {
  const itemsKey = items.join("\u0000");
  const characters = useMemo(() => itemsKey ? itemsKey.split("\u0000").map(splitCharacters) : [], [itemsKey]);
  const [step, setStep] = useState(() => ({ index: 0, count: characters[0]?.length || 0, phase: "hold" }));
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setReduceMotion(preference.matches);
    updatePreference();
    preference.addEventListener("change", updatePreference);
    return () => preference.removeEventListener("change", updatePreference);
  }, []);

  useEffect(() => {
    if (reduceMotion || items.length < 2) return undefined;
    const delay = step.phase === "hold" ? 3600 : step.phase === "delete" ? 70 : 90;
    const timer = window.setTimeout(() => {
      setStep((current) => {
        if (current.phase === "hold") return { ...current, phase: "delete" };
        if (current.phase === "delete") {
          if (current.count > 1) return { ...current, count: current.count - 1 };
          return { index: (current.index + 1) % items.length, count: 0, phase: "type" };
        }
        const nextCount = current.count + 1;
        const nextLength = characters[current.index]?.length || 0;
        return { ...current, count: nextCount, phase: nextCount >= nextLength ? "hold" : "type" };
      });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [reduceMotion, items.length, itemsKey, characters, step]);

  if (!items.length) return null;
  const animated = !reduceMotion && items.length > 1;
  const text = animated
    ? (characters[step.index] || characters[0]).slice(0, step.count).join("")
    : items[0];
  return <span aria-hidden="true" className="rp-search-hint" data-phase={animated ? step.phase : "static"}>{prefix && <span className="rp-search-hint__prefix">{prefix}</span>}{text}</span>;
}
