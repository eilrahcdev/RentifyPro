import { assertKycScreeningAvailable, getPrivateKycInternalKey } from "../utils/kycScreeningProvider.js";

const MAX_RESPONSE_BYTES = 512 * 1024;
const fail = (message, status = 503, retryable = false, code = "PRIVATE_KYC_SCREENING_UNAVAILABLE") => Object.assign(new Error(message), {
  status, retryable, code,
});

export function isCompatiblePrivateOcrHealth(health) {
  return health?.ready === true && health.schema_version === 1
    && health.provider === "paddleocr" && health.layout_version === 2;
}

export function normalizePrivateOcrResponse(payload) {
  if (payload?.schema_version !== 1 || payload?.provider !== "paddleocr"
    || !Array.isArray(payload.lines) || payload.lines.length > 1200
    || !Number.isInteger(payload.pages) || payload.pages < 1 || payload.pages > 5) {
    throw fail("The private checker returned an unsupported response.");
  }
  const lines = payload.lines.map((line) => {
    if (typeof line?.text !== "string" || line.text.length > 400
      || !Number.isFinite(line.confidence) || line.confidence < 0 || line.confidence > 1
      || !Number.isInteger(line.page) || line.page < 1 || line.page > payload.pages) {
      throw fail("The private checker returned invalid text readings.");
    }
    if (line.bbox !== undefined && (!Array.isArray(line.bbox) || line.bbox.length !== 4
      || line.bbox.some((value) => !Number.isFinite(value) || value < 0 || value > 1)
      || line.bbox[0] >= line.bbox[2] || line.bbox[1] >= line.bbox[3])) {
      throw fail("The private checker returned invalid text positions.");
    }
    return { text: line.text.trim(), confidence: line.confidence, page: line.page,
      ...(line.bbox ? { bbox: line.bbox } : {}) };
  });
  if (payload.layout_version === 2) {
    if (lines.some((line) => !line.bbox)) throw fail("The private checker returned incomplete text positions.");
    return { lines, pages: payload.pages, provider: "private-ocr", layoutVersion: 2 };
  }
  if (payload.layout_version !== undefined) {
    if (payload.layout_version !== 1 || !Array.isArray(payload.page_evidence)
      || payload.page_evidence.length !== payload.pages || lines.some((line) => !line.bbox)) {
      throw fail("The private checker returned incomplete layout evidence.");
    }
    const pageEvidence = payload.page_evidence.map((page, index) => {
      if (page.page !== index + 1 || !Number.isInteger(page.width) || !Number.isInteger(page.height)
        || page.width < 1 || page.width > 1400 || page.height < 1 || page.height > 1400
        || !Number.isFinite(page.contrast) || page.contrast < 0 || page.contrast > 128
        || !Number.isFinite(page.sharpness) || page.sharpness < 0 || page.sharpness > 1_100_000
        || typeof page.portrait_present !== "boolean") throw fail("The private checker returned invalid page evidence.");
      return { page: page.page, width: page.width, height: page.height, contrast: page.contrast,
        sharpness: page.sharpness, portrait_present: page.portrait_present };
    });
    return { lines, pages: payload.pages, provider: "private-ocr", layoutVersion: 1, pageEvidence };
  }
  return { lines, pages: payload.pages, provider: "private-ocr" };
}

async function readBoundedJson(response) {
  if (Number(response.headers.get("content-length") || 0) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw fail("The private checker response exceeded its size limit.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw fail("The private checker returned an empty response.");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw fail("The private checker response exceeded its size limit.");
      }
      chunks.push(Buffer.from(value));
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw fail("The private checker returned invalid JSON."); }
  } finally { reader.releaseLock(); }
}

export async function inspectPrivateKycDocument({ base64, mimeType }) {
  assertKycScreeningAvailable("private_ocr");
  const configuredTimeout = Number(process.env.KYC_PRIVATE_REQUEST_TIMEOUT_MS);
  const timeout = Number.isFinite(configuredTimeout) && configuredTimeout >= 1000 && configuredTimeout <= 120_000
    ? configuredTimeout : 30_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(`${process.env.KYC_PRIVATE_SERVICE_URL.replace(/\/+$/, "")}/inspect`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-key": getPrivateKycInternalKey() },
      body: JSON.stringify({ schema_version: 1, base64, mime_type: mimeType }),
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw fail("The private checker could not complete this document. It will be retried or reviewed manually.",
        response.status, [408, 429, 500, 502, 503, 504].includes(response.status));
    }
    const payload = await readBoundedJson(response);
    if (payload?.layout_version !== 2) {
      throw fail("Private OCR service is incompatible. Restart or redeploy it with layout_version=2 text positions.",
        503, false, "PRIVATE_KYC_SERVICE_INCOMPATIBLE");
    }
    return normalizePrivateOcrResponse(payload);
  } catch (error) {
    if (["PRIVATE_KYC_SCREENING_UNAVAILABLE", "PRIVATE_KYC_SERVICE_INCOMPATIBLE"].includes(error.code)) throw error;
    throw fail("The private checker could not be reached. It will be retried or reviewed manually.",
      controller.signal.aborted ? 504 : 503, true);
  } finally { clearTimeout(timer); }
}
