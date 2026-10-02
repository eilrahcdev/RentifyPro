const VEHICLE_TYPE_SEPARATOR_PATTERN = /(^|[/|\u00b7\u2022]\s*)(\p{L})/gu;

export const formatVehicleType = (value, fallback = "") => {
  const normalizedValue = String(value ?? "").trim();
  if (!normalizedValue) return fallback;

  return normalizedValue.replace(
    VEHICLE_TYPE_SEPARATOR_PATTERN,
    (_, separator, firstLetter) => `${separator}${firstLetter.toLocaleUpperCase()}`
  );
};

export const formatVehicleTypeLabel = (
  type,
  subType,
  { separator = " / ", fallback = "Vehicle" } = {}
) => {
  const parts = [type, subType]
    .map((value) => formatVehicleType(value))
    .filter(Boolean);

  return parts.length > 0 ? parts.join(separator) : fallback;
};
