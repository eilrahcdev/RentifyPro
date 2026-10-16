import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const source = await fs.readFile(new URL("../src/utils/runtimeConfig.js", import.meta.url), "utf8");
let revision = 0;
async function config(environment, origin) {
  const previous = globalThis.window;
  globalThis.window = { location: new URL(origin) };
  try {
    return await import("data:text/javascript;base64," + Buffer.from(source.replaceAll("import.meta.env", JSON.stringify(environment)) + `\n// fixture ${++revision}`).toString("base64"));
  } finally { previous === undefined ? delete globalThis.window : globalThis.window = previous; }
}

test("Netlify proxy mode keeps API and socket cookies first-party even with old direct service URLs", async () => {
  const result = await config({ MODE: "production", VITE_SAME_ORIGIN_PROXY: "true",
    VITE_API_BASE_URL: "https://rentifypro-api.azurewebsites.net", VITE_SOCKET_URL: "https://rentifypro-api.azurewebsites.net" }, "https://rentifypro.netlify.app");
  assert.equal(result.API_BASE_URL, "https://rentifypro.netlify.app/api");
  assert.equal(result.SOCKET_URL, "https://rentifypro.netlify.app");
  assert.deepEqual(result.SOCKET_TRANSPORTS, ["polling"]);
});

test("direct local and quick-tunnel deployments retain their existing origins and WebSockets", async () => {
  const local = await config({ MODE: "development", VITE_API_BASE_URL: "http://localhost:5000" }, "http://localhost:5173");
  assert.equal(local.API_BASE_URL, "http://localhost:5000/api");
  assert.deepEqual(local.SOCKET_TRANSPORTS, ["websocket"]);
  const tunnel = await config({ MODE: "quick-tunnel", VITE_SAME_ORIGIN_PROXY: "true", VITE_API_BASE_URL: "http://localhost:5000" }, "https://fixture.trycloudflare.com");
  assert.equal(tunnel.API_BASE_URL, "https://fixture.trycloudflare.com/api");
  assert.deepEqual(tunnel.SOCKET_TRANSPORTS, ["websocket"]);
});
