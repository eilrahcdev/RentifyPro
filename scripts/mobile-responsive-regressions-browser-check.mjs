// Isolated browser fixtures only; no real accounts, security challenges, or chat services.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const base = process.env.RESPONSIVE_BASE_URL || "http://127.0.0.1:4189";
const cdp = process.env.RESPONSIVE_CDP_URL || "http://127.0.0.1:9249";
const output = await fs.mkdtemp(path.join(os.tmpdir(), "rentifypro-mobile-regressions-"));
const target = await (await fetch(`${cdp}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const pending = new Map(), checks = [], failures = [], errors = [];
let sequence = 0, authenticated = true, challengeRequests = 0, chatRequests = 0;
const user = { _id: "507f1f77bcf86cd799439011", name: "Fixture Renter", email: "renter@example.test", role: "user", isVerified: true, kycStatus: "approved" };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 15000);
  pending.set(id, {
    resolve: result => { clearTimeout(timer); resolve(result); },
    reject: error => { clearTimeout(timer); reject(error); },
  });
  ws.send(JSON.stringify({ id, method, params }));
});
const fulfill = (requestId, body, responseCode = 200) => send("Fetch.fulfillRequest", {
  requestId, responseCode,
  responseHeaders: [
    { name: "Content-Type", value: "application/json" },
    { name: "Access-Control-Allow-Origin", value: base },
    { name: "Access-Control-Allow-Credentials", value: "true" },
    { name: "Access-Control-Allow-Headers", value: "content-type,x-pre-kyc-token,x-registration-draft" },
    { name: "Access-Control-Allow-Methods", value: "GET,POST,PATCH,PUT,DELETE,OPTIONS" },
  ], body: Buffer.from(JSON.stringify(body)).toString("base64"),
});
async function route({ requestId, request }) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) {
    if (request.method === "OPTIONS") return fulfill(requestId, {});
    if (["/api/auth/me", "/api/auth/profile"].includes(url.pathname)) {
      return authenticated ? fulfill(requestId, { user }) : fulfill(requestId, { message: "Synthetic signed-out session" }, 401);
    }
    if (url.pathname === "/api/kyc/me") return fulfill(requestId, { status: "approved", verification: {
      accountStatus: "active", emailVerified: true, bookingEligible: true, listingEligible: false, documents: [],
    } });
    if (url.pathname === "/api/auth/login-challenge") {
      challengeRequests += 1;
      return fulfill(requestId, { challengeId: `fixture-${challengeRequests}`, question: "2 + 3" });
    }
    if (url.pathname === "/api/chat") {
      chatRequests += 1;
      return fulfill(requestId, { reply: "Synthetic layout reply", recommendations: [] });
    }
    if (request.method !== "GET") return fulfill(requestId, { message: "No live mutations in this layout fixture." }, 503);
    return fulfill(requestId, { vehicles: [], bookings: [], notifications: [], conversations: [], unreadCount: 0, stats: {}, summary: {} });
  }
  if (url.pathname.startsWith("/socket.io/")) return send("Fetch.failRequest", { requestId, errorReason: "Aborted" });
  if (url.origin === base) return send("Fetch.continueRequest", { requestId });
  return send("Fetch.failRequest", { requestId, errorReason: "Aborted" });
}
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const call = pending.get(message.id); pending.delete(message.id);
    if (message.error) call?.reject(Error(message.error.message)); else call?.resolve(message.result);
  } else if (message.method === "Fetch.requestPaused") route(message.params).catch(error => {
    if (!/Invalid InterceptionId|Target closed/.test(error.message)) errors.push(error.message);
  });
  else if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
};
const evaluate = async expression => {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
};
async function wait(expression) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { if (await evaluate(`Boolean(${expression})`)) return; await pause(60); }
  throw Error(`Timeout: ${expression}`);
}
const expect = (condition, message) => { if (!condition) failures.push(message); };
async function viewport(width, height) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 1024 });
  await send("Emulation.setTouchEmulationEnabled", { enabled: width < 1024, maxTouchPoints: 5 });
  await pause(120);
}
async function open(url, signedIn = true) {
  authenticated = signedIn;
  await send("Page.navigate", { url: "about:blank" });
  await send("Storage.clearDataForOrigin", { origin: base, storageTypes: "all" });
  await send("Page.navigate", { url: base + url });
  await wait(url === "/signin" ? "document.querySelector('input[placeholder=\"?\"]') && !document.querySelector('input[placeholder=\"?\"]').disabled"
    : "document.querySelector('.rp-site-navbar__menu-trigger') && !document.querySelector('[aria-label=\"Loading your account\"]')");
  await evaluate("document.fonts.ready");
}
async function screenshot(name) {
  const shot = await send("Page.captureScreenshot", { format: "png" });
  await fs.writeFile(path.join(output, `${name}.png`), Buffer.from(shot.data, "base64"));
}
const input = (selector, value) => evaluate(`(() => {
  const element = document.querySelector(${JSON.stringify(selector)});
  const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, ${JSON.stringify(value)});
  element.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
async function click(selector) {
  const point = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({ block: 'nearest' });
    const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
}

try {
  await send("Page.enable"); await send("Runtime.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "http*" }] });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  for (const signedIn of [false, true]) for (const [width, height] of [[320,568],[390,844],[667,375],[844,390],[768,1024]]) {
    await viewport(width, height); await open("/", signedIn);
    await evaluate("document.querySelector('.rp-ai-launcher-dismiss')?.click()");
    await click(".rp-site-navbar__menu-trigger");
    await wait("document.querySelector('button[aria-label=\"Close menu backdrop\"]')");
    const menu = await evaluate(`(() => { const p = document.querySelector('button[aria-label="Close menu backdrop"]').nextElementSibling;
      const r = p.getBoundingClientRect(), list = p.lastElementChild, l = list.getBoundingClientRect();
      const blocked = [...list.querySelectorAll('button')].filter(b => {const a=b.getBoundingClientRect();
        if(a.top<l.top||a.bottom>l.bottom)return false;const hit=document.elementFromPoint(a.left+a.width/2,a.top+a.height/2);return !b.contains(hit);
      }).map(b=>b.textContent.trim());
      return { top:r.top,bottom:r.bottom,blocked,scrollable:list.scrollHeight>list.clientHeight+1,
        scrollHeight:list.scrollHeight,clientHeight:list.clientHeight,x:l.left+l.width/2,y:l.top+l.height/2 }; })()`);
    expect(menu.top >= 0 && menu.bottom <= height, `Navigation cut off at ${width}x${height}, signedIn=${signedIn}`);
    expect(menu.blocked.length === 0, `Navigation covered at ${width}x${height}: ${menu.blocked.join(", ")}`);
    if (menu.scrollable && menu.y < height) {
      await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: menu.x, y: menu.y, deltaX: 0, deltaY: 1000 });
      await pause(180);
    }
    const last = await evaluate(`(() => {const p=document.querySelector('button[aria-label="Close menu backdrop"]').nextElementSibling;
      const list=p.lastElementChild,b=list.querySelector('button:last-child'),r=b.getBoundingClientRect(),l=list.getBoundingClientRect();
      const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
      return {fits:r.top>=l.top-1&&r.bottom<=Math.min(l.bottom,innerHeight)+1,hit:b.contains(hit),scrollTop:list.scrollTop};})()`);
    expect(last.fits && last.hit, `Last navigation action unreachable at ${width}x${height}, signedIn=${signedIn}`);
    if (menu.scrollable) expect(last.scrollTop > 0, `Navigation does not scroll at ${width}x${height}`);
    if (width === 667) await screenshot(`navigation-${signedIn ? "renter" : "guest"}-${width}x${height}`);
    await click('button[aria-label="Close menu backdrop"] + div button[aria-label="Close menu"]');
    await wait("!document.querySelector('button[aria-label=\"Close menu backdrop\"]')");
    expect(await evaluate("document.body.style.overflow !== 'hidden' && Boolean(document.querySelector('.rp-ai-launcher-button'))"), "Closing navigation must restore scrolling and the AI entry");
    checks.push(`Navigation ${signedIn ? "renter" : "guest"} ${width}x${height}`);
  }

  for (const width of [320,390,768,1440]) for (const textSize of [100,200]) {
    await viewport(width, 900); await open("/signin", false);
    await evaluate(`document.documentElement.style.fontSize='${textSize}%'`); await pause(120);
    const size = await evaluate(`(() => {const f=document.querySelector('form'),content=document.querySelector('.rp-auth-content');
      const field=document.querySelector('input[placeholder="?"]'),r=field.getBoundingClientRect(),form=f.getBoundingClientRect();
      return {fits:r.left>=form.left&&r.right<=form.right&&r.left>=0&&r.right<=innerWidth,
        overflow:content.scrollWidth>content.clientWidth+1||f.scrollWidth>f.clientWidth+1,
        field:{left:r.left,right:r.right},form:{left:form.left,right:form.right,client:f.clientWidth,scroll:f.scrollWidth},
        content:{client:content.clientWidth,scroll:content.scrollWidth}};})()`);
    expect(size.fits && !size.overflow, `Security answer clipped at ${width}px with ${textSize}% text: ${JSON.stringify(size)}`);
    await input('input[placeholder="?"]', "5");
    const before = challengeRequests;
    await click('button[aria-label="Refresh security check"]');
    await wait('document.querySelector(\'input[placeholder="?"]\').disabled === false');
    expect(challengeRequests === before + 1, "Security refresh must still request a new challenge");
    if (width === 390 && textSize === 200) await screenshot("security-check-200percent");
    checks.push(`Sign-in ${width}px ${textSize}% text`);
  }

  await viewport(390, 844); await open("/", false);
  await click(".rp-ai-launcher-button");
  await wait("document.querySelector('.rp-ai-chat-dialog')");
  expect(chatRequests === 0, "Opening the assistant must not send a message");
  for (const [width,height] of [[320,568],[390,844],[667,375],[844,390],[390,300],[320,300],[768,1024],[1440,900]]) {
    await viewport(width,height);
    const layout = await evaluate(`(() => {const d=document.querySelector('.rp-ai-chat-dialog'),r=d.getBoundingClientRect();
      return {fits:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,
        controls:['Start a new chatbot conversation','Close Rentify AI','Message Rentify AI','Send message'].map(label=>{
          const b=d.querySelector('[aria-label="'+label+'"]'),a=b.getBoundingClientRect();
          const hit=document.elementFromPoint(a.left+a.width/2,a.top+a.height/2);
          return {label,visible:a.top>=r.top&&a.bottom<=r.bottom&&a.left>=r.left&&a.right<=r.right&&b.contains(hit)};
        }),bodyHeight:d.querySelector('.rp-ai-chat-body').clientHeight};})()`);
    expect(layout.fits && layout.controls.every(control => control.visible), `Chat controls clipped at ${width}x${height}: ${JSON.stringify(layout.controls)}`);
    expect(layout.bodyHeight >= 40, `Chat has no usable message area at ${width}x${height}`);
    if (height === 300) await screenshot(`chat-${width}x${height}`);
    checks.push(`Chat ${width}x${height}`);
  }
  await viewport(390,300);
  await input('textarea[aria-label="Message Rentify AI"]', "Mobile layout test");
  await click('button[aria-label="Send message"]');
  await wait("document.querySelector('.rp-ai-chat-body').innerText.includes('Synthetic layout reply')");
  expect(chatRequests === 1, "The visible Send control must send exactly once");
  await click('button[aria-label="Start a new chatbot conversation"]');
  await wait("!document.querySelector('.rp-ai-chat-body').innerText.includes('Synthetic layout reply')");
  await click('button[aria-label="Close Rentify AI"]');
  await wait("!document.querySelector('.rp-ai-chat-dialog') && document.querySelector('.rp-ai-launcher-button')");
  checks.push("Short-screen Send, New chat, and Close actions");
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
} finally {
  await fs.writeFile(path.join(output,"results.json"),JSON.stringify({checks,failures,errors},null,2));
  console.log(JSON.stringify({checks:checks.length,failures,errors,output},null,2));
  await send("Page.close").catch(()=>{}); ws.close();
}
