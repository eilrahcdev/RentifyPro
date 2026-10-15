import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const entryPoint = fileURLToPath(new URL("../src/utils/cameraKyc.js", import.meta.url));
const bundle = await build({ entryPoints: [entryPoint], bundle: true, platform: "node", format: "esm", write: false });
const source = Buffer.from(bundle.outputFiles[0].text).toString("base64");
const { captureBase64FromStream, validateDocumentImageFile, validateSupportingDocumentFile } = await import(`data:text/javascript;base64,${source}`);

test("white document paper with text passes while blank, dark, low-resolution and unsupported files fail", async () => {
  const previousDocument = globalThis.document;
  const previousBitmap = globalThis.createImageBitmap;
  let closed = 0;
  let width = 1366, height = 2048;
  let pixels = new Uint8ClampedArray(64 * 64 * 4);
  const fill = (value, withText = false) => {
    for (let index = 0; index < 64 * 64; index++) {
      const ink = withText && index % 64 > 12 && index % 64 < 52 && Math.floor(index / 64) % 8 === 4 && index % 3 === 0;
      pixels.set([ink ? 30 : value, ink ? 30 : value, ink ? 30 : value, 255], index * 4);
    }
  };
  globalThis.createImageBitmap = async () => ({ width, height, close: () => { closed++; } });
  globalThis.document = { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data: pixels }) }) }) };
  const image = { type: "image/jpeg", size: 100000, name: "synthetic-document.jpg" };
  try {
    fill(255, true);
    assert.deepEqual(await validateDocumentImageFile(image), { width, height });
    assert.deepEqual(await validateSupportingDocumentFile(image), { width, height });
    fill(255);
    await assert.rejects(validateDocumentImageFile(image), /blank|text|detail/i);
    fill(12, true);
    await assert.rejects(validateDocumentImageFile(image), /dark/i);
    fill(150);
    await assert.rejects(validateDocumentImageFile(image), /blank|text|detail/i);
    fill(255, true); width = 320; height = 240;
    await assert.rejects(validateDocumentImageFile(image), /resolution/i);
    assert.equal(closed, 6);
    await assert.rejects(validateDocumentImageFile({ ...image, type: "image/svg+xml" }));
    await assert.rejects(validateDocumentImageFile({ ...image, size: 5 * 1024 * 1024 }));
    assert.deepEqual(await validateSupportingDocumentFile({ type: "application/pdf", size: 1000, name: "synthetic.pdf" }), { documentType: "pdf" });
    assert.equal(closed, 6);
  } finally {
    globalThis.document = previousDocument;
    globalThis.createImageBitmap = previousBitmap;
  }
});

test("selfie capture submits the frame shown inside the camera guide", async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousImageCapture = globalThis.ImageCapture;
  const preview = { videoWidth: 640, videoHeight: 480 };
  const drawn = [];
  let imageCaptureCalled = false;

  globalThis.document = {
    createElement: () => ({
      getContext: () => ({ drawImage: (...args) => drawn.push(args) }),
      toDataURL: () => "data:image/jpeg;base64,visible-frame",
    }),
  };
  globalThis.window = { ImageCapture: true };
  globalThis.ImageCapture = class {
    grabFrame() {
      imageCaptureCalled = true;
      return Promise.resolve({ width: 1280, height: 720 });
    }
  };

  try {
    const stream = { getVideoTracks: () => [{}] };
    const result = await captureBase64FromStream(stream, { videoElement: preview });
    assert.equal(result, "data:image/jpeg;base64,visible-frame");
    assert.deepEqual(drawn, [[preview, 0, 0, 640, 480]]);
    assert.equal(imageCaptureCalled, false);
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    globalThis.ImageCapture = previousImageCapture;
  }
});
