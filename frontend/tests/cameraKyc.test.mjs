import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const entryPoint = fileURLToPath(new URL("../src/utils/cameraKyc.js", import.meta.url));
const bundle = await build({ entryPoints: [entryPoint], bundle: true, platform: "node", format: "esm", write: false });
const source = Buffer.from(bundle.outputFiles[0].text).toString("base64");
const { captureBase64FromStream } = await import(`data:text/javascript;base64,${source}`);

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
