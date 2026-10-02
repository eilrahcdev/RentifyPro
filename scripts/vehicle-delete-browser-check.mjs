// Fixture-only browser verification. Preview :4176; isolated Chrome CDP :9236.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const base = "http://127.0.0.1:4176";
const target = await (await fetch("http://127.0.0.1:9236/json/new?about:blank", { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => { ws.onopen = resolve; });
let sequence = 0, attempts = 0, nativeDialogs = 0;
let pendingDelete;
const vehicle = {_id:"507f1f77bcf86cd799439022", name:"Honda Civic", location:"Dagupan City", dailyRentalRate:1500, availabilityStatus:"available", images:[], specs:{type:"car", seats:4, transmission:"Automatic", fuel:"Gasoline"}};
const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fulfill = (requestId, body, code = 200) => send("Fetch.fulfillRequest", { requestId, responseCode: code, responseHeaders: [
  { name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: base },
  { name: "Access-Control-Allow-Credentials", value: "true" }, { name: "Access-Control-Allow-Headers", value: "content-type" },
  { name: "Access-Control-Allow-Methods", value: "GET,POST,PATCH,PUT,DELETE,OPTIONS" },
], body: Buffer.from(JSON.stringify(body)).toString("base64") });
async function route({ requestId, request }) {
  const path = new URL(request.url).pathname;
  if (request.method === "OPTIONS") return fulfill(requestId, {});
  if (path === "/api/auth/me" || path === "/api/auth/profile") return fulfill(requestId, {user:{_id:"507f1f77bcf86cd799439011",name:"Owner",role:"owner",isVerified:true,kycStatus:"approved"}});
  if (request.method === "DELETE") { attempts++; pendingDelete=requestId; return; }
  return fulfill(requestId,{success:true,vehicles:[vehicle],customers:[],documents:[],photos:[],bookings:[],notifications:[],conversations:[],unreadCount:0,stats:{},summary:{}});
}
ws.onmessage = (event) => {
  const m = JSON.parse(event.data);
  if (m.id) { const call = pending.get(m.id); pending.delete(m.id); m.error ? call?.reject(new Error(m.error.message)) : call?.resolve(m.result); }
  else if (m.method === "Page.javascriptDialogOpening") { nativeDialogs++; send("Page.handleJavaScriptDialog", {accept:false}); }
  else if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  else if (m.method === "Fetch.requestPaused") route(m.params).catch((error) => errors.push(error.message));
};
const evaluate = async (expression) => { const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result?.value; };
const wait = async (expression) => { for (let i = 0; i < 200; i++) { if (await evaluate(`Boolean(${expression})`)) return; await pause(80); } throw new Error(`Timeout: ${expression}`); };
const openDelete = async () => {
  await evaluate(`document.querySelector('[aria-label="Delete Honda Civic"]').focus(); document.querySelector('[aria-label="Delete Honda Civic"]').click()`);
  await wait("document.querySelector('dialog[open]')");
};
const modalClick = (label) => evaluate(`[...document.querySelector('dialog').querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`);
const escape = async () => {
  await send("Input.dispatchKeyEvent", {type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
  await send("Input.dispatchKeyEvent", {type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
};
try {
  await send("Page.enable"); await send("Runtime.enable"); await send("Fetch.enable",{patterns:[{urlPattern:"*/api/*"}]});
  await send("Page.navigate",{url:base+"/owner-dashboard?tab=Vehicles"});
  await wait(`document.querySelector('[aria-label="Delete Honda Civic"]')`);
  await openDelete();
  assert.equal(await evaluate("document.activeElement.textContent"),"Cancel");
  await modalClick("Cancel"); await wait("!document.querySelector('dialog[open]')");
  assert.equal(attempts,0);
  assert.equal(await evaluate("document.activeElement.getAttribute('aria-label')"),"Delete Honda Civic");
  await openDelete(); await escape();
  await wait("!document.querySelector('dialog[open]')"); assert.equal(attempts,0);
  await openDelete();
  for (const width of [1440,768,390]) {
    await send("Emulation.setDeviceMetricsOverride",{width,height:844,deviceScaleFactor:1,mobile:false}); await pause(150);
    assert.equal(await evaluate("document.documentElement.scrollWidth>innerWidth"),false);
    assert.equal(await evaluate("document.querySelector('dialog').scrollWidth>innerWidth"),false);
    const shot=await send("Page.captureScreenshot",{format:"png"});
    await fs.mkdir("frontend/.vite",{recursive:true});
    await fs.writeFile(`frontend/.vite/delete-confirmation-${width}.png`,Buffer.from(shot.data,"base64"));
  }
  await modalClick("Delete"); await wait("document.querySelector('dialog').getAttribute('aria-busy')==='true'");
  await pause(150); assert.equal(attempts,1);
  assert.equal(await evaluate("[...document.querySelector('dialog').querySelectorAll('button')].every(b=>b.disabled)"),true);
  await escape();
  assert.equal(await evaluate("Boolean(document.querySelector('dialog[open]'))"),true);
  await fulfill(pendingDelete,{message:"This vehicle has active bookings."},409);
  await wait("document.querySelector('[role=alert]')?.textContent.includes('active bookings')");
  assert.equal(await evaluate(`Boolean(document.querySelector('[aria-label="Delete Honda Civic"]'))`),true);
  await modalClick("Delete"); await pause(150); assert.equal(attempts,2);
  await fulfill(pendingDelete,{success:true});
  await wait("!document.querySelector('dialog[open]')");
  assert.equal(await evaluate(`Boolean(document.querySelector('[aria-label="Delete Honda Civic"]'))`),false);
  assert.equal(await evaluate("document.activeElement.getAttribute('aria-label')"),"Search your vehicles");
  assert.equal(nativeDialogs,0); assert.deepEqual(errors,[]);
  console.log("PASS: styled confirmation, Cancel/Escape/focus, busy protection, server error/retry, deletion, responsive 1440/768/390, no native popups/runtime exceptions (fixture API).");
} finally { await send("Page.close").catch(()=>{}); ws.close(); }
