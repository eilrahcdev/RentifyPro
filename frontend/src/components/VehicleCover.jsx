import { useMemo } from "react";
import { DEFAULT_VEHICLE_IMAGE, getVehicleCoverImageCandidates } from "../utils/media";
import { API_BASE_URL } from "../utils/runtimeConfig";
import VehicleImageFrame from "./VehicleImageFrame";

const getImageCrossOrigin = (source) => {
  if (typeof window === "undefined" || !source || /^(data:|blob:)/i.test(source)) return undefined;

  try {
    const imageUrl = new URL(source, window.location.href);
    const imageOrigin = imageUrl.origin;
    const apiOrigin = new URL(API_BASE_URL, window.location.href).origin;
    return imageOrigin === apiOrigin && imageOrigin !== window.location.origin
      ? imageUrl.pathname.startsWith("/api/admin/vehicles/") ? "use-credentials" : "anonymous"
      : undefined;
  } catch {
    return undefined;
  }
};

export default function VehicleCover({ vehicle = null, src = "", displayMode = "", fallback, ...props }) {
  const candidates = useMemo(() => {
    const directSource = String(src || "").trim();
    const vehicleCandidates = getVehicleCoverImageCandidates(vehicle || {});
    const sources = directSource
      ? [directSource, ...vehicleCandidates.filter((candidate) => candidate !== directSource)]
      : vehicleCandidates;
    return fallback === undefined ? sources : sources.filter((source) => source !== DEFAULT_VEHICLE_IMAGE);
  }, [src, vehicle, fallback]);

  return <VehicleImageFrame {...props} candidates={candidates} displayMode={displayMode || vehicle?.coverDisplayMode} getCrossOrigin={getImageCrossOrigin} fallback={fallback} />;
}
