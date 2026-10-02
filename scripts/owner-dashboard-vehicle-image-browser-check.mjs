// Fixture-only browser check. Requires Vite on 4178 and Chrome CDP on 9238.
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const base = "http://127.0.0.1:4178";
const target = await (await fetch("http://127.0.0.1:9238/json/new?about:blank", { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

const image = (width, height, transparent = false) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${transparent ? "none" : "#f8fafc"}"/><rect x="2" y="2" width="${width - 4}" height="${height - 4}" rx="6" fill="#d73d32" stroke="#172033" stroke-width="4"/></svg>`)}`;

const vehicles = [
  { _id: "wide", name: "Wide Truck", imageUrl: image(600, 160), coverDisplayMode: "photo" },
  { _id: "tall", name: "Tall Motorcycle", imageUrl: image(160, 500), coverDisplayMode: "photo" },
  { _id: "cutout", name: "Transparent Vehicle", imageUrl: image(500, 240, true), coverDisplayMode: "cutout" },
  { _id: "alternate", name: "Alternate Cover", imageUrl: "http://localhost:5000/uploads/not-found.png", images: [image(600, 160)], coverDisplayMode: "photo" },
  { _id: "missing", name: "Missing Image", imageUrl: "http://localhost:5000/uploads/not-found.png", coverDisplayMode: "photo" },
];
const owner = { _id: "507f1f77bcf86cd799439011", name: "Image Check Owner", email: "owner@example.test", role: "owner", isVerified: true, kycStatus: "approved" };

let sequence = 0;
const pending = new Map();
const errors = [];
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const fulfill = (requestId, body) => send("Fetch.fulfillRequest", {
  requestId,
  responseCode: 200,
  responseHeaders: [
    { name: "Content-Type", value: "application/json" },
    { name: "Access-Control-Allow-Origin", value: base },
    { name: "Access-Control-Allow-Credentials", value: "true" },
    { name: "Access-Control-Allow-Headers", value: "content-type" },
  ],
  body: Buffer.from(JSON.stringify(body)).toString("base64"),
});
async function route({ requestId, request }) {
  const url = new URL(request.url);
  if (url.pathname === "/uploads/not-found.png") return send("Fetch.failRequest", { requestId, errorReason: "Failed" });
  if (url.pathname.startsWith("/api/")) {
    if (request.method === "OPTIONS") return fulfill(requestId, {});
    if (url.pathname === "/api/auth/me" || url.pathname === "/api/auth/profile") return fulfill(requestId, { user: owner });
    if (url.pathname === "/api/owner/vehicles") return fulfill(requestId, { success: true, vehicles });
    return fulfill(requestId, { success: true, bookings: [], vehicles: [], notifications: [], conversations: [], unreadCount: 0, stats: {}, summary: {} });
  }
  if (url.origin !== base) return send("Fetch.failRequest", { requestId, errorReason: "Aborted" });
  return send("Fetch.continueRequest", { requestId });
}
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const call = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) call?.reject(new Error(message.error.message));
    else call?.resolve(message.result);
  } else if (message.method === "Runtime.exceptionThrown") {
    errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  } else if (message.method === "Fetch.requestPaused") {
    route(message.params).catch((error) => errors.push(error.message));
  }
};
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
};
const wait = async (expression) => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await evaluate(`Boolean(${expression})`)) return;
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw new Error(`Timed out: ${expression}`);
};

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "http*" }] });
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${base}/owner-dashboard?tab=Dashboard` });
  await wait("document.body.innerText.includes('View all vehicles')");
  await evaluate("document.querySelector('button[aria-label=\"View all vehicles\"]').click()");
  await wait("document.querySelector('[role=dialog][aria-label=\"All Vehicles\"]')?.querySelectorAll('article').length === 5");
  await wait("[...document.querySelectorAll('[role=dialog] img')].every(img => img.complete)");

  for (const width of [1440, 768, 390, 360, 320]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width <= 390 });
    const state = await evaluate(`(() => {
      const dialog = document.querySelector('[role=dialog][aria-label="All Vehicles"]');
      const cards = [...dialog.querySelectorAll('article')];
      const rect = dialog.getBoundingClientRect();
      return {
        dialogFits: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,
        listFits: cards.every(card => card.scrollWidth <= card.clientWidth + 1),
        images: cards.map(card => {
          const frame = card.querySelector('.rp-vehicle-cover');
          const img = frame.querySelector('img');
          return { name: card.textContent, width: frame.parentElement.getBoundingClientRect().width, fit: img && getComputedStyle(img).objectFit, padding: getComputedStyle(frame.querySelector('.rp-vehicle-cover__content')).padding, loaded: img?.naturalWidth > 0, fallback: !!frame.querySelector('[aria-label="Vehicle image unavailable"]') };
        }),
      };
    })()`);
    assert.ok(state.dialogFits, `Dialog overflows at ${width}px`);
    assert.ok(state.listFits, `Card overflows at ${width}px`);
    assert.equal(state.images.length, 5);
    assert.equal(state.images[0].fit, "cover");
    assert.equal(state.images[0].padding, "0px");
    assert.equal(state.images[1].fit, "cover");
    assert.equal(state.images[2].fit, "contain");
    assert.ok(state.images[3].loaded, "Alternate image did not load");
    assert.ok(state.images[4].fallback, "Missing image placeholder did not render");
    assert.ok(Math.abs(state.images[0].width - (width >= 640 ? 128 : 96)) < 1, `Unexpected thumbnail width at ${width}px`);
    if (width === 1440) {
      const desktopScreenshot = await send("Page.captureScreenshot", { format: "png" });
      await fs.mkdir(new URL("../frontend/.vite/", import.meta.url), { recursive: true });
      await fs.writeFile(new URL("../frontend/.vite/owner-dashboard-vehicle-images-desktop.png", import.meta.url), Buffer.from(desktopScreenshot.data, "base64"));
    }
  }

  const screenshot = await send("Page.captureScreenshot", { format: "png" });
  await fs.mkdir(new URL("../frontend/.vite/", import.meta.url), { recursive: true });
  await fs.writeFile(new URL("../frontend/.vite/owner-dashboard-vehicle-images-mobile.png", import.meta.url), Buffer.from(screenshot.data, "base64"));
  assert.deepEqual(errors, []);
  process.stdout.write("Dashboard vehicle image fixture passed at 1440, 768, 390, 360, and 320px.\n");
} finally {
  ws.close();
  await fetch(`http://127.0.0.1:9238/json/close/${target.id}`).catch(() => {});
}
