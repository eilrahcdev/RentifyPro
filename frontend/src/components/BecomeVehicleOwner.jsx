import { useEffect, useRef, useState } from "react";
import API from "../utils/api";
import { fileToBase64, getMimeFromDataUrl, stripDataUrlPrefix, validateSupportingDocumentFile } from "../utils/cameraKyc";
import { getPreKycSessionToken, getPreKycStatus, preVerifySupportingDocument } from "../utils/kycApi";
import { BIR_SUPPORTING_DOCUMENT_TYPES, SUPPORTING_DOCUMENT_TYPES } from "../data/kycDocumentTypes";

const birTypes = new Set(BIR_SUPPORTING_DOCUMENT_TYPES);
const control = "min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:bg-gray-100";
const button = "min-h-11 rounded-lg border px-4 py-2 text-sm font-semibold hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60";
const labels = { queued: "Queued for checking", processing: "Checking document", retry_wait: "Check will retry automatically",
  pending_review: "Awaiting admin review", verified: "Approved", rejected: "Rejected", reupload_required: "Upload a corrected document", expired: "Review expired" };

function Field({ label, id, value, onChange, required = false, ...props }) {
  return <label htmlFor={id} className="space-y-1 text-sm font-medium text-gray-700">
    <span className="block">{label}{required ? " *" : ""}</span>
    <input id={id} value={value} onChange={(event) => onChange(event.target.value)} required={required} className={control} {...props} />
  </label>;
}

