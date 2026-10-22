import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Camera, LoaderCircle, X } from "lucide-react";
import ModalPortal from "./ModalPortal";
import { stopCamera, validateDocumentImageFile } from "../utils/cameraKyc";

const cameraMessage = (error) => {
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
    return "Camera access is blocked. Allow access in your browser settings, or close this window and upload a file.";
  }
  if (error?.name === "NotFoundError") return "No camera was found. Close this window and upload a file instead.";
  if (error?.name === "NotReadableError") return "The camera is in use. Close other camera apps and try again, or upload a file.";
  return "We couldn't open the camera. Try again, or close this window and upload a file.";
};

function DocumentCamera({ label, kind, onPick, onClose }) {
  const titleId = useId();
  const dialogRef = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const mounted = useRef(false);
  const generation = useRef(0);
  const previewRef = useRef("");
  const [state, setState] = useState("opening");
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");

  const releaseCamera = useCallback(() => {
    generation.current++;
    stopCamera(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const openCamera = useCallback(async () => {
    releaseCamera();
    const request = generation.current;
    setError("");
    setState("opening");
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error("CAMERA_UNAVAILABLE");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } } });
      if (!mounted.current || request !== generation.current || document.hidden) {
        stopCamera(stream);
        return;
      }
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      if (mounted.current && request === generation.current) setState("active");
    } catch (failure) {
      if (!mounted.current || request !== generation.current) return;
      releaseCamera();
      setState("idle");
      setError(cameraMessage(failure));
    }
  }, [releaseCamera]);

  useEffect(() => {
    mounted.current = true;
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    dialog.showModal();
    void openCamera();
    const pauseCamera = event => {
      if (!document.hidden && event.type !== "pagehide") return;
      releaseCamera();
      setState(previous => ["active", "opening", "capturing"].includes(previous) ? "idle" : previous);
    };
    document.addEventListener("visibilitychange", pauseCamera);
    window.addEventListener("pagehide", pauseCamera);
    return () => {
      mounted.current = false;
      releaseCamera();
      document.removeEventListener("visibilitychange", pauseCamera);
      window.removeEventListener("pagehide", pauseCamera);
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      dialog.close();
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [openCamera, releaseCamera]);

  const takePhoto = async () => {
    if (state !== "active") return;
    const video = videoRef.current;
    if (!video?.videoWidth || !video.videoHeight) {
      setError("The camera is not ready yet. Wait a moment and take the photo again.");
      return;
    }
    setError("");
    setState("capturing");
    try {
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 2400 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
      releaseCamera();
      const capture = generation.current;
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.92));
      if (!mounted.current || capture !== generation.current) return;
      if (!blob) throw new Error("EMPTY_CAPTURE");
      const file = new File([blob], `${kind}-photo-${Date.now()}.${blob.type === "image/png" ? "png" : "jpg"}`, { type: blob.type });
      const url = URL.createObjectURL(file);
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      previewRef.current = url;
      setPhoto(file);
      setPreview(url);
      setState("preview");
    } catch {
      if (!mounted.current) return;
      releaseCamera();
      setState("idle");
      setError("We couldn't capture the photo. Try again, or upload a file.");
    }
  };

  const retake = () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = "";
    setPreview("");
    setPhoto(null);
    void openCamera();
  };

  const usePhoto = async () => {
    if (!photo || state !== "preview") return;
    setState("confirming");
    setError("");
    try {
      await validateDocumentImageFile(photo);
      const selected = await onPick(photo);
      if (!mounted.current) return;
      if (selected === false) throw new Error("This photo could not be selected. Retake it with the complete document clearly visible.");
      onClose();
    } catch (failure) {
      if (!mounted.current) return;
      setState("preview");
      setError(failure.message || "Please retake the photo or upload a clearer file.");
    }
  };

  const confirming = state === "confirming";
  const dismiss = () => { if (!confirming) onClose(); };
  return <ModalPortal>
    <dialog ref={dialogRef} aria-labelledby={titleId} aria-describedby={`${titleId}-help`} aria-modal="true"
      onCancel={event => { event.preventDefault(); dismiss(); }}
      onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); dismiss(); } }}
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none overflow-y-auto bg-transparent p-0 text-slate-900 backdrop:bg-slate-950/60">
      <div className="rp-native-modal-frame">
        <section className="rp-modal-panel flex w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl">
          <header className="flex items-start justify-between gap-3 border-b border-slate-200 p-4">
            <div>
              <h2 id={titleId} className="text-lg font-semibold text-slate-950">Take a photo of your {label}</h2>
              <p id={`${titleId}-help`} className="mt-1 text-sm leading-6 text-slate-600 [@media(max-height:500px)]:hidden">Keep the {kind === "id" ? "entire front of the ID" : "complete document"} visible. Check that the text is readable and there is no glare.</p>
            </div>
            <button type="button" aria-label="Close document camera" onClick={dismiss} disabled={confirming} className="rp-icon-button shrink-0"><X size={20} aria-hidden="true" /></button>
          </header>
          <div className="rp-modal-scroll space-y-3 p-4">
            <div className="relative h-[38dvh] min-h-32 max-h-80 overflow-hidden rounded-xl bg-slate-950 sm:h-[48dvh] sm:max-h-96 [@media(max-height:500px)]:!h-[34dvh] [@media(max-height:500px)]:!min-h-20">
              <video ref={videoRef} autoPlay playsInline muted aria-label="Document camera preview" className={`h-full w-full object-contain ${preview ? "invisible" : ""}`} />
              {preview && <img src={preview} alt={`Captured ${label} preview`} className="absolute inset-0 h-full w-full object-contain" />}
              {state === "active" && kind === "id" && <svg aria-hidden="true" viewBox="0 0 400 300" className="pointer-events-none absolute inset-0 h-full w-full p-4"><rect x="26" y="40" width="348" height="220" rx="8" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg>}
              {["opening", "capturing"].includes(state) && <p role="status" className="absolute inset-0 flex items-center justify-center gap-2 bg-slate-950/70 text-sm font-semibold text-white"><LoaderCircle size={18} className="animate-spin" aria-hidden="true" />{state === "opening" ? "Opening camera..." : "Taking photo..."}</p>}
              {state === "idle" && !preview && <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-slate-200">Open the camera to try again, or cancel and upload a file.</p>}
            </div>
            {error && <p role="alert" className="text-sm leading-6 text-red-700">{error}</p>}
            <p className="text-sm leading-6 text-slate-600 [@media(max-height:500px)]:hidden">JPG or PNG, up to 5 MB. Your photo is uploaded only when you choose Upload and check.</p>
          </div>
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 p-4">
            <button type="button" onClick={dismiss} disabled={confirming} className="rp-btn-secondary min-h-11 px-4 py-2">Cancel</button>
            {preview && <button type="button" onClick={retake} disabled={confirming} className="rp-btn-secondary min-h-11 px-4 py-2">Retake</button>}
            <button type="button" disabled={["opening", "capturing", "confirming"].includes(state)}
              onClick={preview ? usePhoto : state === "active" ? takePhoto : openCamera} className="rp-btn-primary min-h-11 px-4 py-2 disabled:opacity-60">
              {confirming ? "Selecting photo..." : preview ? "Use photo" : state === "active" ? "Take photo" : "Open camera"}
            </button>
          </footer>
        </section>
      </div>
    </dialog>
  </ModalPortal>;
}

export default function DocumentCapture({ onPick, label = "government ID", kind = "id", disabled = false }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return <>
    <button type="button" aria-label={`Take photo of ${label}`} onClick={() => setOpen(true)} disabled={disabled}
      className="rp-btn-secondary inline-flex min-h-11 items-center justify-center gap-2 px-3 py-2 text-sm disabled:opacity-60">
      <Camera size={18} aria-hidden="true" /> Take photo
    </button>
    {open && !disabled && <DocumentCamera label={label} kind={kind} onPick={onPick} onClose={close} />}
  </>;
}
