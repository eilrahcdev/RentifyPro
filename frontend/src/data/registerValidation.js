export const NAME_REGEX = /^[A-Za-z]+$/;
export const EMAIL_REGEX = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
export const PHONE_REGEX = /^[0-9]{11}$/;
export const EMOJI_REGEX = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{200D}\u{20E3}\u{2028}\u{2029}]/u;

export const ALLOWED_EMAIL_DOMAINS = [
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
];

export const RELATIONSHIP_OPTIONS = [
  "Parent",
  "Sibling",
  "Spouse",
  "Partner",
  "Relative",
  "Friend",
  "Guardian",
  "Other",
];

const MIN_RENTER_AGE = 18;

const parseDateInput = (value) => {
  const clean = String(value || "").trim();
  const match = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);

  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  parsed.setHours(0, 0, 0, 0);
  return parsed;
};

const getAgeFromDate = (birthDate, today) => {
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  const dayDiff = today.getDate() - birthDate.getDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) age -= 1;
  return age;
};

export const VALIDATION_RULES = {
  firstName: (value) => {
    if (!value) return "First name is required.";
    if (EMOJI_REGEX.test(value)) return "First name must not contain emoji.";
    if (value.includes(" ")) return "First name cannot contain spaces.";
    if (!/^[A-Za-z]+$/.test(value)) return "First name can only contain letters (A-Z, a-z).";
    if (value.length > 50) return "First name is too long (max 50 characters).";
    return "";
  },
  lastName: (value) => {
    if (!value) return "Last name is required.";
    if (EMOJI_REGEX.test(value)) return "Last name must not contain emoji.";
    if (value.includes(" ")) return "Last name cannot contain spaces.";
    if (!/^[A-Za-z]+$/.test(value)) return "Last name can only contain letters (A-Z, a-z).";
    if (value.length > 50) return "Last name is too long (max 50 characters).";
    return "";
  },
  email: (value) => {
    if (!value) return "Email address is required.";
    if (EMOJI_REGEX.test(value)) return "Email must not contain emoji.";
    if (/\s/.test(value)) return "Email must not contain spaces.";
    if (!EMAIL_REGEX.test(value)) return "Please enter a valid email address.";
    const domain = value.split("@")[1];
    if (!ALLOWED_EMAIL_DOMAINS.includes(domain))
      return "Please use a valid email address from a supported provider.";
    return "";
  },
  phone: (value) => {
    if (!value) return "Phone number is required.";
    if (EMOJI_REGEX.test(value)) return "Phone number must not contain emoji.";
    if (/\s/.test(value)) return "Phone number must not contain spaces.";
    if (!/^[0-9]+$/.test(value)) return "Phone number can only contain digits (0-9).";
    if (!PHONE_REGEX.test(value)) return "Phone number must be exactly 11 digits.";
    return "";
  },
  dateOfBirth: (value) => {
    if (!value) return "Date of birth is required.";
    const parsed = parseDateInput(value);
    if (!parsed) return "Please enter a valid date of birth.";
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (parsed > today) return "Date of birth cannot be in the future.";
    const age = getAgeFromDate(parsed, today);
    if (age < MIN_RENTER_AGE) return "Looks like you're under 18. RentifyPro accounts are for ages 18+.";
    return "";
  },
  gender: (value) => {
    if (!value) return "Gender is required.";
    return "";
  },
  region: (value) => {
    if (!value) return "Region is required.";
    return "";
  },
  province: (value) => {
    if (!value) return "Province is required.";
    return "";
  },
  city: (value) => {
    if (!value) return "City or municipality is required.";
    return "";
  },
  barangay: (value) => {
    if (!value) return "Barangay is required.";
    return "";
  },
  emergencyContactName: (value) => {
    if (!value) return "Emergency contact name is required.";
    if (EMOJI_REGEX.test(value)) return "Emergency contact name must not contain emoji.";
    if (value.length > 100) return "Emergency contact name is too long (max 100 characters).";
    return "";
  },
  emergencyContactPhone: (value) => {
    if (!value) return "Emergency contact phone is required.";
    if (EMOJI_REGEX.test(value)) return "Emergency contact phone must not contain emoji.";
    if (/\s/.test(value)) return "Emergency contact phone must not contain spaces.";
    if (!/^[0-9]+$/.test(value)) return "Emergency contact phone can only contain digits (0-9).";
    if (!PHONE_REGEX.test(value)) return "Emergency contact phone must be exactly 11 digits.";
    return "";
  },
  emergencyContactRelationship: (value) => {
    if (!value) return "Emergency contact relationship is required.";
    if (!RELATIONSHIP_OPTIONS.includes(value)) return "Please select a valid relationship.";
    return "";
  },
  password: (value) => {
    if (!value) return "Password is required.";
    if (/\s/.test(value)) return "Password must not contain spaces.";
    if (EMOJI_REGEX.test(value)) return "Password must not contain emoji.";
    if (value.length < 8) return "Password must be at least 8 characters.";
    if (value.length > 128) return "Password is too long (max 128 characters).";
    if (!/[A-Z]/.test(value)) return "Password must contain at least one uppercase letter.";
    if (!/[a-z]/.test(value)) return "Password must contain at least one lowercase letter.";
    if (!/[0-9]/.test(value)) return "Password must contain at least one number.";
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(value))
      return "Password must contain at least one special character (!@#$%^&*).";
    return "";
  },
  confirmPassword: (password, confirmPassword) => {
    if (!confirmPassword) return "Please confirm your password.";
    if (/\s/.test(confirmPassword)) return "Password must not contain spaces.";
    if (EMOJI_REGEX.test(confirmPassword)) return "Password must not contain emoji.";
    if (password !== confirmPassword) return "Passwords do not match.";
    return "";
  },
  agree: (value) => {
    if (!value) return "You must agree to the Terms and Conditions.";
    return "";
  },
};
