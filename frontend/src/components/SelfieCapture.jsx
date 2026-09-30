import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CircleCheck, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import {
  captureBase64FromStream,
  startCamera,
  stopCamera,
  stripDataUrlPrefix,
} from "../utils/cameraKyc";

function cameraErrorMessage(error) {
  const name = error?.name || "";

  if (name === "NotAllowedError") {
    return "Camera access is blocked. Allow camera access in your browser settings, then try again.";
  }
  if (name === "NotReadableError") {
    return "Your camera is being used by another app. Close that app, then try again.";
  }
  if (name === "NotFoundError") {
    return "No camera was found on this device. Connect a camera or continue on a device with one.";
  }
  if (name === "SecurityError") {
    return "Your browser blocked camera access on this page. Check the site permissions and try again.";
  }

  return "We couldn't open the camera. Check your browser permissions and try again.";
}

export default function SelfieCapture({
  previewUrl = "",
  matched = false,
  matchedDescription = "Your selfie matched your ID photo.",
  disabled = false,
  submitting = false,
  error = "",
  onCapture,
  onRetake,
  onSubmit,
}) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const mountedRef = useRef(true);
  const [cameraState, setCameraState] = useState("idle");
  const [cameraError, setCameraError] = useState("");
  const [frameAspectRatio, setFrameAspectRatio] = useState(null);

  const updateFrameAspectRatio = (width, height) => {
    if (width > 0 && height > 0) setFrameAspectRatio(width / height);
  };

  const closeCamera = useCallback(() => {
    stopCamera(streamRef.current || videoRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (mountedRef.current) setCameraState("idle");
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const video = videoRef.current;
    return () => {
      mountedRef.current = false;
      stopCamera(streamRef.current || video);
      streamRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (previewUrl || matched || disabled) closeCamera();
  }, [previewUrl, matched, disabled, closeCamera]);

  const openCamera = useCallback(async () => {
    if (disabled || submitting || cameraState !== "idle") return;

    setCameraError("");
    setCameraState("opening");
    try {
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
      const stream = await startCamera(videoRef.current);
      if (!mountedRef.current) {
        stopCamera(stream);
        return;
      }
      streamRef.current = stream;
      setCameraState("active");
    } catch (cameraFailure) {
      closeCamera();
      if (mountedRef.current) setCameraError(cameraErrorMessage(cameraFailure));
    }
  }, [cameraState, closeCamera, disabled, submitting]);

  const takePhoto = async () => {
    if (disabled || submitting || cameraState !== "active" || !streamRef.current) return;

    setCameraError("");
    setCameraState("capturing");
    try {
      const dataUrl = await captureBase64FromStream(streamRef.current, { videoElement: videoRef.current });
      if (!dataUrl) throw new Error("EMPTY_CAPTURE");

      closeCamera();
      onCapture?.({ dataUrl, base64: stripDataUrlPrefix(dataUrl) });
    } catch {
      if (mountedRef.current) {
        setCameraState(streamRef.current ? "active" : "idle");
        setCameraError("We couldn't capture the photo. Keep your face centered and try again.");
      }
    }
  };

  const retake = async () => {
    if (disabled || submitting) return;
    setCameraError("");
    onRetake?.();
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    await openCamera();
  };

  if (matched) {
    return (
      <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
        <div className="flex items-center gap-2 font-semibold">
          <CircleCheck size={20} aria-hidden="true" />
          Selfie matched
        </div>
        <p className="mt-1 text-sm leading-6 text-emerald-800">{matchedDescription}</p>
      </div>
    );
  }

  const hasPreview = Boolean(previewUrl);
  const cameraVisible = ["opening", "active", "capturing"].includes(cameraState);
  const busy = disabled || submitting || cameraState === "opening" || cameraState === "capturing";
  const primaryLabel = hasPreview
    ? submitting
      ? "Matching selfie..."
      : "Use selfie and continue"
    : cameraState === "opening"
      ? "Opening camera..."
      : cameraState === "capturing"
        ? "Taking photo..."
        : cameraState === "active"
          ? "Take photo"
          : "Open camera";
  const primaryAction = hasPreview ? onSubmit : cameraState === "active" ? takePhoto : openCamera;

  return (
    <section aria-labelledby="selfie-capture-title" className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#017FE6]">
          <Camera size={20} aria-hidden="true" />
        </div>
        <div>
          <h3 id="selfie-capture-title" className="font-semibold text-slate-950">Take a live selfie</h3>
          <p className="mt-1 max-w-prose text-sm leading-6 text-slate-600">
            Face the camera in even lighting. Keep your full face visible and make sure only you are in the frame.
          </p>
        </div>
      </div>

      <div
        className="relative mx-auto mt-4 aspect-[3/4] w-full max-w-md overflow-hidden rounded-2xl bg-slate-950 sm:aspect-video"
        style={frameAspectRatio ? { aspectRatio: frameAspectRatio } : undefined}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          aria-label="Live camera preview"
          onLoadedMetadata={(event) => updateFrameAspectRatio(event.currentTarget.videoWidth, event.currentTarget.videoHeight)}
          className={`h-full w-full object-contain transition-opacity ${cameraVisible && !hasPreview ? "opacity-100" : "opacity-0"}`}
          style={{ transform: "scaleX(-1)" }}
        />

        {hasPreview && (
          <img
            src={previewUrl}
            alt="Captured selfie preview"
            onLoad={(event) => updateFrameAspectRatio(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)}
            className="absolute inset-0 h-full w-full object-contain"
            style={{ transform: "scaleX(-1)" }}
          />
        )}

        {!hasPreview && !cameraVisible && (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center text-slate-300">
            <Camera size={32} className="mb-3 text-slate-400" aria-hidden="true" />
            <p className="text-sm font-medium">Your camera preview will appear here.</p>
          </div>
        )}

        {cameraVisible && !hasPreview && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
            <svg viewBox="0 0 300 400" preserveAspectRatio="xMidYMid meet" className="h-full w-full">
              <ellipse cx="150" cy="200" rx="108" ry="143" fill="none" stroke="rgba(15, 23, 42, 0.55)" strokeWidth="5" vectorEffect="non-scaling-stroke" />
              <ellipse cx="150" cy="200" rx="108" ry="143" fill="none" stroke="rgba(255, 255, 255, 0.9)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            </svg>
          </div>
        )}

        {cameraState === "opening" && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/55 text-sm font-semibold text-white">
            <LoaderCircle size={18} className="mr-2 animate-spin" aria-hidden="true" />
            Opening camera...
          </div>
        )}
      </div>

      {!hasPreview && (
        <p className="mt-2 text-center text-xs font-medium text-slate-500">
          Center your face in the oval with a little space around it. The guide does not check liveness.
        </p>
      )}

      <div className={`mt-4 grid gap-3 ${hasPreview ? "sm:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]" : "grid-cols-1"}`}>
        {hasPreview && (
          <button
            type="button"
            onClick={retake}
            disabled={busy}
            className="rp-btn-secondary order-2 min-h-11 w-full px-4 py-3 disabled:cursor-not-allowed disabled:opacity-50 sm:order-1"
          >
            <RefreshCw size={17} aria-hidden="true" />
            Retake
          </button>
        )}
        <button
          type="button"
          onClick={primaryAction}
          disabled={busy || (hasPreview && !onSubmit)}
          className="rp-btn-primary order-1 min-h-11 w-full px-4 py-3 disabled:cursor-not-allowed disabled:opacity-50 sm:order-2"
        >
          {busy && (submitting || cameraState === "opening" || cameraState === "capturing") ? (
            <LoaderCircle size={17} className="animate-spin" aria-hidden="true" />
          ) : (
            <Camera size={17} aria-hidden="true" />
          )}
          {primaryLabel}
        </button>
      </div>

      {(cameraError || error) && (
        <div role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-medium leading-6 text-rose-800">
          {cameraError || error}
        </div>
      )}

      <div className="mt-4 flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">
        <ShieldCheck size={17} className="mt-0.5 shrink-0 text-slate-500" aria-hidden="true" />
        <p>
          Your selfie is submitted for matching only after you choose <span className="font-semibold text-slate-700">Use selfie and continue</span>. The camera stops immediately after a photo is captured.
        </p>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {cameraState === "active" ? "Camera ready." : cameraState === "capturing" ? "Taking photo." : ""}
      </p>
    </section>
  );
}
