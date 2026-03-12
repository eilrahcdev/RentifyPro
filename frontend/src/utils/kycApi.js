// KYC calls used during registration
// These hit the /api/kyc/pre/* routes

const BASE_URL = "http://localhost:5000";

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.detail || `Request failed (${res.status})`);
  return data;
}

// Step 1: save the ID face
export async function preRegisterIdFace(email, fullName, role, idImageBase64, idImageMime) {
  return postJson(`${BASE_URL}/api/kyc/pre/id-register`, {
    email,
    full_name: fullName,
    role,
    id_image_base64: idImageBase64,
    id_image_mime: idImageMime,
  });
}

// Step 2: run the blink check
export async function preSelfieChallenge(email, framesBase64) {
  return postJson(`${BASE_URL}/api/kyc/pre/selfie/challenge`, {
    email,
    frames_base64: framesBase64,
  });
}

// Step 3: match the selfie with the ID
export async function preSelfieVerify(email, challengeId, selfieImageBase64, role) {
  return postJson(`${BASE_URL}/api/kyc/pre/selfie/verify`, {
    email,
    challenge_id: challengeId,
    selfie_image_base64: selfieImageBase64,
    role,
  });
}

// Supporting document verification (owner)
export async function preVerifySupportingDocument(email, docImageBase64, docImageMime, role = "owner") {
  return postJson(`${BASE_URL}/api/kyc/pre/supporting-doc/verify`, {
    email,
    role,
    doc_image_base64: docImageBase64,
    doc_image_mime: docImageMime,
  });
}
