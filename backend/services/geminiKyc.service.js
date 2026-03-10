import { GoogleGenerativeAI } from "@google/generative-ai";

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Face match only:
 * - ID image (base64 clean)
 * - Selfie captured from camera (base64 clean)
 */
export async function verifyFaceMatchWithGemini({
  idImageBase64,
  idMimeType = "image/jpeg",
  selfieImageBase64,
  selfieMimeType = "image/jpeg",
}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is missing in backend .env");

  if (!idImageBase64) throw new Error("ID image missing");
  if (!selfieImageBase64) throw new Error("Selfie image missing");

  const genAI = new GoogleGenerativeAI(apiKey);

  // Pick a free/cheap vision model; you can override via .env
  const modelName = process.env.GEMINI_VISION_MODEL || "gemini-2.5-flash-lite";

  const instruction = `
You are a strict face verification system.

You will receive:
1) An ID image containing a face photo.
2) A selfie image captured from a camera.

Tasks:
A) Confirm both images contain a real human face (not a screen photo, drawing, mask).
B) Decide whether the face in the selfie is the SAME person as the face on the ID.
Be conservative: if unclear, fail.

Return ONLY JSON:
{
  "passed": boolean,
  "confidence": number,
  "reasoning": string
}
`.trim();

  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: instruction,
  });

  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          { text: "ID image:" },
          { inlineData: { data: idImageBase64, mimeType: idMimeType } },

          { text: "Selfie image:" },
          { inlineData: { data: selfieImageBase64, mimeType: selfieMimeType } },

          { text: "Compare and return JSON only." },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.2,
    },
  });

  const text = result?.response?.text?.() ?? "";
  const parsed = safeJsonParse(text.trim());

  if (!parsed || typeof parsed.passed !== "boolean") {
    return {
      passed: false,
      confidence: 0,
      reasoning:
        "AI returned invalid response. Try again with clearer ID + selfie (good lighting, face centered).",
      debug: text.slice(0, 300),
    };
  }

  // normalize confidence
  const conf = Number(parsed.confidence);
  parsed.confidence = Number.isFinite(conf) ? conf : 0;

  return parsed;
}
