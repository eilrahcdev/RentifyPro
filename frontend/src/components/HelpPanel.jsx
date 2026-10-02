import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronLeft, X } from "lucide-react";
import HelpGuide from "./HelpGuide";
import { getHelpGuide, getHelpGuidesForAudience } from "../data/helpContent";

export default function HelpPanel({ guideSlug, audience, onClose, onAskAI }) {
  const panelRef = useRef(null);
  const closeRef = useRef(null);
  const titleRef = useRef(null);
  const guideTitleRef = useRef(null);
  const contentRef = useRef(null);
  const [selectedGuideSlug, setSelectedGuideSlug] = useState(guideSlug || "");
  const [chosenAudience, setChosenAudience] = useState(() => getHelpGuide(guideSlug)?.audience || "");
  const requestedGuide = getHelpGuide(selectedGuideSlug);
  const guide = audience && requestedGuide?.audience !== audience ? null : requestedGuide;
  const selectedAudience = audience || guide?.audience || chosenAudience;
  const chooseAudience = (nextAudience) => {
    setChosenAudience(nextAudience);
    window.requestAnimationFrame(() => titleRef.current?.focus({ preventScroll: true }));
  };

  const selectGuide = (nextGuide) => {
    setSelectedGuideSlug(nextGuide.slug);
    setChosenAudience(nextGuide.audience);
    contentRef.current?.scrollTo(0, 0);
    window.requestAnimationFrame(() => guideTitleRef.current?.focus({ preventScroll: true }));
  };

  const returnToTasks = () => {
    setSelectedGuideSlug("");
    contentRef.current?.scrollTo(0, 0);
    window.requestAnimationFrame(() => titleRef.current?.focus({ preventScroll: true }));
  };

  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = [...panelRef.current.querySelectorAll('button:not([disabled]), a[href]')];
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === titleRef.current)) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[110]">
      <button
        type="button"
        aria-label="Close Help"
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/45"
      />
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-panel-title"
        className="absolute left-3 right-3 top-3 flex max-h-[calc(100dvh-1.5rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl sm:left-auto sm:w-full sm:max-w-[460px]"
      >
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-slate-50/70 px-5 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            {guide && (
              <button
                type="button"
                onClick={returnToTasks}
                aria-label="Back to Help tasks"
                className="rp-icon-button"
              >
                <ChevronLeft size={20} aria-hidden="true" />
              </button>
            )}
            <h2 ref={titleRef} id="help-panel-title" tabIndex={-1} className="text-lg font-bold text-slate-900">Help</h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close Help panel"
            className="rp-icon-button"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <div ref={contentRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-6 pb-8 sm:px-6">
          {guide ? (
            <HelpGuide guide={guide} compact titleRef={guideTitleRef} />
          ) : selectedAudience ? (
            <>
              {!audience && (
                <button type="button" onClick={() => chooseAudience("")} className="mb-5 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-blue-800 underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"><ArrowLeft size={17} aria-hidden="true" />Choose another manual</button>
              )}
              <p className="text-sm leading-6 text-slate-700">Choose a task for step-by-step instructions.</p>
              <ul className="mt-5 divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200">
                {getHelpGuidesForAudience(selectedAudience).map((item) => (
                  <li key={item.slug}>
                    <button
                      type="button"
                      onClick={() => selectGuide(item)}
                      className="min-h-12 w-full px-4 py-4 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-700"
                    >
                      <span className="block text-sm font-bold text-blue-900">{item.title}</span>
                      <span className="mt-1 block text-sm leading-6 text-slate-700">{item.summary}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <p className="text-sm leading-6 text-slate-700">Choose how you use RentifyPro to see the right help.</p>
              <div className="mt-5 space-y-3">
                <button type="button" onClick={() => chooseAudience("renter")} className="w-full rounded-xl border border-slate-200 px-4 py-4 text-left hover:border-blue-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"><span className="block font-bold text-blue-900">I rent vehicles</span><span className="mt-1 block text-sm leading-6 text-slate-700">Booking, identity checks, and payments</span></button>
                <button type="button" onClick={() => chooseAudience("owner")} className="w-full rounded-xl border border-slate-200 px-4 py-4 text-left hover:border-blue-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"><span className="block font-bold text-blue-900">I want to list a vehicle</span><span className="mt-1 block text-sm leading-6 text-slate-700">Owner verification, listings, and requests</span></button>
              </div>
            </>
          )}
          {onAskAI && (
            <div className="mt-6 border-t border-slate-200 pt-5">
              <button
                type="button"
                onClick={onAskAI}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-800 transition-colors hover:border-blue-300 hover:bg-blue-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
              >
                Ask Rentify AI
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
