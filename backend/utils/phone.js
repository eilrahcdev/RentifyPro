export const PH_LOCAL_MOBILE_REGEX = /^9\d{9}$/;

export const normalizePhilippineMobile = (value) => {
  let digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";

  while (digits.startsWith("63") && digits.length > 10) {
    digits = digits.slice(2);
  }
  while (digits.startsWith("0") && digits.length > 10) {
    digits = digits.slice(1);
  }

  if (!PH_LOCAL_MOBILE_REGEX.test(digits)) return "";
  return digits;
};

export const isValidPhilippineMobile = (value) => PH_LOCAL_MOBILE_REGEX.test(String(value || "").trim());
