// KYC stepper after login
// Uses the authenticated /api/kyc/* routes

import { useState } from "react";
import { Check, CircleCheck, CircleX, IdCard } from "lucide-react";
import API from "../utils/api";
import { ID_DOCUMENT_TYPES } from "../data/kycDocumentTypes";
import { fileToBase64, validateDocumentImageFile } from "../utils/cameraKyc";
import SelfieCapture from "../components/SelfieCapture";

const STEPS = [
  { id: 1, label: "Upload ID" },
  { id: 2, label: "Take Selfie" },
  { id: 3, label: "Result" },
];

function verificationErrorMessage(error) {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("face") && message.includes("match")) {
    return "We couldn't match this selfie to your ID photo. Try again in even lighting and face the camera directly.";
  }
  if (message.includes("no face") || message.includes("face detection")) {
    return "We couldn't find a clear face. Keep your full face visible and make sure only you are in the frame.";
  }
  if (message.includes("network") || message.includes("fetch") || message.includes("econn")) {
    return "We couldn't connect to the verification service. Check your connection and try again.";
  }
  if (message.includes("timeout") || message.includes("timed out")) {
    return "Verification took too long. Please try again with a new selfie.";
  }
  return "We couldn't complete verification right now. Please try again.";
}

export default function VerificationStepper({ onVerificationComplete }) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // ID state
  const [idPreview, setIdPreview] = useState(null);
  const [idBase64, setIdBase64] = useState("");
  const [idType, setIdType] = useState("");

  // Selfie state
  const [selfieBase64, setSelfieBase64] = useState("");
  const [selfiePreview, setSelfiePreview] = useState(null);
  const [result, setResult] = useState(null);

  // Step 1: upload ID
  const handleIdUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      await validateDocumentImageFile(file);
    } catch (validationError) {
      setError(validationError.message || "Please upload a clear ID image.");
      e.target.value = "";
      return;
    }
    const b64 = await fileToBase64(file);
    setIdPreview(b64);
    setIdBase64(b64);
  };

  const submitId = async () => {
    if (!idType) { setError("Select your ID type first."); return; }
    if (!idBase64) { setError("Upload your ID card first."); return; }
    setLoading(true);
    setError("");
    try {
      const mimeMatch = idBase64.match(/^data:([^;,]+)[;,]/i);
      const data = await API.kycRegisterFace({
        id_image_base64: idBase64,
        id_image_mime: mimeMatch?.[1] || "image/jpeg",
        id_type: idType,
      });
      if (!data.success) { setError(data.message); return; }
      setStep(2);
    } catch (err) {
      setError(err.message || "ID registration failed.");
    } finally {
      setLoading(false);
    }
  };

  // Step 2: the shared capture component owns the camera lifecycle.
  const handleSelfieCapture = ({ dataUrl }) => {
    setSelfieBase64(dataUrl);
    setSelfiePreview(dataUrl);
    setError("");
  };

  const retakeSelfie = () => {
    setSelfieBase64("");
    setSelfiePreview(null);
    setError("");
  };

  const submitSelfie = async () => {
    if (!selfieBase64) { setError("Take your selfie first."); return; }
    setLoading(true);
    setError("");
    try {
      const data = await API.kycVerifySelfie({
        selfie_image_base64: selfieBase64,
      });
      setResult(data);
      setStep(3);
      if (data?.verified) {
        await onVerificationComplete?.(data);
      }
    } catch (err) {
      setError(verificationErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const retrySelfie = () => {
    retakeSelfie();
    setResult(null);
    setStep(2);
  };

  return (
    <div className="max-w-lg mx-auto p-6 bg-white rounded-3xl border border-gray-200 shadow-2xl">
      {/* step indicator */}
      <div className="flex items-center justify-between mb-6">
        {STEPS.map((s, i) => (
          <div key={s.id} className="flex items-center gap-1">
            <div
              className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                step > s.id
                  ? "bg-green-500 text-white"
                  : step === s.id
                  ? "bg-[#017FE6] text-white ring-4 ring-blue-100"
                  : "bg-gray-100 text-gray-400"
              }`}
            >
              {step > s.id ? <Check size={16} strokeWidth={2} aria-hidden="true" /> : s.id}
            </div>
            <span
              className={`text-xs hidden sm:block ${
                step === s.id ? "text-[#017FE6] font-semibold" : "text-gray-400"
              }`}
            >
              {s.label}
            </span>
            {i < STEPS.length - 1 && (
              <div
                className={`w-8 h-1 rounded-full mx-1 ${
                  step > s.id ? "bg-[#017FE6]" : "bg-gray-100"
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* error */}
      {error && step !== 2 && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-2xl text-red-600 text-sm">
          {error}
        </div>
      )}

      {/* step 1 */}
      {step === 1 && (
        <div>
          <h2 className="text-xl font-bold text-gray-900 mb-1">Upload Your ID Card</h2>
          <p className="text-gray-500 text-sm mb-4">
            Clear photo of the front of your government ID.
          </p>
          <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor="kyc-id-type">
            ID type
          </label>
          <select
            id="kyc-id-type"
            value={idType}
            onChange={(event) => setIdType(event.target.value)}
            className="w-full mb-4 rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-[#017FE6] focus:outline-none"
          >
            <option value="">Select the uploaded ID type</option>
            {ID_DOCUMENT_TYPES.map((entry) => (
              <option key={entry} value={entry}>{entry}</option>
            ))}
          </select>
          <label className="block w-full border-2 border-dashed border-gray-300 rounded-2xl p-6 text-center cursor-pointer hover:border-[#017FE6] transition">
            {idPreview ? (
              <img src={idPreview} alt="ID" className="max-h-48 mx-auto rounded-xl object-contain" />
            ) : (
              <div className="text-gray-400">
                <IdCard size={36} className="mx-auto mb-2" aria-hidden="true" />
                <p className="text-sm">Click to upload</p>
                <p className="text-xs text-gray-400">JPG, PNG — max 4MB</p>
              </div>
            )}
            <input type="file" accept="image/jpeg,image/png" className="hidden" onChange={handleIdUpload} />
          </label>
          <button
            onClick={submitId}
            disabled={!idType || !idBase64 || loading}
            className="mt-4 w-full py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-[#017FE6] to-[#0165B8] hover:opacity-95 transition disabled:opacity-50"
          >
            {loading ? "Uploading securely..." : "Upload ID & Continue"}
          </button>
        </div>
      )}

      {/* step 2 */}
      {step === 2 && (
        <SelfieCapture
          previewUrl={selfiePreview || ""}
          disabled={loading}
          submitting={loading}
          error={error}
          onCapture={handleSelfieCapture}
          onRetake={retakeSelfie}
          onSubmit={submitSelfie}
        />
      )}

      {/* step 3 */}
      {step === 3 && result && (
        <div className="text-center py-4">
          <div className={`text-5xl mb-4 ${result.verified ? "text-green-500" : "text-red-500"}`}>
            {result.verified ? <CircleCheck size={48} strokeWidth={2} className="mx-auto" aria-hidden="true" /> : <CircleX size={48} strokeWidth={2} className="mx-auto" aria-hidden="true" />}
          </div>
          <h2 className={`text-2xl font-bold mb-2 ${result.verified ? "text-green-700" : "text-red-700"}`}>
            {result.verified ? result.kycStatus === "approved" ? "Identity verified" : "Selfie matched" : "Selfie needs another try"}
          </h2>
          <p className="mb-4 text-sm leading-6 text-gray-600">
            {result.verified
              ? result.kycStatus === "approved"
                ? "Your selfie matched your ID photo and your identity verification is complete."
                : "Your selfie matched your ID photo. Your document is still being reviewed."
              : result.message || "We couldn't verify this selfie. Keep your face visible and try again."}
          </p>
          {result.verified && result.kycStatus !== "approved" && <p role="status" className="mb-4 text-sm leading-6 text-amber-800">Use Refresh status in your account settings to check document approval before booking.</p>}

          {!result.verified && (
            <button onClick={retrySelfie} className="rp-btn-primary w-full px-4 py-3">
              Try another selfie
            </button>
          )}
        </div>
      )}
    </div>
  );
}
