export async function geminiFaceVerify  ({
  idImageBase64,
  idMimeType = "image/jpeg",
  selfieImageBase64,
  selfieMimeType = "image/jpeg",
}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY missing");

  if (!idImageBase64) throw new Error("ID image missing");
  if (!selfieImageBase64) throw new Error("Selfie image missing");

  const genAI = new GoogleGenerativeAI(apiKey);

  const model = genAI.getGenerativeModel({
    model: process.env.GEMINI_VISION_MODEL || "gemini-2.5-flash-lite",
  });

  const instruction = `
You are a strict face verification system.

You will receive:
1) An ID image containing a face.
2) A selfie image captured live from camera.

Your job:
- Confirm both images contain a real human face.
- Determine if both faces belong to the SAME person.

Be conservative. If unsure, fail.

Return ONLY JSON:
{
  "passed": boolean,
  "confidence": number,
  "reasoning": string
}
`;

  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          { text: instruction },
          { text: "ID image:" },
          {
            inlineData: {
              data: idImageBase64,
              mimeType: idMimeType,
            },
          },
          { text: "Selfie image:" },
          {
            inlineData: {
              data: selfieImageBase64,
              mimeType: selfieMimeType,
            },
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
    },
  });

  const text = result.response.text();
  const parsed = JSON.parse(text);

  return parsed;
}
