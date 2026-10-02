// Fixture-only browser verification. Preview :4176; isolated Chrome CDP :9236.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const base = "http://127.0.0.1:4176";
const target = await (await fetch("http://127.0.0.1:9236/json/new?about:blank", { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => { ws.onopen = resolve; });
let sequence = 0, role = "owner", uploadState = "needs_review", serverValidationPending = true, saved = 0, updated = 0, uploaded = 0, reviewed = 0;
const pending = new Map(), errors = [];
const photo = { id: "507f1f77bcf86cd799439099", vehicleType: "car", exterior: true, status: "needs_review", reason: "Awaiting administrator review." };
let ownerVehicles = [];
const listedVehicle = { _id: "507f1f77bcf86cd799439088", name: "Honda Civic", description: "A clean comfortable sedan with air conditioning and room for four passengers.", dailyRentalRate: 250.5, location: "Dagupan City, Pangasinan", availabilityStatus: "available", images: ["/uploads/vehicles/fixture.webp"], imagePaths: ["uploads/vehicles/fixture.webp"], coverImagePath: "uploads/vehicles/fixture.webp", specs: { type: "car", subType: "Sedan", seats: 5, transmission: "Automatic", fuel: "Gasoline", plateNumber: "ABC-1234" }, lateReturnPolicy: { feeType: "percentage", value: 25, graceMinutes: 0 } };
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fulfill = (requestId, body, code = 200) => send("Fetch.fulfillRequest", { requestId, responseCode: code, responseHeaders: [
  { name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: base },
  { name: "Access-Control-Allow-Credentials", value: "true" }, { name: "Access-Control-Allow-Headers", value: "content-type" },
  { name: "Access-Control-Allow-Methods", value: "GET,POST,PATCH,PUT,OPTIONS" },
], body: Buffer.from(JSON.stringify(body)).toString("base64") });
async function route({ requestId, request }) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return send("Fetch.continueRequest", { requestId });
  if (request.method === "OPTIONS") return fulfill(requestId, {});
  if (url.pathname === "/api/auth/me" || url.pathname === "/api/auth/profile") return fulfill(requestId, { user: { _id: "507f1f77bcf86cd799439011", name: "Listing Owner", role, isVerified: true, kycStatus: "approved" } });
  if (url.pathname === "/api/vehicle-photos") {
    if (request.method === "POST") { uploaded++; photo.status = uploadState; return fulfill(requestId, { photo }); }
    return fulfill(requestId, { photos: uploaded || role === "admin" ? [photo] : [] });
  }
  if (url.pathname === `/api/vehicle-photos/${photo.id}` && request.method === "PATCH") {
    const decision = JSON.parse(request.postData);
    assert.equal(decision.status, "approved"); assert.equal(decision.exterior, true); assert.ok(decision.reason.length >= 5);
    reviewed++; Object.assign(photo, decision); return fulfill(requestId, { photo });
  }
  if (url.pathname.endsWith("/file")) return send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "image/png" }, { name: "Access-Control-Allow-Origin", value: base }, { name: "Access-Control-Allow-Credentials", value: "true" }], body: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=" });
  if (url.pathname === "/api/owner/vehicles" && request.method === "POST") {
    if (serverValidationPending) {
      serverValidationPending = false;
      return fulfill(requestId, { success: false, message: "Validation failed.", errors: { description: "Add a more specific vehicle description." } }, 400);
    }
    saved++; assert.ok(request.postData.includes('name="approvedImageIds"')); assert.ok(request.postData.includes(photo.id));
    assert.equal(request.postData.includes('name="images"'), false);
    ownerVehicles = [listedVehicle];
    return fulfill(requestId, { success: true });
  }
  if (url.pathname === "/api/owner/vehicles" && request.method === "GET") return fulfill(requestId, { success: true, vehicles: ownerVehicles });
  if (url.pathname === `/api/owner/vehicles/${listedVehicle._id}` && request.method === "PUT") {
    updated++; assert.ok(request.postData.includes('name="specType"\r\n\r\nmotorcycle'));
    assert.ok(request.postData.includes('name="existingImages"'));
    return fulfill(requestId, { success: true });
  }
  return fulfill(requestId, { success: true, vehicles: [], customers: [], documents: [], bookings: [], notifications: [], conversations: [], unreadCount: 0, stats: {}, summary: {} });
}
ws.onmessage = (event) => {
  const m = JSON.parse(event.data);
  if (m.id) { const call = pending.get(m.id); pending.delete(m.id); m.error ? call?.reject(new Error(m.error.message)) : call?.resolve(m.result); }
  else if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  else if (m.method === "Fetch.requestPaused") route(m.params).catch((error) => errors.push(error.message));
};
const evaluate = async (expression) => { const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result?.value; };
const wait = async (expression) => { for (let i = 0; i < 200; i++) { if (await evaluate(`Boolean(${expression})`)) return; await pause(80); } throw new Error(`Timeout: ${expression}`); };
const set = (id, value) => evaluate(`(() => { const input = document.getElementById(${JSON.stringify(id)}); Object.getOwnPropertyDescriptor(input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', {bubbles:true})); })()`);
const click = (text) => evaluate(`[...(document.querySelector('dialog[open]') || document.querySelector('[role=dialog]') || document).querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}).click()`);
const checkSuccessAlert = async (message) => {
  await wait(`document.querySelector('.rp-floating-alert')?.textContent.includes(${JSON.stringify(message)})`);
  assert.equal(await evaluate(`(() => { const el=document.querySelector('.rp-floating-alert'); const r=el.getBoundingClientRect(); return r.top >= 0 && r.top < 180 && el.querySelectorAll('svg').length === 0; })()`), true);
  assert.equal(await evaluate("Boolean(document.querySelector('dialog[open], [role=dialog]'))"), false);
};

