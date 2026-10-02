// Fixture browser check. Vite :4183 and isolated Chrome CDP :9243.
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const base = "http://127.0.0.1:4183";
const target = await (await fetch("http://127.0.0.1:9243/json/new?about:blank", { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const pending = new Map();
const errors = [];
let sequence = 0;
let locationSuggestionRequests = 0;
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  return response.result.value;
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const wait = async (expression) => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await evaluate(`Boolean(${expression})`)) return;
    await pause(100);
  }
  throw new Error(`Timed out: ${expression}`);
};
const setInput = (id, value) => evaluate(`(() => {
  const input = document.getElementById(${JSON.stringify(id)});
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
const key = (id, value) => evaluate(`document.getElementById(${JSON.stringify(id)}).dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(value)}, bubbles: true, cancelable: true }))`);
const clickSelector = async (selector) => {
  const rect = await evaluate(`(() => { const element=document.querySelector(${JSON.stringify(selector)}); element.scrollIntoView({ block: 'center' }); const r=element.getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+r.height/2 }; })()`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
};
const fulfill = (requestId, body, code = 200) => send("Fetch.fulfillRequest", {
  requestId,
  responseCode: code,
  responseHeaders: [
    { name: "Content-Type", value: "application/json" },
    { name: "Access-Control-Allow-Origin", value: base },
    { name: "Access-Control-Allow-Credentials", value: "true" },
    { name: "Access-Control-Allow-Headers", value: "content-type" },
    { name: "Access-Control-Allow-Methods", value: "GET,OPTIONS" },
  ],
  body: Buffer.from(JSON.stringify(body)).toString("base64"),
});
const fixtures = [
  { _id: "507f1f77bcf86cd799439011", name: "Toyota Vios 1.3", location: "Dagupan City, Pangasinan", availabilityStatus: "available", hourlyRentalRate: 250, specs: { type: "car" }, images: [] },
  { _id: "507f1f77bcf86cd799439012", name: "Honda Civic", location: "Dagupan City, Pangasinan", availabilityStatus: "available", hourlyRentalRate: 350, specs: { type: "car" }, images: [] },
];
async function route({ requestId, request }) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return send("Fetch.continueRequest", { requestId });
  if (request.method === "OPTIONS") return fulfill(requestId, {});
  if (url.pathname === "/api/auth/me") return fulfill(requestId, { message: "No session" }, 401);
  if (url.pathname === "/api/vehicles/locations") {
    locationSuggestionRequests += 1;
    const search = (url.searchParams.get("search") || "").toLowerCase();
    const locations = [
      { location: "Dagupan City, Pangasinan", vehicleCount: 2 },
      { location: "Urdaneta City, Pangasinan", vehicleCount: 1 },
      { location: "Alaminos City, Pangasinan", vehicleCount: 1 },
      { location: "San Carlos City, Pangasinan", vehicleCount: 1 },
    ].filter((item) => !search || item.location.toLowerCase().split(/\W+/).some((word) => word.startsWith(search)));
    return fulfill(requestId, { success: true, locations });
  }
  if (url.pathname === "/api/vehicles/suggestions") {
    const search = (url.searchParams.get("search") || "").toLowerCase();
    const suggestions = fixtures.map((vehicle) => ({ id: vehicle._id, name: vehicle.name, location: vehicle.location, hourlyRate: vehicle.hourlyRentalRate }))
      .concat([
        { id: "507f1f77bcf86cd799439013", name: "Ford Ranger", location: "Alaminos City", hourlyRate: 400 },
        { id: "507f1f77bcf86cd799439014", name: "Mitsubishi Mirage", location: "San Carlos City", hourlyRate: 225 },
      ])
      .filter((vehicle) => !search || search.split(/\s+/).every((term) => vehicle.name.toLowerCase().includes(term)));
    return fulfill(requestId, { success: true, suggestions });
  }
  if (url.pathname === "/api/vehicles") {
    const search = (url.searchParams.get("search") || "").toLowerCase();
    const vehicles = fixtures.filter((vehicle) => !search || search.split(/\s+/).every((term) => vehicle.name.toLowerCase().includes(term)));
    return fulfill(requestId, { success: true, vehicles, pagination: { total: vehicles.length, hasNextPage: false } });
  }
  if (url.pathname.startsWith("/api/vehicles/")) {
    const vehicle = fixtures.find((entry) => entry._id === url.pathname.split("/").at(-1));
    return fulfill(requestId, vehicle ? { success: true, vehicle } : { success: false, message: "Vehicle not found." }, vehicle ? 200 : 404);
  }
  return fulfill(requestId, { success: true, vehicles: [], notifications: [], unreadCount: 0 });
}
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request?.reject(new Error(message.error.message));
    else request?.resolve(message.result);
  } else if (message.method === "Fetch.requestPaused") void route(message.params).catch((error) => {
    if (!error.message.includes("Invalid InterceptionId")) errors.push(error.message);
  });
  else if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
};
const capture = async (name) => {
  const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await fs.mkdir("frontend/.vite", { recursive: true });
  await fs.writeFile(`frontend/.vite/${name}.png`, Buffer.from(data, "base64"));
};

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.bringToFront");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: base });
  await wait("document.getElementById('home-search-location')");
  assert.equal(await evaluate("document.querySelector('label[for=home-search-location]').textContent.trim()"), "Search by location (optional)");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('label[for=home-search-location]')).position"), "static");
  assert.equal(await evaluate("document.getElementById('home-search-location').placeholder"), "City, Province");
  assert.equal(await evaluate("document.getElementById('home-search-location').value"), "");
  assert.equal(await evaluate("document.getElementById('home-location-help').textContent"), "Enter a city or province, or leave blank to see all vehicles.");
  assert.equal(await evaluate("getComputedStyle(document.getElementById('home-location-help')).position"), "static");
  await wait("document.querySelector('.rp-location-search__control .rp-search-hint')?.textContent === 'Dagupan City, Pangasinan'");
  assert.equal(await evaluate("document.querySelector('.rp-location-search__control .rp-search-hint').textContent"), "Dagupan City, Pangasinan");
  assert.equal(await evaluate("getComputedStyle(document.getElementById('home-search-location'), '::placeholder').color"), "rgba(0, 0, 0, 0)");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate("document.querySelector('.rp-hero-search').scrollIntoView({ block: 'center' })");
  await pause(500);
  assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true, "Home search hint overflow at 390px");
  await capture("home-location-hint-390");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await wait("document.querySelector('.rp-location-search__control .rp-search-hint')?.dataset.phase === 'delete'");
  await wait("document.querySelector('.rp-location-search__control .rp-search-hint')?.textContent === 'Urdaneta City, Pangasinan'");
  await clickSelector("#home-search-location");
  await pause(350);
  assert.equal(await evaluate("document.getElementById('home-search-location').getAttribute('aria-expanded')"), "false");
  assert.equal(await evaluate("Boolean(document.getElementById('home-location-options'))"), false);
  assert.ok(locationSuggestionRequests > 0);
  await setInput("home-search-location", "Da");
  await wait("document.querySelectorAll('#home-location-options [role=option]').length === 1");
  assert.equal(await evaluate("document.getElementById('home-search-location').getAttribute('aria-expanded')"), "true");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true, "Home search overflow at 390px");
  await capture("home-location-suggestions-390");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await key("home-search-location", "ArrowDown");
  await key("home-search-location", "Enter");
  assert.equal(await evaluate("document.getElementById('home-search-location').value"), "Dagupan City, Pangasinan");
  await evaluate("[...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Find vehicles').click()");
  await wait("document.getElementById('vehicle-market-search')");
  await wait("document.querySelector('.rp-vehicle-search__control .rp-search-hint')");
  assert.equal(await evaluate("document.querySelector('.rp-vehicle-search__control .rp-search-hint').textContent"), "Toyota Vios 1.3");
  await wait("document.querySelector('.rp-vehicle-search__control .rp-search-hint').dataset.phase === 'delete' && document.querySelector('.rp-vehicle-search__control .rp-search-hint').textContent.length < 15");
  const deletingVehicle = await evaluate("document.querySelector('.rp-vehicle-search__control .rp-search-hint').textContent");
  assert.equal("Toyota Vios 1.3".startsWith(deletingVehicle), true);
  await wait(`document.querySelector('.rp-vehicle-search__control .rp-search-hint').textContent.length < ${deletingVehicle.length}`);
  await wait("document.querySelector('.rp-vehicle-search__control .rp-search-hint').textContent === 'Honda Civic'");
  await clickSelector("#vehicle-market-search");
  await wait("document.querySelectorAll('#vehicle-search-options [role=option]').length === 3");
  assert.equal(await evaluate("document.getElementById('vehicle-market-search').getAttribute('aria-expanded')"), "true");
  await key("vehicle-market-search", "Escape");
  assert.equal(await evaluate("document.getElementById('vehicle-market-search').getAttribute('aria-expanded')"), "false");
  await setInput("vehicle-market-search", "Vios");
  await wait("document.querySelectorAll('#vehicle-search-options [role=option]').length === 1");
  await key("vehicle-market-search", "ArrowDown");
  await key("vehicle-market-search", "Enter");
  await wait("document.querySelector('.rp-modal-layer h3')?.textContent === 'Toyota Vios 1.3'");
  assert.equal(await evaluate("document.getElementById('vehicle-market-search').value"), "Vios");
  await evaluate("document.querySelector('.rp-modal-layer button[aria-label=\"Close vehicle preview\"]').click()");
  await clickSelector("#vehicle-market-search");
  await setInput("vehicle-market-search", "");
  await clickSelector("#vehicle-results-heading");
  await wait("document.querySelector('.rp-vehicle-search__control .rp-search-hint')");
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await wait("document.querySelector('.rp-vehicle-search__control .rp-search-hint').dataset.phase === 'static'");
  const reducedHint = await evaluate("document.querySelector('.rp-vehicle-search__control .rp-search-hint').textContent");
  await pause(5000);
  assert.equal(await evaluate("document.querySelector('.rp-vehicle-search__control .rp-search-hint').textContent"), reducedHint);
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
  for (const width of [1440, 768, 390, 360]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: width < 768 });
    await clickSelector("#vehicle-market-search");
    await wait("document.querySelector('#vehicle-search-options')");
    assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true, `Overflow at ${width}px`);
    assert.equal(await evaluate("(() => { const rect = document.querySelector('#vehicle-search-options').getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth; })()"), true, `Suggestion menu overflow at ${width}px`);
    if (width === 1440 || width === 390) await capture(`search-suggestions-${width}`);
    if (width === 390) {
      await clickSelector("#vehicle-search-option-1");
      await wait("document.querySelector('.rp-modal-layer h3')?.textContent === 'Honda Civic'");
      await evaluate("document.querySelector('.rp-modal-layer button[aria-label=\"Close vehicle preview\"]').click()");
    } else {
      await clickSelector("#vehicle-results-heading");
    }
  }
  assert.deepEqual(errors, []);
  console.log("Search suggestions passed: animated city and province homepage hint, typed location and vehicle choices, vehicle hint motion, keyboard behavior, and responsive widths.");
} finally {
  ws.close();
}
