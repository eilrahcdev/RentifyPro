// KYC stepper after login
// Uses the authenticated /api/kyc/* routes

import { useState, useRef, useCallback } from "react";
import API from "../utils/api";

const STEPS = [
  { id: 1, label: "Upload ID" },
  { id: 2, label: "Blink Check" },
  { id: 3, label: "Take Selfie" },
  { id: 4, label: "Result" },
];

// Convert a file to base64
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Capture a JPEG frame from a canvas
function canvasToBase64(canvas) {
  return canvas.toDataURL("image/jpeg", 0.85);
}

export default function VerificationStepper() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // ID state
  const [idPreview, setIdPreview] = useState(null);
  const [idBase64, setIdBase64] = useState("");

  // Blink check state
  const [challengeId, setChallengeId] = useState("");
  const [blinkStatus, setBlinkStatus] = useState("idle"); // idle, recording, done
  const [frameCount, setFrameCount] = useState(0);
  const framesRef = useRef([]);

  // Selfie state
  const [selfieBase64, setSelfieBase64] = useState("");
  const [selfiePreview, setSelfiePreview] = useState(null);
  const [result, setResult] = useState(null);

  // Camera refs
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const intervalRef = useRef(null);

  // Start the camera
  const openCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch {
      setError("Camera access denied. Please allow camera and try again.");
    }
  };

  // Stop the camera
  const closeCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    clearInterval(intervalRef.current);
  }, []);

  // Step 1: upload ID
  const handleIdUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    const b64 = await fileToBase64(file);
    setIdPreview(b64);
    setIdBase64(b64);
  };

  const submitId = async () => {
    if (!idBase64) { setError("Upload your ID card first."); return; }
    setLoading(true);
    setError("");
    try {
      const data = await API.kycRegisterFace({ id_image_base64: idBase64 });
      if (!data.success) { setError(data.message); return; }
      setStep(2);
    } catch (err) {
      setError(err.message || "ID registration failed.");
    } finally {
      setLoading(false);
    }
  };

  // Step 2: blink check
  const startBlink = async () => {
    setError("");
    setBlinkStatus("recording");
    framesRef.current = [];
    setFrameCount(0);
    await openCamera();

    // Capture a frame every 100ms for about 2 seconds
    intervalRef.current = setInterval(() => {
      const video = videoRef.current;
      if (!video) return;
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 320;
      canvas.height = video.videoHeight || 240;
      canvas.getContext("2d").drawImage(video, 0, 0);
      framesRef.current.push(canvasToBase64(canvas));
      setFrameCount(framesRef.current.length);

      if (framesRef.current.length >= 20) {
        clearInterval(intervalRef.current);
        closeCamera();
        setBlinkStatus("done");
      }
    }, 100);
  };

  const submitBlink = async () => {
    if (framesRef.current.length < 5) { setError("Not enough frames. Try again."); return; }
    setLoading(true);
    setError("");
    try {
      const data = await API.kycBlinkChallenge({ frames_base64: framesRef.current });
      if (!data.passed) { setError(data.message); setBlinkStatus("idle"); return; }
      setChallengeId(data.challenge_id);
      setStep(3);
    } catch (err) {
      setError(err.message || "Blink challenge failed.");
    } finally {
      setLoading(false);
    }
  };

  // Step 3: selfie
  const takeSelfie = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    const b64 = canvasToBase64(canvas);
    setSelfieBase64(b64);
    setSelfiePreview(b64);
    closeCamera();
  };

  const submitSelfie = async () => {
    if (!selfieBase64) { setError("Take your selfie first."); return; }
    if (!challengeId) { setError("Challenge ID missing. Restart KYC."); return; }
    setLoading(true);
    setError("");
    try {
      const data = await API.kycVerifySelfie({
        challenge_id: challengeId,
        selfie_image_base64: selfieBase64,
      });
      setResult(data);
      setStep(4);
    } catch (err) {
      setError(err.message || "Verification failed.");
    } finally {
      setLoading(false);
    }
  };

  // Reset the whole flow
  const restart = () => {
    setStep(1);
    setIdBase64("");
    setIdPreview(null);
    setSelfieBase64("");
    setSelfiePreview(null);
    setResult(null);
    setBlinkStatus("idle");
    setChallengeId("");
    setError("");
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
              {step > s.id ? "✓" : s.id}
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
      {error && (
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
          <label className="block w-full border-2 border-dashed border-gray-300 rounded-2xl p-6 text-center cursor-pointer hover:border-[#017FE6] transition">
            {idPreview ? (
              <img src={idPreview} alt="ID" className="max-h-48 mx-auto rounded-xl object-contain" />
            ) : (
              <div className="text-gray-400">
                <p className="text-3xl mb-2">🪪</p>
                <p className="text-sm">Click to upload</p>
                <p className="text-xs text-gray-400">JPG, PNG — max 10MB</p>
              </div>
            )}
            <input type="file" accept="image/*" className="hidden" onChange={handleIdUpload} />
          </label>
          <button
            onClick={submitId}
            disabled={!idBase64 || loading}
            className="mt-4 w-full py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-[#017FE6] to-[#0165B8] hover:opacity-95 transition disabled:opacity-50"
          >
            {loading ? "Registering..." : "Register ID & Continue"}
          </button>
        </div>
      )}

      {/* step 2 */}
      {step === 2 && (
        <div>
          <h2 className="text-xl font-bold text-gray-900 mb-1">Liveness Check</h2>
          <p className="text-gray-500 text-sm mb-4">
            Blink naturally once or twice when recording starts.
          </p>
          <div className="bg-black rounded-2xl overflow-hidden aspect-video mb-4">
            <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
          </div>

          {blinkStatus === "idle" && (
            <button onClick={startBlink} className="w-full py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-[#017FE6] to-[#0165B8] hover:opacity-95">
              Start Blink Recording
            </button>
          )}
          {blinkStatus === "recording" && (
            <div className="text-center">
              <p className="text-[#017FE6] font-bold animate-pulse mb-1">Recording...</p>
              <p className="text-gray-500 text-sm">Blink naturally. Frame {frameCount}/20</p>
              <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                <div className="bg-[#017FE6] h-2 rounded-full transition-all" style={{ width: `${(frameCount / 20) * 100}%` }} />
              </div>
            </div>
          )}
          {blinkStatus === "done" && (
            <button onClick={submitBlink} disabled={loading} className="w-full py-3 rounded-xl font-semibold text-white bg-green-600 hover:opacity-95 disabled:opacity-50">
              {loading ? "Analyzing..." : "Submit Blink & Continue"}
            </button>
          )}
        </div>
      )}

      {/* step 3 */}
      {step === 3 && (
        <div>
          <h2 className="text-xl font-bold text-gray-900 mb-1">Take Your Selfie</h2>
          <p className="text-gray-500 text-sm mb-4">Look at the camera with good lighting.</p>
          <div className="bg-black rounded-2xl overflow-hidden aspect-video mb-4">
            {selfiePreview ? (
              <img src={selfiePreview} alt="Selfie" className="w-full h-full object-cover" />
            ) : (
              <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
            )}
          </div>
          <div className="flex gap-3">
            {!selfiePreview && (
              <button onClick={openCamera} className="flex-1 py-3 rounded-xl font-semibold border border-gray-200 text-gray-900 hover:bg-gray-50">
                Open Camera
              </button>
            )}
            <button
              onClick={selfiePreview ? () => { setSelfiePreview(null); setSelfieBase64(""); openCamera(); } : takeSelfie}
              className="flex-1 py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-[#017FE6] to-[#0165B8] hover:opacity-95"
            >
              {selfiePreview ? "Retake" : "Capture"}
            </button>
          </div>
          {selfiePreview && (
            <button onClick={submitSelfie} disabled={loading} className="mt-3 w-full py-3 rounded-xl font-semibold text-white bg-green-600 hover:opacity-95 disabled:opacity-50">
              {loading ? "Verifying..." : "Verify My Identity"}
            </button>
          )}
        </div>
      )}

      {/* step 4 */}
      {step === 4 && result && (
        <div className="text-center py-4">
          <div className={`text-5xl mb-4 ${result.verified ? "text-green-500" : "text-red-500"}`}>
            {result.verified ? "✅" : "❌"}
          </div>
          <h2 className={`text-2xl font-bold mb-2 ${result.verified ? "text-green-700" : "text-red-700"}`}>
            {result.verified ? "Identity Verified!" : "Verification Failed"}
          </h2>
          <p className="text-gray-500 text-sm mb-4">{result.message}</p>

          {result.verified && (
            <div className="bg-green-50 border border-green-200 rounded-2xl p-4 text-left mb-4 space-y-1">
              <p className="text-sm text-green-700"><strong>Name:</strong> {result.full_name}</p>
              <p className="text-sm text-green-700"><strong>Role:</strong> {result.role}</p>
              <p className="text-sm text-green-700"><strong>Confidence:</strong> {result.confidence}%</p>
            </div>
          )}

          {!result.verified && (
            <button onClick={restart} className="w-full py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-[#017FE6] to-[#0165B8] hover:opacity-95">
              Restart KYC
            </button>
          )}
        </div>
      )}
    </div>
  );
}
