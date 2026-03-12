import PreKycDocument from "../models/PreKycDocument.js";

export async function getMissingPreKycDocs(email, requiredDocs = []) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail || requiredDocs.length === 0) return requiredDocs;

  const verifiedDocs = await PreKycDocument.find({
    email: normalizedEmail,
    docType: { $in: requiredDocs },
    status: "verified",
  }).select("docType");

  const verifiedSet = new Set(verifiedDocs.map((doc) => doc.docType));
  return requiredDocs.filter((docType) => !verifiedSet.has(docType));
}

export async function clearPreKycDocs(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return;
  await PreKycDocument.deleteMany({ email: normalizedEmail });
}
