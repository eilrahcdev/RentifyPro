// Preview: 4176; isolated Chrome CDP: 9236. All API responses are fixtures.
import assert from "node:assert/strict";

const base = "http://127.0.0.1:4176";
const expectedMessage = "The password you entered is incorrect. Please try again.";
const target = await (
  await fetch("http://127.0.0.1:9236/json/new?about:blank", { method: "PUT" })
).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

let sequence = 0;
let loginCalls = 0;
const pending = new Map();
const runtimeErrors = [];
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

const respond = (requestId, responseCode, data) =>
  send("Fetch.fulfillRequest", {
    requestId,
    responseCode,
    responseHeaders: [
      { name: "Content-Type", value: "application/json" },
      { name: "Access-Control-Allow-Origin", value: base },
      { name: "Access-Control-Allow-Credentials", value: "true" },
      { name: "Access-Control-Allow-Headers", value: "content-type" },
      { name: "Access-Control-Allow-Methods", value: "GET,POST,OPTIONS" },
    ],
    body: Buffer.from(JSON.stringify(data)).toString("base64"),
  });

const route = async ({ requestId, request }) => {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) {
    if (request.method === "OPTIONS") return respond(requestId, 200, {});
    if (url.pathname === "/api/auth/me") {
      return respond(requestId, 401, { success: false, message: "No active session." });
    }
    if (url.pathname === "/api/auth/login-challenge") {
      return respond(requestId, 200, { challengeId: "fixture-challenge", question: "2 + 3" });
    }
    if (url.pathname === "/api/auth/login") {
      loginCalls += 1;
      return respond(requestId, 401, {
        success: false,
        message: "Invalid password.",
        errors: { password: "Invalid password." },
        code: "INVALID_PASSWORD",
      });
    }
    return respond(requestId, 200, { success: true });
  }
  if (url.origin === base) return send("Fetch.continueRequest", { requestId });
  return send("Fetch.failRequest", { requestId, errorReason: "Aborted" });
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
      if (!/Invalid InterceptionId|Target closed/.test(error.message)) runtimeErrors.push(error.message);
    });
  } else if (message.method === "Runtime.exceptionThrown") {
    runtimeErrors.push(
      message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text,
    );
  }
};

const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
  return result.result?.value;
};

const wait = async (expression, timeout = 15000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(`Boolean(${expression})`).catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${expression}\n${await evaluate("document.body.innerText.slice(-1600)")}`);
};

const setValue = (selector, value) =>
  evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) throw new Error("Missing input: " + ${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "http*" }] });
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Page.navigate", { url: `${base}/signin` });
  await wait("document.querySelector('input[type=password]') && document.querySelector('input[inputmode=numeric]')");

  await setValue('input[type="email"]', "renter@gmail.com");
  await setValue('input[type="password"]', "WrongPass1!");
  await setValue('input[inputmode="numeric"]', "5");
  await evaluate("document.querySelector('form').requestSubmit()");

  await wait(`document.body.innerText.includes(${JSON.stringify(expectedMessage)})`);
  assert.equal(loginCalls, 1);
  assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), true);

  await setValue('input[type="password"]', "CorrectedPass1!");
  await wait(`!document.body.innerText.includes(${JSON.stringify(expectedMessage)})`);
  assert.deepEqual(runtimeErrors, []);

  console.log(
    "Sign-in wrong-password fixture shows the actionable inline message, clears on edit, and fits at 390px.",
  );
} finally {
  await send("Page.close").catch(() => {});
  ws.close();
}