try {
  await send("Page.enable"); await send("Runtime.enable"); await send("Page.bringToFront"); await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
  await send("Page.navigate", { url: `${base}/owner-dashboard?tab=Vehicles` });
  await wait("document.body.innerText.includes('Manage vehicle details')");
  await evaluate("window.dispatchEvent(new Event('open-add-vehicle'))");
  await wait("document.getElementById('owner-vehicle-description')");
  assert.equal(await evaluate("[...document.querySelector('[role=dialog]').querySelectorAll('button')].find(b => b.textContent.trim() === 'Add Vehicle').disabled"), true);
  assert.equal(await evaluate("document.getElementById('owner-vehicle-description').maxLength"), 2000);
  await set("owner-vehicle-name", "  Honda   Civic 🚗 @ RS");
  assert.equal(await evaluate("document.getElementById('owner-vehicle-name').value"), "Honda Civic RS");
  await set("owner-vehicle-location", "  Dagupan   City 🌴 # Pangasinan");
  assert.equal(await evaluate("document.getElementById('owner-vehicle-location').value"), "Dagupan City Pangasinan");
  assert.equal(await evaluate("document.getElementById('owner-vehicle-specPlateNumber').maxLength"), 8);
  await set("owner-vehicle-specPlateNumber", "ABCD-1234");
  assert.equal(await evaluate("document.getElementById('owner-vehicle-specPlateNumber').value"), "ABCD-123");
  await evaluate(`(() => { const select=[...document.querySelectorAll('select')].find(item => [...item.options].some(option => option.value === 'motorcycle')); const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; setter.call(select,'motorcycle'); select.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await wait("document.getElementById('owner-vehicle-specPlateNumber').maxLength === 7");
  await set("owner-vehicle-specPlateNumber", "ABC-1234");
  assert.equal(await evaluate("document.getElementById('owner-vehicle-specPlateNumber').value"), "ABC-123");
  await evaluate(`(() => { const select=[...document.querySelectorAll('select')].find(item => [...item.options].some(option => option.value === 'motorcycle')); const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; setter.call(select,'car'); select.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await wait("document.getElementById('owner-vehicle-specPlateNumber').maxLength === 8");
  await set("owner-vehicle-description", "Too short");
  await evaluate("document.getElementById('owner-vehicle-description').focus(); document.getElementById('owner-vehicle-description').blur()");
  assert.equal(await evaluate("document.getElementById('owner-vehicle-description').getAttribute('aria-invalid')"), "true");
  assert.equal(await evaluate("document.getElementById('owner-vehicle-description').className.includes('border-red-300')"), true);
  assert.ok(await evaluate("document.getElementById('owner-vehicle-description-help').textContent.includes('30')"));
  for (const width of [1440, 768, 390]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 950, deviceScaleFactor: 1, mobile: false }); await pause(200);
    assert.equal(await evaluate("document.documentElement.scrollWidth > innerWidth"), false);
    await evaluate("document.getElementById('owner-vehicle-description').scrollIntoView({block:'center'})");
    const shot = await send("Page.captureScreenshot", { format: "png" });
    await fs.mkdir("frontend/.vite", { recursive: true });
    await fs.writeFile(`frontend/.vite/vehicle-listing-${width}.png`, Buffer.from(shot.data, "base64"));
  }
  for (const [field, value] of Object.entries({ name: "Honda Civic", description: "A clean comfortable sedan with air conditioning and room for four passengers.", location: "Dagupan City, Pangasinan", dailyRentalRate: "250.50", specSubType: "Sedan", specPlateNumber: "ABC-1234" })) await set(`owner-vehicle-${field}`, value);
  await evaluate(`new Promise(resolve => { const c = document.createElement('canvas'); c.width=400; c.height=300; c.toBlob(blob => { const dt = new DataTransfer(); dt.items.add(new File([blob], 'fixture.png', {type:'image/png'})); const input=document.querySelector('input[type=file]'); input.files=dt.files; input.dispatchEvent(new Event('change',{bubbles:true})); resolve(); }, 'image/png'); })`);
  await wait("![...document.querySelector('[role=dialog]').querySelectorAll('button')].find(b => b.textContent.trim() === 'Add Vehicle').disabled");
  await click("Add Vehicle");
  await wait("document.getElementById('owner-vehicle-images').getAttribute('aria-invalid') === 'true'");
  assert.equal(await evaluate("document.getElementById('owner-vehicle-images').className.includes('border-red-400')"), true);
  assert.ok(await evaluate("document.getElementById('owner-vehicle-images-help').textContent.includes('Awaiting administrator review.')"));
  assert.equal(await evaluate("document.activeElement.id"), "owner-vehicle-images");
  assert.equal(await evaluate("[...document.querySelector('[role=dialog]').querySelectorAll('button')].find(b => b.textContent.trim() === 'Add Vehicle').disabled"), true);
  await pause(500);
  assert.equal(await evaluate("(() => { const r=document.getElementById('owner-vehicle-images').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })()"), true);
  const inlineErrorShot = await send("Page.captureScreenshot", { format: "png" });
  await fs.writeFile("frontend/.vite/vehicle-listing-inline-photo-error.png", Buffer.from(inlineErrorShot.data, "base64"));
  assert.equal(saved, 0); assert.equal(uploaded, 1);
  photo.status = "approved"; photo.reason = "Clear exterior vehicle photo.";
  await click("Refresh reviews");
  await wait("document.getElementById('owner-vehicle-images').getAttribute('aria-invalid') === 'false'");
  await wait("![...document.querySelector('[role=dialog]').querySelectorAll('button')].find(b => b.textContent.trim() === 'Add Vehicle').disabled");
  await click("Add Vehicle");
  await wait("document.getElementById('owner-vehicle-description').getAttribute('aria-invalid') === 'true'");
  assert.ok(await evaluate("document.getElementById('owner-vehicle-description-help').textContent.includes('Add a more specific vehicle description.')"));
  assert.equal(await evaluate("document.activeElement.id"), "owner-vehicle-description");
  assert.equal(saved, 0);
  await set("owner-vehicle-description", "A clean comfortable sedan with air conditioning, safety features, and room for four passengers.");
  await wait("document.getElementById('owner-vehicle-description').getAttribute('aria-invalid') === 'false'");
  await click("Add Vehicle");
  await checkSuccessAlert("Honda Civic was added successfully and is now in your vehicle list.");
  await fs.writeFile("frontend/.vite/vehicle-listing-create-alert-mobile.png", Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  assert.equal(saved, 1); assert.equal(uploaded, 1);
  await wait("document.querySelector('[aria-label=\"Edit Honda Civic\"]')");
  await pause(3200);
  assert.equal(await evaluate("Boolean(document.querySelector('.rp-floating-alert'))"), false);
  await evaluate("document.querySelector('[aria-label=\"Edit Honda Civic\"]').click()");
  await wait("document.body.innerText.includes('Edit vehicle listing')");
  await evaluate(`(() => { const select=[...document.querySelectorAll('select')].find(item => [...item.options].some(option => option.value === 'motorcycle')); const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; setter.call(select,'motorcycle'); select.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await wait("document.getElementById('owner-vehicle-specSeats').getAttribute('aria-invalid') === 'true'");
  assert.equal(await evaluate("document.getElementById('owner-vehicle-specPlateNumber').getAttribute('aria-invalid')"), "true");
  assert.equal(await evaluate("[...document.querySelector('[role=dialog]').querySelectorAll('button')].find(b => b.textContent.trim() === 'Save Changes').disabled"), true);
  assert.ok(await evaluate("document.body.innerText.includes('Existing photos will be checked against the motorcycle category')"));
  await set("owner-vehicle-specSeats", "2"); await set("owner-vehicle-specPlateNumber", "ABC-123");
  await wait("![...document.querySelector('[role=dialog]').querySelectorAll('button')].find(b => b.textContent.trim() === 'Save Changes').disabled");
  await click("Save Changes");
  await wait("document.querySelector('dialog[open]')?.innerText.includes('Save vehicle changes?')");
  assert.equal(updated, 0);
  await click("Save Changes");
  await checkSuccessAlert("Honda Civic was updated successfully.");
  await fs.writeFile("frontend/.vite/vehicle-listing-edit-alert-mobile.png", Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  assert.equal(updated, 1);
  console.log("Owner: inline errors, create/edit success alerts, edit confirmation, category-dependent validation, and valid submissions passed.");
  role = "admin"; photo.status = "needs_review";
  await send("Page.navigate", { url: `${base}/admin-dashboard` });
  await wait("[...document.querySelectorAll('button')].find(b => b.textContent.trim()==='Vehicles')");
  await click("Vehicles"); await wait("document.querySelector('textarea[name=reason]')");
  await evaluate(`(() => { const t=document.querySelector('textarea[name=reason]'); t.value='Clear exterior of the listed vehicle'; document.querySelector('input[name=exterior]').checked=true; })()`);
  await click("Approve"); await pause(300); assert.equal(reviewed, 1);
  assert.deepEqual(errors, []);
  console.log("Admin: manual approval submits reason and exterior eligibility; no runtime exceptions.");
} catch (error) {
  console.error(await evaluate("document.body.innerText"));
  console.error(errors);
  throw error;
} finally { await send("Page.close").catch(() => {}); ws.close(); }
