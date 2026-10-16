import { normalizePhilippineMobile } from "./phone.js";

export function auditRegistrationUsers(users) {
  const seen = { email: new Set(), phone: new Set(), registrationDraftId: new Set() };
  const report = { users: 0, duplicateEmails: 0, duplicatePhones: 0, duplicateDrafts: 0, nonCanonicalEmails: 0, nonCanonicalPhones: 0 };
  const count = (field, value, key) => { if (!value) return; if (seen[field].has(value)) report[key]++; else seen[field].add(value); };
  for (const user of users) {
    report.users++;
    const email = typeof user.email === "string" ? user.email.trim().toLowerCase() : "";
    const phone = normalizePhilippineMobile(user.phone);
    if (!email || user.email !== email) report.nonCanonicalEmails++;
    if (user.phone != null && (typeof user.phone !== "string" || !phone || user.phone !== phone)) report.nonCanonicalPhones++;
    count("email", email, "duplicateEmails"); count("phone", phone, "duplicatePhones");
    count("registrationDraftId", user.registrationDraftId, "duplicateDrafts");
  }
  return { ...report, ready: Object.entries(report).every(([key, value]) => key === "users" || value === 0) };
}