export default function BecomeVehicleOwner({ profile, onUpgraded, onOpenDashboard, onVerifyIdentity }) {
  const [form, setForm] = useState(() => ({ ownerType: profile.ownerType || "", businessName: profile.businessName || "",
    licenseNumber: profile.licenseNumber || "", permitNumber: profile.permitNumber || "" }));
  const [documentType, setDocumentType] = useState("");
  const [tin, setTin] = useState("");
  const [branchCode, setBranchCode] = useState("");
  const [selection, setSelection] = useState(null);
  const [selecting, setSelecting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [document, setDocument] = useState(null);
  const [revision, setRevision] = useState("");
  const [requiresUpload, setRequiresUpload] = useState(false);
  const [submittedProfile, setSubmittedProfile] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [error, setError] = useState("");
  const [previewError, setPreviewError] = useState(false);
  const fileInput = useRef(null);
  const selectionVersion = useRef(0);
  const isOwner = profile.role === "owner";
  const identityApproved = profile.isVerified && profile.kycStatus === "approved";
  const isBir = birTypes.has(documentType);
  const busy = selecting || uploading || submitting;
  const profileContext = { full_name: profile.name, first_name: profile.firstName || "", last_name: profile.lastName || "",
    business_name: form.businessName.trim(), permit_number: form.permitNumber.trim(),
    tax_identification_number: isBir ? tin : "", branch_code: isBir ? branchCode : "" };
  const fingerprint = JSON.stringify([documentType, form.ownerType, profileContext]);
  const detailsChanged = Boolean(submittedProfile && submittedProfile !== fingerprint);
  const validDetails = ["individual", "business"].includes(form.ownerType) && form.businessName.trim()
    && form.businessName.length <= 120 && form.licenseNumber.length <= 50 && form.permitNumber.length <= 50
    && SUPPORTING_DOCUMENT_TYPES.includes(documentType)
    && (isBir ? /^\d{9}$/.test(tin) && /^\d{3,5}$/.test(branchCode)
      : documentType === "Barangay Business Clearance" || Boolean(form.permitNumber.trim()));
  const ready = identityApproved && validDetails && document?.status === "verified" && document.documentRevision
    && document.selectedDocCategory === documentType && !detailsChanged && !requiresUpload && !statusError && !checkingStatus;

  useEffect(() => () => { selectionVersion.current++; }, []);
  useEffect(() => () => { if (selection?.url) URL.revokeObjectURL(selection.url); }, [selection]);

  useEffect(() => {
    if (isOwner || !identityApproved || !profile.email || requiresUpload) return;
    let active = true, timer;
    const read = async () => {
      setCheckingStatus(true);
      try {
        const result = await getPreKycStatus(profile.email, "owner");
        if (!active) return;
        let current = result.documents?.find((item) => item.docType === "supporting" && (!revision || item.documentRevision === revision)) || null;
        if (current && (!current.expiresAt || !Number.isFinite(new Date(current.expiresAt).getTime())
          || new Date(current.expiresAt).getTime() <= Date.now())) current = { ...current, status: "expired" };
        setDocument(current);
        setStatusError("");
        if (current && !revision) setDocumentType(current.selectedDocCategory || "");
        let delay = ["queued", "processing"].includes(current?.status) ? 1250
          : current?.status === "retry_wait" ? 15000 : current?.status === "pending_review" ? 45000 : 0;
        if (current?.expiresAt && current.status !== "expired") {
          const untilExpiry = new Date(current.expiresAt).getTime() - Date.now();
          if (untilExpiry > 0) delay = delay ? Math.min(delay, untilExpiry) : Math.min(untilExpiry, 2147483647);
        }
        if (delay) timer = window.setTimeout(read, Math.max(100, delay));
      } catch (failure) {
        if (!active) return;
        setDocument(null);
        setStatusError(failure.status === 401 || failure.status === 403
          ? "Your document-review session ended. Select your document and submit it again."
          : "We couldn't refresh your document status. Try again before upgrading.");
      } finally {
        if (active) setCheckingStatus(false);
      }
    };
    void read();
    return () => { active = false; window.clearTimeout(timer); };
  }, [profile.email, identityApproved, isOwner, revision, refresh, requiresUpload]);

  const invalidateDocument = () => {
    setDocument(null); setRevision(""); setRequiresUpload(true); setSubmittedProfile(""); setStatusError(""); setError("");
  };
  const selectFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const version = ++selectionVersion.current;
    setSelecting(true);
    invalidateDocument();
    try {
      await validateSupportingDocumentFile(file);
      if (version !== selectionVersion.current) return;
      setSelection({ file, url: URL.createObjectURL(file) });
      setPreviewError(false);
    } catch (failure) {
      if (version !== selectionVersion.current) return;
      setSelection(null); setError(failure.message || "Choose a valid JPG, PNG, or PDF document.");
    } finally {
      if (version === selectionVersion.current) { setSelecting(false); if (fileInput.current) fileInput.current.value = ""; }
    }
  };
  const submitDocument = async () => {
    if (busy || !selection || !validDetails || !identityApproved) return;
    setUploading(true); setError("");
    try {
      const dataUrl = await fileToBase64(selection.file);
      const result = await preVerifySupportingDocument(profile.email, stripDataUrlPrefix(dataUrl), getMimeFromDataUrl(dataUrl), "owner",
        { documentType, userProfile: profileContext });
      if (!result.documentRevision) throw new Error("We couldn't confirm the upload. Try submitting your document again.");
      setSubmittedProfile(fingerprint); setRevision(result.documentRevision); setRequiresUpload(false);
      setRefresh((value) => value + 1);
    } catch (failure) { setError(failure.message || "Document upload failed. Try again."); }
    finally { setUploading(false); }
  };
  const upgrade = async () => {
    if (!ready || busy) return;
    setSubmitting(true); setError("");
    try {
      const preKycToken = await getPreKycSessionToken(profile.email, "owner");
      const result = await API.upgradeToOwner({ ...form, preKycToken, supportingDocType: documentType,
        supportingDocRevision: document.documentRevision, taxIdentificationNumber: isBir ? tin : "", branchCode: isBir ? branchCode : "" });
      if (!result.user || result.user.role !== "owner") throw new Error("We couldn't confirm the upgrade. Refresh Account Settings before trying again.");
      setSelection(null); onUpgraded(result.user);
    } catch (failure) {
      setError(failure.message || "Account upgrade failed. Try again.");
      if (failure.details?.code === "SUPPORTING_DETAILS_CHANGED") setRequiresUpload(true);
      else setRefresh((value) => value + 1);
    } finally { setSubmitting(false); }
  };

  if (isOwner) return <div className="rp-settings-card space-y-4 p-6">
    <h3 className="text-lg font-semibold">You are a vehicle owner</h3>
    <p className="text-sm text-gray-600">Your account is ready. Open your owner dashboard to list vehicles and manage rentals.</p>
    <button type="button" onClick={onOpenDashboard} className={`${button} border-transparent bg-[#017FE6] text-white hover:bg-[#0165B8]`}>Open owner dashboard</button>
  </div>;

  return <div className="space-y-6" data-owner-upgrade>
    <div className="rp-settings-card space-y-4 p-6">
      <h3 className="text-lg font-semibold">Become a Vehicle Owner</h3>
      <p className="text-sm text-gray-600">Enter your owner details, preview your business document, and submit it for review. Upgrade after your document is approved.</p>
      <dl className="grid gap-2 text-sm">
        <div className="flex flex-wrap justify-between gap-2"><dt>Email verification</dt><dd>{profile.isVerified ? "Verified" : "Required"}</dd></div>
        <div className="flex flex-wrap justify-between gap-2"><dt>Identity verification</dt><dd className={identityApproved ? "font-medium text-green-700" : "text-amber-800"}>{identityApproved ? "Verified" : "Required"}</dd></div>
      </dl>
      {!identityApproved && <div className="space-y-2"><p className="text-sm text-gray-600">Verify your identity before submitting an owner document.</p>
        <button type="button" onClick={onVerifyIdentity} className={button}>Open identity verification</button></div>}
    </div>
    <div className="rp-settings-card space-y-4 p-6">
      <h4 className="text-lg font-semibold">Owner Details</h4>
      <p className="text-sm text-gray-600">Use the details shown on your business document. Fields marked * are required.</p>
      <fieldset disabled={busy || !identityApproved} className="grid min-w-0 gap-4 md:grid-cols-2">
        <label htmlFor="upgrade-owner-type" className="space-y-1 text-sm font-medium text-gray-700"><span className="block">Owner type *</span>
          <select id="upgrade-owner-type" value={form.ownerType} onChange={(event) => setForm((value) => ({ ...value, ownerType: event.target.value }))} className={control}>
            <option value="">Select owner type</option><option value="individual">Individual</option><option value="business">Business</option>
          </select></label>
        <Field id="upgrade-business-name" label="Business or trade name" required value={form.businessName} maxLength={120} onChange={(businessName) => setForm((value) => ({ ...value, businessName }))} />
        <Field id="upgrade-license" label="Business license number (optional)" value={form.licenseNumber} maxLength={50} onChange={(licenseNumber) => setForm((value) => ({ ...value, licenseNumber }))} />
      </fieldset>
    </div>
    <div className="rp-settings-card space-y-4 p-6">
      <h4 className="text-lg font-semibold">Supporting Document</h4>
      <p id="upgrade-upload-help" className="text-sm text-gray-600">Choose one Philippine business document: JPG, PNG, or PDF, up to 4 MB.</p>
      <fieldset disabled={busy || !identityApproved} className="min-w-0 space-y-4">
        <label htmlFor="upgrade-document-type" className="block space-y-1 text-sm font-medium text-gray-700"><span className="block">Document type *</span>
          <select id="upgrade-document-type" value={documentType} onChange={(event) => {
            setDocumentType(event.target.value); setTin(""); setBranchCode(""); setForm((value) => ({ ...value, permitNumber: "" })); invalidateDocument();
          }} className={control}><option value="">Select document type</option>{SUPPORTING_DOCUMENT_TYPES.map((type) => <option key={type}>{type}</option>)}</select>
        </label>
        {isBir ? <div className="grid gap-4 md:grid-cols-2">
          <Field id="upgrade-tin" label="TIN (9 digits)" required value={tin} inputMode="numeric" autoComplete="off" maxLength={9} onChange={(value) => setTin(value.replace(/\D/g, "").slice(0, 9))} />
          <Field id="upgrade-branch" label="Branch code (3 to 5 digits)" required value={branchCode} inputMode="numeric" autoComplete="off" maxLength={5} onChange={(value) => setBranchCode(value.replace(/\D/g, "").slice(0, 5))} />
        </div> : <Field id="upgrade-permit" label="Permit or registration number" required={documentType !== "Barangay Business Clearance"} value={form.permitNumber} maxLength={50} onChange={(permitNumber) => setForm((value) => ({ ...value, permitNumber }))} />}
        <input ref={fileInput} id="upgrade-document-file" type="file" className="sr-only" tabIndex={-1} accept="image/jpeg,image/png,application/pdf" onChange={selectFile} aria-label="Supporting document file" aria-describedby="upgrade-upload-help" />
        <div className="flex flex-wrap gap-3"><button type="button" className={button} onClick={() => fileInput.current?.click()}>{selecting ? "Checking file..." : selection ? "Replace document" : "Choose document"}</button>
          {selection && <button type="button" className={button} onClick={() => { selectionVersion.current++; setSelection(null); invalidateDocument(); }}>Remove document</button>}</div>
      </fieldset>
      {selection && <div className="min-w-0 space-y-3" data-document-preview>
        <p className="break-words text-sm font-medium text-gray-700">{selection.file.name} <span className="font-normal">({(selection.file.size / 1024).toFixed(1)} KB)</span></p>
        {selection.file.type === "application/pdf"
          ? <iframe src={selection.url} title={`Preview of ${selection.file.name}`} className="h-80 w-full rounded-lg border bg-white" />
          : previewError ? <p className="text-sm text-amber-800">The image preview could not load. Open the document to check it.</p>
            : <img src={selection.url} alt={`Preview of ${selection.file.name}`} className="max-h-80 w-full rounded-lg border bg-gray-50 object-contain" onError={() => setPreviewError(true)} />}
        <a href={selection.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sm font-semibold text-blue-700 underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-blue-500">{selection.file.type === "application/pdf" ? "Open PDF" : "Open document"}</a>
      </div>}
      <button type="button" onClick={submitDocument} disabled={busy || !selection || !validDetails || !identityApproved} className={button}>{uploading ? "Uploading document..." : "Submit document for review"}</button>
      <div className="space-y-2 text-sm" aria-live="polite" aria-atomic="true">
        <p className={document?.status === "verified" && !detailsChanged && !requiresUpload ? "font-medium text-green-700" : "text-gray-700"}>
          {requiresUpload ? "Submit the selected document with your current details for review." : detailsChanged ? "Your details changed. Submit your document for review again."
            : checkingStatus && !document ? "Checking document status..." : `Document status: ${labels[document?.status] || "Not submitted"}`}
        </p>
        {["rejected", "reupload_required"].includes(document?.status) && <p className="text-red-700">{document.reason || "Upload a corrected document and submit it again."}</p>}
        {document?.status === "expired" && <p>Upload the document again to start a new review.</p>}
        {statusError && <p role="alert" className="text-red-700">{statusError}</p>}
      </div>
      <button type="button" className={button} onClick={() => setRefresh((value) => value + 1)} disabled={busy || checkingStatus || requiresUpload || !identityApproved}>{checkingStatus ? "Refreshing status..." : "Refresh document status"}</button>
    </div>
    <div className="space-y-3">
      {error && <p role="alert" className="break-words text-sm text-red-700">{error}</p>}
      <button type="button" onClick={upgrade} disabled={!ready || busy} className={`${button} border-transparent bg-[#017FE6] text-white hover:bg-[#0165B8]`}>{submitting ? "Upgrading account..." : "Upgrade to Owner"}</button>
      {!ready && <p className="text-sm text-gray-600">Complete your details and wait for an approved supporting document before upgrading.</p>}
    </div>
  </div>;
}
