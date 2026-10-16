import { useEffect, useMemo, useState } from "react";
import { adminDataApi } from "../adminDataApi";

const fieldLabels = {
  full_name: "Applicant name", date_of_birth: "Date of birth",
  business_name: "Registered business name", permit_number: "Permit / registration number",
  tax_identification_number: "TIN", branch_code: "Branch code",
};

export default function ManualDocumentComparison({ document, onInspectionChange }) {
  const [context, setContext] = useState(null);
  const [checks, setChecks] = useState({});
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    adminDataApi.getDocumentComparison(document.id).then((result) => {
      if (!active) return;
      if (result.reviewVersion !== document.reviewVersion || result.fileHash !== document.fileHash) {
        throw new Error("The document changed. Close this review and refresh the document list.");
      }
      setContext(result);
    }).catch((failure) => { if (active) setError(failure.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [document.id, document.reviewVersion, document.fileHash, attempt]);

  useEffect(() => {
    const state = context?.identifierScreening?.state;
    if (error || !["pending", "processing", "retry_wait", "unavailable"].includes(state)) return undefined;
    let active = true;
    const delay = ["retry_wait", "unavailable"].includes(state) ? 30_000 : 5000;
    const timer = window.setTimeout(() => {
      adminDataApi.getDocumentIdentifierScreening(document.id).then(result => {
        if (!active) return;
        if (result.fileHash !== document.fileHash || result.reviewVersion !== document.reviewVersion) {
          throw new Error("The document changed. Close this review and refresh the document list.");
        }
        if (result.identifierScreening?.reviewRevision !== context.identifierScreening?.reviewRevision
          || result.identifierScreening?.maskedIdentifier !== context.identifierScreening?.maskedIdentifier) setChecks({});
        setContext(current => ({ ...current, ...result }));
      }).catch(failure => { if (active) setError(failure.message); });
    }, delay);
    return () => { active = false; window.clearTimeout(timer); };
  }, [context, error, document.id, document.fileHash, document.reviewVersion]);

  const isId = document.docType === "id";
  const confirmations = [
    ["documentInspected", `I inspected the readable original ${document.selectedDocCategory || document.document} from the Philippines.`,
      `Its ${isId ? "physical ID" : "physical or official digital document"} layout, markings${isId ? ", portrait" : ""}${document.selectedDocCategory === "Philippine Passport" ? ", and machine-readable zone" : ""} are visible, including the required identifier. There is no visible alteration.`],
    ["registrationDetailsMatch", "The registration details above match the original exactly.",
      isId ? "Compare the applicant's name, birth date, and any masked identifier shown above." : "Compare the registered name and any permit number, TIN, and branch code shown above."],
    ["currentlyValid", "The document is currently valid.", "Check any printed issue and expiry dates. Reject expired documents or ask for a clearer upload when validity is uncertain."],
  ];
  const screening = context?.identifierScreening;
  const ready = Boolean(context && !loading && !error && screening?.state !== "processing" && confirmations.every(([key]) => checks[key] === true));
  const inspection = useMemo(() => ready ? { reviewMode: "visual", documentId: document.id,
    documentType: document.selectedDocCategory, fileHash: context.fileHash, reviewVersion: context.reviewVersion,
    identifierScreeningRevision: context.identifierScreening?.reviewRevision, confirmations: checks } : null,
    [ready, document.id, document.selectedDocCategory, context, checks]);
  useEffect(() => { onInspectionChange(inspection); }, [inspection, onInspectionChange]);
  const profile = context?.profile || {};
  const name = profile.full_name || [profile.first_name, profile.last_name].filter(Boolean).join(" ");
  const details = { ...(name ? { full_name: name } : {}), ...Object.fromEntries(Object.entries(profile)
    .filter(([key]) => !["first_name", "last_name", "full_name"].includes(key))) };
  return (
    <section aria-labelledby="manual-comparison-title" className="mt-5 border-t border-slate-200 pt-5">
      <h4 id="manual-comparison-title" className="text-base font-bold text-slate-950">Inspect and compare</h4>
      <p className="mt-2 text-sm leading-6 text-slate-700">Compare the saved details with the original. Confirm the checks to enable approval.</p>
      {loading ? <p role="status" className="mt-3 text-sm text-slate-700">Loading registration details…</p> : null}
      {error ? <div role="alert" className="mt-3 text-sm text-rose-700"><p>{error}</p><button type="button" onClick={() => { setLoading(true); setError(""); setAttempt((value) => value + 1); }} className="mt-2 h-11 rounded-lg border border-slate-300 px-3 font-semibold text-slate-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100">Retry loading</button></div> : null}
      {context && !loading && !error ? <>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          {Object.entries(details).filter(([, value]) => value).map(([key, value]) => <div key={key} className="min-w-0"><dt className="font-semibold text-slate-700">{fieldLabels[key] || key.replaceAll("_", " ")}</dt><dd className="break-words text-slate-950">{value}</dd></div>)}
        </dl>
        {screening ? <p role={["pending", "processing", "retry_wait"].includes(screening.state) ? "status" : undefined} className="mt-3 text-sm leading-6 text-slate-700">Identifier screening: {({ pending: "queued in the background", processing: "reading the current original; approval will be available when this finishes", retry_wait: "temporarily unavailable; a retry is scheduled", uncertain: "the ID number could not be read confidently", unavailable: "unavailable after retries; another attempt is scheduled", disabled: "private OCR is not enabled", complete: "identifier available for duplicate checks" })[screening.state] || "unavailable"}.{screening.maskedIdentifier ? <span className="block font-semibold">ID number: {screening.maskedIdentifier} — compare the final four characters with the original.</span> : null}</p> : null}
        {context.identifierDuplicateCheck === "file_hash_only" ? <p className="mt-3 text-sm leading-6 text-amber-800">No extracted identifier is available. Duplicate screening can check identical uploads, but cannot compare the ID number across different photos.</p> : null}
        <fieldset className="mt-4 space-y-2"><legend className="mb-2 text-sm font-semibold text-slate-950">Confirm your inspection</legend>
          {confirmations.map(([key, label, help]) => <label key={key} className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm leading-6 text-slate-700"><input type="checkbox" checked={checks[key] === true} onChange={(event) => setChecks((current) => ({ ...current, [key]: event.target.checked }))} className="mt-1 h-4 w-4 shrink-0 accent-blue-600 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100" /><span><span className="block font-semibold">{label}</span><span className="block">{help}</span></span></label>)}
        </fieldset>
      </> : null}
    </section>
  );
}
