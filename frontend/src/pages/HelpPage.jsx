import { useEffect, useRef } from "react";
import { ArrowRight, ChevronLeft } from "lucide-react";
import HelpGuide from "../components/HelpGuide";
import { getHelpGuide, getHelpGuidesForAudience } from "../data/helpContent";

const AUDIENCE_CONTENT = {
  renter: {
    title: "Help",
    label: "renter",
    summary: "Find a vehicle, verify your identity, request a booking, and follow payments.",
  },
  owner: {
    title: "Vehicle Owner Help & User Manual",
    label: "vehicle owner",
    summary: "Complete owner verification, list a vehicle, and manage booking requests.",
  },
};

export default function HelpPage({ guideSlug, audience, isOwner, isRenter, onSelectGuide, onReturn }) {
  const headingRef = useRef(null);
  const guide = guideSlug ? getHelpGuide(guideSlug) : null;
  const missingGuide = Boolean(guideSlug && !guide);
  const selectedAudience = guide?.audience || audience || (isOwner ? "owner" : isRenter ? "renter" : "");
  const audienceContent = AUDIENCE_CONTENT[selectedAudience];
  const backToAudienceChoice = Boolean(audienceContent && !guide && !isOwner && !isRenter);
  const needsSignIn = guide?.action.requires === "owner"
    ? !isOwner
    : guide?.action.requires === "renter" && !isRenter;
  const guideAction = (() => {
    if (!guide) return null;
    if (guide.slug === "owner-verification" && isOwner) {
      return { href: "/owner-dashboard?tab=Profile", label: "Open owner profile" };
    }
    if ((guide.slug === "owner-verification" || guide.action.requires === "owner") && isRenter) {
      return { href: "/account-settings", label: "Open Account Settings", ownerUpgrade: true };
    }
    return needsSignIn
      ? { href: "/signin", label: "Sign in to continue" }
      : guide.action;
  })();

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [guideSlug, selectedAudience]);

  const handleBack = () => {
    if (guide) onSelectGuide("", selectedAudience);
    else if (backToAudienceChoice) onSelectGuide("", "");
    else onReturn();
  };

  return (
    <div className="min-h-screen bg-[#f6f9fc] text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex min-h-20 max-w-3xl items-center gap-4 px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={handleBack}
            aria-label={guide ? `Back to ${audienceContent.label} guides` : backToAudienceChoice ? "Back to manual choices" : isOwner ? "Back to owner workspace" : "Back to RentifyPro"}
            className="rp-icon-button"
          >
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
          <span className="font-extrabold tracking-tight text-slate-900">Help</span>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 pb-16 pt-8 sm:px-6 sm:pt-12">
        {guide ? (
          <div className="mx-auto max-w-3xl">
            <HelpGuide guide={guide} titleRef={headingRef} />
            <section aria-labelledby="help-continue-title" className="mt-8 border-t border-slate-200 pt-6">
              <h2 id="help-continue-title" className="text-lg font-bold text-slate-900">Continue in RentifyPro</h2>
              {guideAction.ownerUpgrade && (
                <p className="mt-2 text-sm leading-6 text-slate-700">In Account Settings, choose <strong>Become a Vehicle Owner</strong> and follow the verification steps shown there.</p>
              )}
              <a
                href={guideAction.href}
                className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
              >
                {guideAction.label}
                <ArrowRight size={17} aria-hidden="true" />
              </a>
            </section>
          </div>
        ) : missingGuide ? (
          <div className="mx-auto max-w-2xl rounded-xl bg-white p-6 shadow-sm sm:p-8" role="alert">
            <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold text-slate-900">Guide not found</h1>
            <p className="mt-2 text-sm leading-6 text-slate-700">This guide may have moved. Choose a guide from the current manual.</p>
            <button type="button" onClick={() => onSelectGuide("", selectedAudience)} className="mt-5 min-h-11 text-sm font-bold text-blue-800 underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700">View current manual</button>
          </div>
        ) : audienceContent ? (
          <div className="mx-auto max-w-3xl">
            <h1 ref={headingRef} tabIndex={-1} className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">{audienceContent.title}</h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-slate-700">{audienceContent.summary}</p>
            <h2 className="mt-10 text-xl font-bold text-slate-900">Choose a guide</h2>
            <ul className="mt-4 divide-y divide-slate-200 border-y border-slate-200">
              {getHelpGuidesForAudience(selectedAudience).map((item) => (
                <li key={item.slug}>
                  <button
                    type="button"
                    onClick={() => onSelectGuide(item.slug)}
                    className="w-full rounded-lg px-4 py-5 text-left hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                  >
                    <span className="block text-base font-bold text-blue-900">{item.title}</span>
                    <span className="mt-1 block text-sm leading-6 text-slate-700">{item.summary}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl">
            <h1 ref={headingRef} tabIndex={-1} className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Help & User Manuals</h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-slate-700">Choose how you use RentifyPro to see the right instructions.</p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              {Object.entries(AUDIENCE_CONTENT).map(([key, content]) => (
                <button key={key} type="button" onClick={() => onSelectGuide("", key)} className="rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm hover:border-blue-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700">
                  <span className="block text-lg font-bold text-blue-900">{key === "renter" ? "I rent vehicles" : "I want to list a vehicle"}</span>
                  <span className="mt-2 block text-sm leading-6 text-slate-700">{content.summary}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
