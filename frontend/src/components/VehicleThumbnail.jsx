import { CarFront } from "lucide-react";
import VehicleCover from "./VehicleCover";
import { resolveAssetUrl } from "../utils/media";

const unavailable = <span role="img" aria-label="Vehicle image unavailable" className="flex h-full w-full items-center justify-center text-[#017FE6]"><CarFront size={28} aria-hidden="true" /></span>;

export default function VehicleThumbnail({ vehicle, src = "", className = "", imageClassName = "", alt }) {
  const image = {
    ...vehicle,
    coverImageUrl: resolveAssetUrl(vehicle?.coverImageUrl),
    imageUrl: resolveAssetUrl(vehicle?.imageUrl),
    image: resolveAssetUrl(vehicle?.image),
    images: Array.isArray(vehicle?.images) ? vehicle.images.map(resolveAssetUrl) : [],
  };

  return (
    <div className={className}>
      <VehicleCover vehicle={image} src={resolveAssetUrl(src)} alt={alt || vehicle?.name || "Vehicle"} variant="thumbnail" imageClassName={imageClassName} fallback={unavailable} />
    </div>
  );
}
