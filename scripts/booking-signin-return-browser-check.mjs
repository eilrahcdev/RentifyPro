// Fixture browser check. Run Vite on 4183 and an isolated CDP browser on 9243.
// No real accounts, bookings, or payments are used.
import assert from "node:assert/strict";

const base = "http://127.0.0.1:4183";
const vehicleId = "507f1f77bcf86cd799439014";
const vehicle = {
  _id: vehicleId, name: "Return journey vehicle", location: "Dagupan City, Pangasinan",
  hourlyRentalRate: 250, dailyRentalRate: 250, pricingUnit: "hourly",
  availabilityStatus: "available", images: [], reviews: [],
  specs: { type: "Car", transmission: "Automatic", seats: 5 },
  owner: { _id: "507f1f77bcf86cd799439013", name: "Fixture Owner" },
};
const user = {
  _id: "507f1f77bcf86cd799439011", name: "Fixture Renter", email: "renter@gmail.com",
  role: "user", isVerified: true, kycStatus: "approved",
};
let signedIn = false;
let loginCalls = 0;
let sequence = 0;
const errors = [];
const pending = new Map();
const target = await (await fetch("http://127.0.0.1:9243/json/new?about:blank", { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const fulfill = (requestId, body, responseCode = 200) => send("Fetch.fulfillRequest", {
  requestId, responseCode,
  responseHeaders: [
    { name: "Content-Type", value: "application/json" },
    { name: "Access-Control-Allow-Origin", value: base },
    { name: "Access-Control-Allow-Credentials", value: "true" },
    { name: "Access-Control-Allow-Headers", value: "content-type" },
    { name: "Access-Control-Allow-Methods", value: "GET,POST,OPTIONS" },
  ],
  body: Buffer.from(JSON.stringify(body)).toString("base64"),
});
const route = ({ requestId, request }) => {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) {
    if (url.origin === base) return send("Fetch.continueRequest", { requestId });
    return send("Fetch.failRequest", { requestId, errorReason: "Aborted" });
  }
  if (request.method === "OPTIONS") return fulfill(requestId, {});
  if (url.pathname === "/api/auth/me") return signedIn
    ? fulfill(requestId, { user }) : fulfill(requestId, { message: "No session" }, 401);
  if (url.pathname === "/api/auth/login-challenge") {
    return fulfill(requestId, { challengeId: "fixture", question: "2 + 3" });
  }
  if (url.pathname === "/api/auth/login") {
    loginCalls += 1;
    signedIn = true;
    return fulfill(requestId, { success: true, user });
  }
  if (url.pathname === `/api/vehicles/${vehicleId}`) return fulfill(requestId, { vehicle });
  if (url.pathname === "/api/bookings/eligibility") return fulfill(requestId, {
    eligibility: { eligible: true, limits: { open: 3, pending: 2 }, counts: { open: 0, pending: 0 }, reasons: [] },
  });
  return fulfill(requestId, { success: true, vehicles: [vehicle], reviews: [], bookings: [], notifications: [] });
};
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const call = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) call?.reject(new Error(message.error.message));
    else call?.resolve(message.result);
  } else if (message.method === "Fetch.requestPaused") {
    route(message.params).catch((error) => {
      if (!/Invalid InterceptionId|Target closed/.test(error.message)) errors.push(error.message);
    });
  } else if (message.method === "Runtime.exceptionThrown") {
    errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  }
};
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
};
const wait = async (expression, timeout = 15000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await evaluate(`Boolean(${expression})`).catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${expression}\n${await evaluate("document.body.innerText.slice(-1200)")}`);
};
const setValue = (selector, value) => evaluate(`(() => {
  const input = document.querySelector(${JSON.stringify(selector)});
  if (!input) throw new Error('Missing input: ' + ${JSON.stringify(selector)});
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
})()`);

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "http*" }] });
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send("Page.navigate", { url: `${base}/vehicle-details?vehicleId=${vehicleId}` });
  await wait("[...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Sign In to Book')");
  const returnDate = await evaluate("(() => { const date = new Date(document.querySelectorAll('input[type=date]')[1].value + 'T12:00:00'); date.setDate(date.getDate() + 2); return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0'); })()");
  await evaluate(`(() => { const input = document.querySelectorAll('input[type=date]')[1]; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(returnDate)}); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await wait(`document.querySelectorAll('input[type=date]')[1].value === ${JSON.stringify(returnDate)}`);
  await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Sign In to Book').click()");
  await wait("location.pathname === '/signin'");
  assert.equal(await evaluate("JSON.parse(sessionStorage.getItem('rentifypro:booking-return')).vehicleId"), vehicleId);
  await send("Page.reload", { ignoreCache: true });
  await wait("location.pathname === '/signin' && document.querySelector('input[type=password]')");
  await setValue('input[type=email]', "renter@gmail.com");
  await setValue('input[type=password]', "Example123!");
  await setValue('input[inputmode=numeric]', "5");
  await evaluate("document.querySelector('form').requestSubmit()");
  await wait(`location.pathname === '/vehicle-details' && document.querySelector('h1')?.textContent === ${JSON.stringify(vehicle.name)}`, 20000);
  await wait("[...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Book Now')");
  assert.equal(await evaluate("document.querySelectorAll('input[type=date]')[1].value"), returnDate);
  assert.equal(await evaluate("sessionStorage.getItem('rentifypro:booking-return')"), null);
  assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true);

  signedIn = false;
  await send("Page.navigate", { url: `${base}/vehicles` });
  await wait("document.querySelector('.rp-market-grid') && [...document.querySelectorAll('.rp-market-grid button')].some(button => button.textContent.toLowerCase().includes('book now'))");
  await evaluate("[...document.querySelectorAll('.rp-market-grid button')].find(button => button.textContent.toLowerCase().includes('book now')).click()");
  await wait("document.body.innerText.includes('Bookings require an account')");
  await evaluate("[...document.querySelectorAll('.rp-modal-layer button')].find(button => button.textContent.trim() === 'Sign In').click()");
  await wait("location.pathname === '/signin' && document.querySelector('input[type=email]') && document.querySelector('input[inputmode=numeric]')");
  assert.equal(await evaluate("JSON.parse(sessionStorage.getItem('rentifypro:booking-return')).vehicleId"), vehicleId);
  await setValue('input[type=email]', "renter@gmail.com");
  await setValue('input[type=password]', "Example123!");
  await setValue('input[inputmode=numeric]', "5");
  await evaluate("document.querySelector('form').requestSubmit()");
  await wait(`location.pathname === '/vehicle-details' && document.querySelector('h1')?.textContent === ${JSON.stringify(vehicle.name)}`, 20000);
  assert.equal(await evaluate("sessionStorage.getItem('rentifypro:booking-return')"), null);
  assert.equal(loginCalls, 2);

  signedIn = false;
  await send("Page.navigate", { url: base });
  await wait("[...document.querySelectorAll('.rp-featured-carousel button')].some(button => button.textContent.toLowerCase().includes('book now'))");
  await evaluate("[...document.querySelectorAll('.rp-featured-carousel button')].find(button => button.textContent.toLowerCase().includes('book now')).click()");
  await wait("location.pathname === '/signin'");
  assert.equal(await evaluate("JSON.parse(sessionStorage.getItem('rentifypro:booking-return')).vehicleId"), vehicleId);
  assert.deepEqual(errors, []);
  console.log("Booking sign-in return passed: detail, listing, and featured entry; selected vehicle and dates through sign-in reload; mobile layout.");
} finally {
  await send("Page.close").catch(() => {});
  ws.close();
}
