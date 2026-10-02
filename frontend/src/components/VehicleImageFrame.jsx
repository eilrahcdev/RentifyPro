import { useState } from "react";

// Keep this presentation component in sync with the separate admin checkout.
const DISPLAY_MODES = new Set(["auto", "photo", "cutout"]);

const normalizeDisplayMode = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return DISPLAY_MODES.has(normalized) ? normalized : "auto";
};

const hasMeaningfulTransparency = (image) => {
  if (!image?.naturalWidth || !image?.naturalHeight) return false;

  const maxSampleSize = 64;
  const scale = Math.min(1, maxSampleSize / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  try {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return false;
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    const pixels = context.getImageData(0, 0, width, height).data;
    const transparentPixelThreshold = Math.max(1, Math.ceil((pixels.length / 4) * 0.02));
    let transparentPixels = 0;

    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] < 245) {
        transparentPixels += 1;
        if (transparentPixels >= transparentPixelThreshold) return true;
      }
    }
  } catch {
    // Cross-origin images without canvas permission safely fall back to photo mode.
  }

  return false;
};

export default function VehicleImageFrame({
  candidates = [],
  alt = "Vehicle",
  displayMode = "auto",
  variant = "",
  className = "",
  contentClassName = "",
  imageClassName = "",
  getCrossOrigin,
  fallback = null,
  children,
}) {
  const candidateSignature = candidates.join("||");
  const [candidateState, setCandidateState] = useState({ signature: "", index: 0 });
  const candidateIndex = candidateState.signature === candidateSignature ? candidateState.index : 0;

  const currentImage = candidates[candidateIndex] || "";
  const [autoModeState, setAutoModeState] = useState({ image: "", mode: "photo" });
  const autoDisplayMode = autoModeState.image === currentImage ? autoModeState.mode : "photo";
  const requestedDisplayMode = normalizeDisplayMode(displayMode);
  const resolvedDisplayMode = requestedDisplayMode === "auto" ? autoDisplayMode : requestedDisplayMode;
  const crossOrigin = getCrossOrigin?.(currentImage);

  const handleError = () => {
    setCandidateState(() => {
      if (candidateIndex >= candidates.length) {
        return { signature: candidateSignature, index: candidateIndex };
      }
      return { signature: candidateSignature, index: candidateIndex + 1 };
    });
  };

  const handleLoad = (event) => {
    if (requestedDisplayMode !== "auto") return;
    setAutoModeState({
      image: currentImage,
      mode: hasMeaningfulTransparency(event.currentTarget) ? "cutout" : "photo",
    });
  };

  return (
    <div
      className={`rp-vehicle-cover rp-vehicle-cover--${resolvedDisplayMode} ${variant ? `rp-vehicle-cover--${variant}` : ""} ${className}`.trim()}
      data-display-mode={resolvedDisplayMode}
    >
      {currentImage && resolvedDisplayMode === "cutout" && (
        <>
          <div
            className="rp-vehicle-cover__backdrop"
            style={currentImage ? { backgroundImage: `url("${currentImage}")` } : undefined}
            aria-hidden="true"
          />
          <div className="rp-vehicle-cover__wash" aria-hidden="true" />
          <div className="rp-vehicle-cover__floor" aria-hidden="true" />
        </>
      )}
      <div className={`rp-vehicle-cover__content ${contentClassName}`.trim()}>
        {currentImage ? <img
          src={currentImage}
          alt={alt}
          className={`rp-vehicle-cover__image ${imageClassName}`.trim()}
          crossOrigin={crossOrigin}
          onLoad={handleLoad}
          onError={handleError}
        /> : fallback}
      </div>
      {children}
    </div>
  );
}
