// Run Vite on 4176 and isolated headless Chrome with CDP on 9236, then run with --experimental-websocket.
// API and address responses are fixtures; this check does not create accounts.
import assert from "node:assert/strict";

const base = "http://127.0.0.1:4176";
const target = await (await fetch("http://127.0.0.1:9236/json/new?about:blank", { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

let sequence = 0;
const pending = new Map();
const errors = [];
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const respond = (requestId, status, data) => send("Fetch.fulfillRequest", {
  requestId,
  responseCode: status,
  responseHeaders: [
    { name: "Content-Type", value: "application/json" },
    { name: "Access-Control-Allow-Origin", value: base },
    { name: "Access-Control-Allow-Credentials", value: "true" },
    { name: "Access-Control-Allow-Headers", value: "content-type" },
    { name: "Access-Control-Allow-Methods", value: "GET,POST,OPTIONS" },
  ],
  body: Buffer.from(JSON.stringify(data)).toString("base64"),
});
const handleRequest = async ({ requestId, request }) => {
  const url = new URL(request.url);
  if (url.hostname === "psgc.gitlab.io") {
    let data = [];
    if (url.pathname.endsWith("/regions/")) data = [{ code: "01", name: "Fixture Region" }];
    if (url.pathname.endsWith("/cities-municipalities/")) data = [{ code: "010101", name: "Fixture City" }];
    if (url.pathname.endsWith("/barangays/")) data = [{ code: "010101001", name: "Fixture Barangay" }];
    return respond(requestId, 200, data);
  }
  if (url.pathname.startsWith("/api/")) {
    if (request.method === "OPTIONS") return respond(requestId, 200, {});
    if (url.pathname === "/api/auth/me") return respond(requestId, 401, { message: "No session" });
    if (url.pathname === "/api/auth/check-registration-email") return respond(requestId, 200, { success: true, available: true });
    return respond(requestId, 200, { success: true, vehicles: [], notifications: [] });
  }
  if (url.origin === base) return send("Fetch.continueRequest", { requestId });
  return send("Fetch.failRequest", { requestId, errorReason: "Aborted" });
};
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const call = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) call?.reject(new Error(message.error.message));
    else call?.resolve(message.result);
  } else if (message.method === "Fetch.requestPaused") {
    handleRequest(message.params).catch(error => errors.push(error.message));
  } else if (message.method === "Runtime.exceptionThrown") {
    errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  }
};
const evaluate = async expression => {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
};
const wait = async expression => {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await evaluate(`Boolean(${expression})`).catch(() => false)) return;
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw new Error(`Timed out: ${expression}\n${await evaluate("document.body.innerText.slice(-1200)")}`);
};
const setInput = (selector, value) => evaluate(`(() => {
  const input = document.querySelector(${JSON.stringify(selector)});
  if (!input) throw Error('Missing input: ' + ${JSON.stringify(selector)});
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
const choose = (selector, value) => evaluate(`(() => {
  const select = document.querySelector(${JSON.stringify(selector)});
  if (!select) throw Error('Missing select: ' + ${JSON.stringify(selector)});
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, ${JSON.stringify(value)});
  select.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
const chooseOption = value => evaluate(`(() => {
  const select = [...document.querySelectorAll('select')].find(item => [...item.options].some(option => option.value === ${JSON.stringify(value)}));
  if (!select) throw Error('Missing option: ' + ${JSON.stringify(value)});
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, ${JSON.stringify(value)});
  select.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
const next = () => evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Next')?.click()`);
const inspectPrompts = () => evaluate(`(() => {
  const selects = [...document.querySelectorAll('select')];
  if (!selects.length) return { count: 0, valid: false };
  return { count: selects.length, valid: selects.every(select => {
    const option = select.options[0];
    return option.value === '' && option.disabled && option.hidden && (select.value !== '' || select.selectedOptions[0] === option);
  }) };
})()`);

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "http*" }] });
  for (const width of [390, 1200]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width === 390 });
    for (const role of ["owner", "renter"]) {
      await send("Page.navigate", { url: `${base}/${role === "owner" ? "register-owner" : "register"}` });
      await wait("document.querySelector('input[placeholder=\"Create Password\"]')");
      assert.equal(await evaluate("document.body.innerText.includes('Password Strength:')"), false);
      await setInput('input[placeholder="Create Password"]', "Example123!");
      await wait("document.body.innerText.includes('Password Strength:')");
      assert.equal(await evaluate("document.body.innerText.includes('Password Strength: Strong')"), true);
      await setInput('input[placeholder="Create Password"]', "Example123!abcd");
      await wait("document.body.innerText.includes('Password Strength: Very Strong')");
      assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true);

      await setInput('input[placeholder="Enter Email"]', `${role}@gmail.com`);
      await setInput('input[placeholder="9XXXXXXXXX"]', "9123456789");
      await setInput('input[placeholder="Confirm Password"]', "Example123!abcd");
      await next();
      await wait(role === "renter" ? "document.querySelector('select')" : "document.querySelector('input[name=\"firstName\"]')");
      if (role === "renter") {
        const prompts = await inspectPrompts();
        assert.equal(prompts.valid, true, "renter gender prompt is visible but unselectable");
        await setInput('input[placeholder="John"]', "Alice");
        await setInput('input[placeholder="Doe"]', "Example");
        await setInput('input[type="date"]', "1995-01-01");
        await choose("select", "Female");
        await wait("document.querySelector('select').value === 'Female'");
        await evaluate("document.querySelector('select').focus()");
        for (let index = 0; index < 2; index++) {
          await send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 });
          await send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 });
        }
        assert.notEqual(await evaluate("document.querySelector('select').value"), "", "keyboard cannot reselect the prompt");
      } else {
        await setInput('input[name="firstName"]', "Alice");
        await setInput('input[name="lastName"]', "Example");
        await setInput('input[name="businessName"]', "Example Transport");
        await setInput('input[name="permitNumber"]', "TEST123");
      }
      await new Promise(resolve => setTimeout(resolve, 2100));
      await next();
      await wait("document.querySelectorAll('select').length >= 4");
      const prompts = await inspectPrompts();
      assert.equal(prompts.valid, true, `${role} address prompts are visible but unselectable`);
      assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
      await choose("select", "01");
      await wait("[...document.querySelectorAll('select')].some(select => [...select.options].some(option => option.value === '010101'))");
      await chooseOption("010101");
      await wait("[...document.querySelectorAll('select')].some(select => [...select.options].some(option => option.value === '010101001'))");
      await chooseOption("010101001");
      if (role === "renter") {
        await setInput('input[placeholder="Maria Dela Cruz"]', "Bob Example");
        await setInput('input[placeholder="9XXXXXXXXX"]', "9987654321");
        await chooseOption("Friend");
      }
      await new Promise(resolve => setTimeout(resolve, 2100));
      await next();
      await wait(role === "owner" ? "document.querySelector('select[name=supportingDocType]')" : "[...document.querySelectorAll('select')].some(select => select.options[0]?.textContent === 'Select the ID type you uploaded')");
      const documentPrompt = await inspectPrompts();
      assert.equal(documentPrompt.valid, true, `${role} document type prompt is visible but unselectable`);
      console.log(`${role} ${width}px: password feedback and ${prompts.count} address dropdowns plus document type passed`);
    }
  }
  assert.deepEqual(errors, []);
} finally {
  ws.close();
  await fetch(`http://127.0.0.1:9236/json/close/${target.id}`).catch(() => {});
}
