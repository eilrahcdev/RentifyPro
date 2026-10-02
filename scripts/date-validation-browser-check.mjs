// Preview: 4176; isolated Chrome CDP: 9236. All API responses are fixtures.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const base = "http://127.0.0.1:4176";
const target = await (await fetch("http://127.0.0.1:9236/json/new?about:blank", { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let sequence = 0;
const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence; pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const vehicle = { _id: "507f1f77bcf86cd799439014", name: "Date validation fixture", location: "Manila", hourlyRentalRate: 250, pricingUnit: "hourly", availabilityStatus: "available", images: [], reviews: [], specs: { type: "Car", transmission: "Automatic", seats: 5 }, owner: { _id: "507f1f77bcf86cd799439013", name: "Fixture Owner" } };
async function route({ requestId, request }) {
  const url = new URL(request.url);
  let body;
  if (url.pathname.startsWith("/api/")) body = url.pathname === `/api/vehicles/${vehicle._id}` ? { vehicle } : { success: true, user: null, vehicles: [vehicle], reviews: [], photos: [], notifications: [], bookings: [], unreadCount: 0 };
  else if (url.hostname === "psgc.gitlab.io") body = [];
  else if (url.origin === base) return send("Fetch.continueRequest", { requestId });
  else return send("Fetch.failRequest", { requestId, errorReason: "Aborted" });
  return send("Fetch.fulfillRequest", { requestId, responseCode: request.method !== 'OPTIONS' && url.pathname === '/api/auth/me' ? 401 : 200, responseHeaders: [{ name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: base }, { name: "Access-Control-Allow-Credentials", value: "true" }, { name: "Access-Control-Allow-Headers", value: "content-type" }, { name: "Access-Control-Allow-Methods", value: "GET,POST,OPTIONS" }], body: Buffer.from(JSON.stringify(body)).toString("base64") });
}
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const call = pending.get(message.id); pending.delete(message.id);
    if (message.error) call?.reject(new Error(message.error.message)); else call?.resolve(message.result);
  } else if (message.method === "Fetch.requestPaused") route(message.params).catch(error => { if (!/Invalid InterceptionId|Target closed/.test(error.message)) errors.push(error.message); });
  else if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text);
};
const evaluate = async expression => {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result?.value;
};
const wait = async expression => {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await evaluate(`Boolean(${expression})`).catch(() => false)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${expression}\n${await evaluate('document.body.innerText.slice(-1800)')}`);
};
const setValue = (selector, value) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
try {
  await send("Page.enable"); await send("Runtime.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "http*" }] });
  for (const width of [1440, 768, 390]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 });
    await send("Page.navigate", { url: `${base}/register` });
    await wait("document.querySelector('input[type=date]')");
    const cutoff = await evaluate(`(() => { const t=new Date(); const y=t.getFullYear()-18; const m=t.getMonth(); const d=Math.min(t.getDate(),new Date(y,m+1,0).getDate()); return y+'-'+String(m+1).padStart(2,'0')+'-'+String(d).padStart(2,'0'); })()`);
    const earliest = await evaluate(`(() => { const t=new Date(); const y=t.getFullYear()-101; const m=t.getMonth(); const d=Math.min(t.getDate(),new Date(y,m+1,0).getDate()); const e=new Date(y,m,d+1); return e.getFullYear()+'-'+String(e.getMonth()+1).padStart(2,'0')+'-'+String(e.getDate()).padStart(2,'0'); })()`);
    assert.equal(await evaluate("document.querySelector('input[type=date]').max"), cutoff);
    assert.equal(await evaluate("document.querySelector('input[type=date]').min"), earliest);
    await setValue("input[type=date]", "1900-01-01");
    assert.equal(await evaluate("document.querySelector('input[type=date]').validity.rangeUnderflow"), true);
    await setValue("input[type=date]", "2020-01-01");
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(await evaluate("document.querySelector('input[type=date]').validity.rangeOverflow"), true);
    await evaluate("document.querySelector('input[type=date]').dispatchEvent(new FocusEvent('focusout', {bubbles:true}))");
    await wait("document.body.innerText.includes('under 18')");
    await setValue("input[type=date]", cutoff);
    assert.equal(await evaluate("document.querySelector('input[type=date]').checkValidity()"), true);
    assert.ok(await evaluate("document.documentElement.scrollWidth <= innerWidth + 1"));
    await send("Page.navigate", { url: `${base}/vehicle-details?vehicleId=${vehicle._id}` });
    await wait("document.querySelector('input[aria-label=\"Pickup date\"]')");
    await setValue('input[aria-label="Pickup date"]', "2030-12-31");
    await setValue('input[aria-label="Pickup time"]', "23:30");
    await wait("document.querySelector('input[aria-label=\"Return date\"]').min === '2031-01-01'");
    await setValue('input[aria-label="Return date"]', "2031-01-01");
    assert.equal(await evaluate("document.querySelector('input[aria-label=\"Return time\"]').min"), "00:30");
    const bookingMax = await evaluate(`(() => { const t=new Date(); const last=new Date(t.getFullYear(),t.getMonth()+7,0).getDate(); const d=new Date(t.getFullYear(),t.getMonth()+6,Math.min(t.getDate(),last)); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); })()`);
    for (const label of ["Pickup date", "Return date"]) assert.equal(await evaluate(`document.querySelector('input[aria-label="${label}"]').max`), bookingMax);
    assert.ok(await evaluate("document.documentElement.scrollWidth <= innerWidth + 1"));
    if (width !== 768) {
      await evaluate("document.querySelector('input[aria-label=\"Pickup date\"]').closest('section').scrollIntoView({block:'center', behavior:'instant'})");
      const shot = await send("Page.captureScreenshot", { format: "png" });
      await fs.writeFile(`.date-validation-${width}.png`, Buffer.from(shot.data, "base64"));
    }
    console.log(`${width}px: age 18-100 bounds, inline age error, six-month booking bounds, midnight return and layout passed`);
  }
  assert.deepEqual(errors, []);
} finally {
  await send("Page.close").catch(() => {}); ws.close();
}
