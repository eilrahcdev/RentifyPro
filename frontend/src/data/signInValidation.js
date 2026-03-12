export const EMAIL_REGEX = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
export const EMOJI_REGEX = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{200D}\u{20E3}\u{2028}\u{2029}]/u;

export const ALLOWED_EMAIL_DOMAINS = [
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
];

export const SIGN_IN_VALIDATION_RULES = {
  email: (value) => {
    if (!value) return "Email is required.";
    if (EMOJI_REGEX.test(value)) return "Email must not contain emoji.";
    if (/\s/.test(value)) return "Email must not contain spaces.";
    if (value.length > 254) return "Email is too long (max 254 characters).";
    if (!EMAIL_REGEX.test(value)) return "Enter a valid email format.";
    const domain = value.split("@")[1];
    if (!ALLOWED_EMAIL_DOMAINS.includes(domain))
      return "Please use a valid email address from a supported provider.";
    return "";
  },
  password: (value) => {
    if (!value) return "Password is required.";
    if (/\s/.test(value)) return "Password must not contain spaces.";
    if (EMOJI_REGEX.test(value)) return "Password must not contain emoji.";
    if (value.length < 8) return "Password must be at least 8 characters.";
    if (!/[A-Z]/.test(value)) return "Password must contain at least one uppercase letter.";
    if (!/[0-9]/.test(value)) return "Password must contain at least one number.";
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(value))
      return "Password must contain at least one special character (!@#$%^&*).";
    return "";
  },
  captcha: (value) => {
    if (!value) return "Security check answer is required.";
    if (EMOJI_REGEX.test(value)) return "Security check must not contain emoji.";
    if (/\s/.test(value)) return "Security check must not contain spaces.";
    if (!/^[0-9]+$/.test(value)) return "Security check answer must be a number.";
    if (value.length > 3) return "Security check answer must be at most 3 digits.";
    return "";
  },
};
