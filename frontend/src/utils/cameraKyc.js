import {
  validateKycImageFile,
  validateSupportingDocumentFile as validateSupportingFileSelection,
} from "./fileValidation";

// Convert a file to a data URL
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error("No file provided"));

    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

export function stripDataUrlPrefix(dataUrl) {
  if (!dataUrl) return "";
  const idx = dataUrl.indexOf("base64,");
  if (idx === -1) return dataUrl;
  return dataUrl.slice(idx + "base64,".length);
}

export function getMimeFromDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string") return "image/jpeg";
  const match = dataUrl.match(/^data:(.*?);base64,/);
  return match?.[1] || "image/jpeg";
}

/**
 * Start the camera and attach it to a video element.
 * Returns the MediaStream.
 */
export async function startCamera(videoEl, constraints = {}) {
  if (!videoEl) throw new Error("Video element not provided");

  const defaultConstraints = {
    audio: false,
    video: {
      facingMode: "user",
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  };

  const finalConstraints = {
    ...defaultConstraints,
    ...constraints,
    video: {
      ...(defaultConstraints.video || {}),
      ...(constraints.video || {}),
    },
  };

  const stream = await navigator.mediaDevices.getUserMedia(finalConstraints);

  // Attach the stream to the video element
  videoEl.srcObject = stream;
  videoEl.muted = true;
  videoEl.playsInline = true;
  videoEl.autoplay = true;

  // Wait for the video metadata
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Video metadata timeout")), 8000);
    const onMeta = () => {
      clearTimeout(t);
      videoEl.removeEventListener("loadedmetadata", onMeta);
      resolve();
    };
    videoEl.addEventListener("loadedmetadata", onMeta);
  });

  // Start playback
  try {
    await videoEl.play();
  } catch {
    // Some browsers block autoplay. That is okay here.
  }

  return stream;
}

/**
 * Stop the camera stream.
 * Accepts a stream or a video element.
 */
export function stopCamera(streamOrVideo) {
  const stream =
    streamOrVideo?.getTracks
      ? streamOrVideo
      : streamOrVideo?.srcObject;

  if (!stream) return;

  try {
    stream.getTracks().forEach((t) => t.stop());
  } catch {
    // Stopping an already-ended media track is safe to ignore.
  }
}

/**
 * Capture an image from a MediaStream.
 * Uses the displayed video frame when available so the captured framing matches the guide.
 * Falls back to ImageCapture, then a separate video canvas.
 * Returns a data URL.
 */
export async function captureBase64FromStream(stream, { mime = "image/jpeg", quality = 0.92, videoElement } = {}) {
  if (!stream) return "";

  const track = stream.getVideoTracks?.()[0];
  if (!track) return "";

  if (videoElement?.videoWidth && videoElement?.videoHeight) {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = videoElement.videoWidth;
      canvas.height = videoElement.videoHeight;
      const context = canvas.getContext("2d");
      context.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL(mime, quality);
    } catch {
      // Fall back to a frame from the same camera track.
    }
  }

  // Try ImageCapture first
  if ("ImageCapture" in window) {
    try {
      const imageCapture = new ImageCapture(track);
      const bitmap = await imageCapture.grabFrame();

      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;

      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0);

      return canvas.toDataURL(mime, quality);
    } catch {
      // Fall back to canvas below
    }
  }

  // Canvas fallback
  try {
    const settings = track.getSettings?.() || {};
    const w = settings.width || 640;
    const h = settings.height || 480;

    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;

    await video.play().catch(() => {});

    await new Promise((r) => setTimeout(r, 200));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    return canvas.toDataURL(mime, quality);
  } catch {
    return "";
  }
}

export async function validateDocumentImageFile(file) {
  validateKycImageFile(file);
  if (typeof createImageBitmap !== "function") return { skipped: true };

  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width < 480 || bitmap.height < 300) {
      throw new Error("Document image resolution is too low. Upload a clearer image at least 480 × 300 pixels.");
    }
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0, size, size);
    const pixels = context.getImageData(0, 0, size, size).data;
    let luminanceTotal = 0;
    let edgeTotal = 0;
    let prior = null;
    for (let index = 0; index < pixels.length; index += 4) {
      const luminance = 0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2];
      luminanceTotal += luminance;
      if (prior !== null) edgeTotal += Math.abs(luminance - prior);
      prior = luminance;
    }
    const averageLuminance = luminanceTotal / (pixels.length / 4);
    const averageEdge = edgeTotal / Math.max((pixels.length / 4) - 1, 1);
    if (averageLuminance < 22) throw new Error("Document image is too dark. Retake it in better lighting.");
    if (averageLuminance > 242) throw new Error("Document image is overexposed. Retake it without glare.");
    if (averageEdge < 1.1) throw new Error("Document image appears too blurry or blank. Upload a sharper photo.");
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close?.();
  }
}

export async function validateSupportingDocumentFile(file) {
  validateSupportingFileSelection(file);
  if (file.type === "application/pdf") return { documentType: "pdf" };
  return validateDocumentImageFile(file);
}
