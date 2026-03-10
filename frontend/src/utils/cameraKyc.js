<<<<<<< HEAD
// Convert a file to a data URL
=======
<<<<<<< HEAD
// Convert File -> data URL
=======
// Convert a file to a data URL
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
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
<<<<<<< HEAD
 * Start the camera and attach it to a video element.
 * Returns the MediaStream.
=======
<<<<<<< HEAD
 * Start camera and attach to video element.
 * Returns MediaStream.
=======
 * Start the camera and attach it to a video element.
 * Returns the MediaStream.
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
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

<<<<<<< HEAD
  // Attach the stream to the video element
=======
<<<<<<< HEAD
  // Attach stream to video
=======
  // Attach the stream to the video element
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
  videoEl.srcObject = stream;
  videoEl.muted = true;
  videoEl.playsInline = true;
  videoEl.autoplay = true;

<<<<<<< HEAD
  // Wait for the video metadata
=======
<<<<<<< HEAD
  // Wait for metadata
=======
  // Wait for the video metadata
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Video metadata timeout")), 8000);
    const onMeta = () => {
      clearTimeout(t);
      videoEl.removeEventListener("loadedmetadata", onMeta);
      resolve();
    };
    videoEl.addEventListener("loadedmetadata", onMeta);
  });

<<<<<<< HEAD
  // Start playback
  try {
    await videoEl.play();
  } catch {
    // Some browsers block autoplay. That is okay here.
=======
<<<<<<< HEAD
  // Ensure play
  try {
    await videoEl.play();
  } catch {
    // some browsers block autoplay; still okay if user clicked button
=======
  // Start playback
  try {
    await videoEl.play();
  } catch {
    // Some browsers block autoplay. That is okay here.
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
  }

  return stream;
}

/**
<<<<<<< HEAD
 * Stop the camera stream.
 * Accepts a stream or a video element.
=======
<<<<<<< HEAD
 * Stop camera stream.
 * Accepts either stream or video element.
=======
 * Stop the camera stream.
 * Accepts a stream or a video element.
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
 */
export function stopCamera(streamOrVideo) {
  const stream =
    streamOrVideo?.getTracks
      ? streamOrVideo
      : streamOrVideo?.srcObject;

  if (!stream) return;

  try {
    stream.getTracks().forEach((t) => t.stop());
  } catch {}
}

/**
<<<<<<< HEAD
 * Capture an image from a MediaStream.
 * Uses ImageCapture first, then falls back to canvas.
 * Returns a data URL.
=======
<<<<<<< HEAD
 * Capture from MediaStream (best approach on AMD/Windows):
 * Uses ImageCapture if available; otherwise canvas fallback.
 * Returns dataURL string "data:image/jpeg;base64,..."
=======
 * Capture an image from a MediaStream.
 * Uses ImageCapture first, then falls back to canvas.
 * Returns a data URL.
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
 */
export async function captureBase64FromStream(stream, { mime = "image/jpeg", quality = 0.92 } = {}) {
  if (!stream) return "";

  const track = stream.getVideoTracks?.()[0];
  if (!track) return "";

<<<<<<< HEAD
  // Try ImageCapture first
=======
<<<<<<< HEAD
  // Prefer ImageCapture (more reliable on some GPUs)
=======
  // Try ImageCapture first
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
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
<<<<<<< HEAD
      // Fall back to canvas below
=======
<<<<<<< HEAD
      // fallback below
=======
      // Fall back to canvas below
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
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
