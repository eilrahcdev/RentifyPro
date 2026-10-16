// Synthetic API/verification fixtures. Run Vite on 4176 and isolated Chrome CDP on 9236.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { selectRegistrationFields, validRegistrationStep, validRegistrationPhase } from "../backend/utils/registrationDraft.js";
import { supportingDocumentCanContinue } from "../backend/utils/registrationReview.js";

const base = "http://127.0.0.1:4176";
const uxOnly = process.argv.includes("--ux-only");
const authUiOnly = process.argv.includes("--auth-ui-only");
const lifecycleOnly = process.argv.includes("--lifecycle-only");
const verificationErrorsOnly = process.argv.includes("--verification-errors-only");
const completionOnly = process.argv.includes("--completion-only");
const navigationOnly = process.argv.includes("--navigation-only") || completionOnly;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const common = { firstName: "Alice", lastName: "Example", phone: "9123456789", region: "01", province: "0101",
  city: "010101", barangay: "010101001", idType: "Philippine Passport" };
const fieldsFor = role => selectRegistrationFields(role, role === "user" ? { ...common, email: "alice@gmail.com",
  dateOfBirth: "1995-01-01", gender: "Female", emergencyContactName: "Bob Example", emergencyContactPhone: "9987654321", emergencyContactRelationship: "Friend" }
  : { ...common, businessEmail: "owner@gmail.com", ownerType: "business", businessName: "Example Transport",
    permitNumber: "TEST123", supportingDocType: "DTI Business Name Registration" });
const documentsFor = role => ["id", ...(role === "owner" ? ["supporting"] : [])].map(docType => ({ docType,
  reference: `fixture-${role}-${docType}`, documentRevision: `fixture-${docType}-revision`, available: true, profileMatches: true,
  selectedDocCategory: docType === "id" ? common.idType : "DTI Business Name Registration", identityReadyForSelfie: docType === "id",
  status: "verified", reason: "Synthetic document approval.", expiresAt: new Date(Date.now() + 3600000).toISOString() }));
const drafts = new Map();
const saves = [];
const uploads = [];
const checks = [];
const errors = [];
const accounts = [];
const registrationRequests = [];
let failure = "", uploadInterrupted = false, selfieInterrupted = false, otpInterrupted = false, accountInterrupted = false, registrationInvalid = false, sequence = 0, canceledRequests = 0;
let verificationFailure = "";
const target = await (await fetch("http://127.0.0.1:9236/json/new?about:blank", { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const pending = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
});
const reply = (requestId, status, value) => send("Fetch.fulfillRequest", { requestId, responseCode: status,
  responseHeaders: [{ name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: base },
    { name: "Access-Control-Allow-Credentials", value: "true" }, { name: "Access-Control-Allow-Headers", value: "content-type,x-pre-kyc-token,x-registration-draft" },
    { name: "Access-Control-Allow-Methods", value: "GET,POST,DELETE,OPTIONS" }], body: Buffer.from(JSON.stringify(value)).toString("base64") });
const token = `fixture.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 7200 })).toString("base64url")}.signature`;
const recovery = draft => {
  const documentsComplete = draft.documents.some(doc => doc.docType === "id" && doc.identityReadyForSelfie && doc.profileMatches)
    && (draft.role !== "owner" || draft.documents.some(doc => doc.docType === "supporting" && doc.profileMatches && supportingDocumentCanContinue(doc)));
  return { ...draft, documentsComplete, verificationPhase: validRegistrationPhase(draft.verificationPhase, draft.emailVerified, documentsComplete),
    step: validRegistrationStep(draft.role, draft.fields, draft.step, draft.documents, draft.selfieVerified, draft.emailVerified), recovered: true };
};
async function handle({ requestId, request }) {
  const url = new URL(request.url);
  if (url.hostname === "psgc.gitlab.io") {
    let value = [];
    if (url.pathname.endsWith("/regions/")) value = [{ code: "01", name: "Fixture Region" }];
    if (url.pathname.endsWith("/provinces/")) { await pause(250); value = [{ code: "0101", name: "Fixture Province" }]; }
    if (url.pathname.endsWith("/cities-municipalities/")) value = [{ code: "010101", name: "Fixture City" }];
    if (url.pathname.endsWith("/barangays/")) value = [{ code: "010101001", name: "Fixture Barangay" }];
    return reply(requestId, 200, value);
  }
  if (url.pathname.startsWith("/api/")) {
    if (request.method === "OPTIONS") return reply(requestId, 200, {});
    if (url.pathname === "/api/auth/me") return reply(requestId, 401, { message: "Synthetic signed-out session" });
    if (url.pathname === "/api/auth/login-challenge") return reply(requestId, 200, { challengeId: "fixture-challenge", question: "What is 7 + 48?" });
    if (url.pathname === "/api/auth/check-registration-email") return reply(requestId, 200, { success: true, available: true });
    if (url.pathname.startsWith("/api/kyc/pre/draft/otp/")) {
      const draft = drafts.get(url.searchParams.get("role"));
      const body = JSON.parse(request.postData || "{}");
      if (url.pathname.endsWith("/send")) draft.otp = { sent: true, expiresAt: new Date(Date.now() + 300000).toISOString(), resendAt: new Date(Date.now() + 45000).toISOString() };
      else {
        if (body.otp !== "123456") return reply(requestId, 400, { success: false, message: "Synthetic incorrect code." });
        draft.emailVerified = true; draft.otp = null; draft.verificationPhase = "face";
        if (otpInterrupted) { otpInterrupted = false; return send("Fetch.failRequest", { requestId, errorReason: "ConnectionReset" }); }
      }
      return reply(requestId, 200, { success: true, draft: recovery(draft), preKycToken: token });
    }
    if (url.pathname === "/api/auth/register") {
      const body = JSON.parse(request.postData || "{}"); const draft = drafts.get(body.role);
      registrationRequests.push(body);
      assert.equal(draft.emailVerified, true); assert.equal(recovery(draft).step, 5);
      if (registrationInvalid) { registrationInvalid = false; return reply(requestId, 200, {}); }
      if (!draft.registrationComplete) accounts.push({ _id: `fixture-account-${accounts.length}`, email: body.email, role: body.role, isVerified: true, kycStatus: "challenge_passed" });
      draft.registrationComplete = true;
      if (accountInterrupted) { accountInterrupted = false; return send("Fetch.failRequest", { requestId, errorReason: "ConnectionReset" }); }
      return reply(requestId, 201, { success: true, user: accounts.at(-1), message: "Account created. Your documents are Pending Review. Sign in to continue." });
    }
    if (url.pathname === "/api/kyc/pre/draft") {
      const role = url.searchParams.get("role");
      if (request.method === "DELETE") {
        if (failure === "cancel") return reply(requestId, 503, { message: "Synthetic cancellation failure. Please retry." });
        drafts.delete(role); failure = ""; return reply(requestId, 200, { success: true, cancelled: true });
      }
      if (failure === "invalid" && request.method === "POST") return reply(requestId, 200, {});
      if (failure && request.method === "POST") return reply(requestId, failure === "expired" ? 410 : failure === "conflict" ? 409 : 503,
        { success: false, message: `Synthetic ${failure} recovery response.` });
      if (failure === "recovery" && request.method === "GET") return reply(requestId, 503, { message: "Synthetic recovery network failure." });
      if (request.method === "GET") {
        const draft = drafts.get(role);
        return reply(requestId, 200, { success: true, draft: draft ? recovery(draft) : null, ...(draft ? { preKycToken: token } : {}) });
      }
      const body = JSON.parse(request.postData || "{}"); saves.push(body);
      assert.equal(JSON.stringify(body).includes("MemoryOnly123!"), false);
      assert.equal(Object.hasOwn(body.fields, "password"), false); assert.equal(Object.hasOwn(body.fields, "selfieVerified"), false);
      const current = drafts.get(role);
      if (current && body.revision !== current.revision) return reply(requestId, 409, { message: "Synthetic stale revision." });
      const legacy = !current && Boolean(body.previousToken);
      const importedFields = selectRegistrationFields(role, body.fields);
      if (legacy && !importedFields.idType) importedFields.idType = common.idType;
      const draft = { ...current, role, fields: importedFields, step: body.step, revision: (current?.revision || 0) + 1,
        verificationPhase: body.phase || current?.verificationPhase,
        emailVerified: current?.emailVerified === true && current.fields[role === "owner" ? "businessEmail" : "email"] === importedFields[role === "owner" ? "businessEmail" : "email"],
        documents: current?.documents || (legacy ? documentsFor(role) : []), selfieVerified: current?.selfieVerified || false,
        expiresAt: new Date(Date.now() + 3600000).toISOString(), savedAt: new Date().toISOString() };
      drafts.set(role, draft); return reply(requestId, 200, { success: true, draft: recovery(draft), preKycToken: token });
    }
    if (url.pathname === "/api/kyc/pre/session") return reply(requestId, 200, { success: true, preKycToken: token });
    if (url.pathname === "/api/kyc/pre/manual-review") {
      drafts.get(currentRole).documents.find(doc => doc.docType === "id").manualReviewRequested = true;
      return reply(requestId, 200, { success: true });
    }
    if (url.pathname === "/api/kyc/pre/status") {
      const role = currentRole;
      const draft = drafts.get(role); return reply(requestId, 200, { success: true, documents: draft?.documents || [], selfieVerified: draft?.selfieVerified || false });
    }
    if (url.pathname === "/api/kyc/pre/id-register") {
      uploads.push({ role: currentRole, body: JSON.parse(request.postData || "{}") });
      const draft = drafts.get(currentRole); draft.documents = documentsFor(currentRole).map(document => document.docType === "id"
        ? { ...document, selectedDocCategory: uploads.at(-1).body.id_type } : document); draft.selfieVerified = false;
      if (uploadInterrupted) { uploadInterrupted = false; return send("Fetch.failRequest", { requestId, errorReason: "ConnectionReset" }); }
      if (verificationFailure === "id") return reply(requestId, 500, { success: false, message: "We couldn't verify your ID right now. Please try again." });
      return reply(requestId, 200, { success: true, documentStatus: "verified", documentRevision: "fixture-id-revision" });
    }
    if (url.pathname === "/api/kyc/pre/selfie/verify") {
      if (verificationFailure === "selfie") return reply(requestId, 503, { success: false, message: "We couldn't verify your selfie right now. Please try again." });
      if (verificationFailure === "mismatch") return reply(requestId, 200, { success: true, verified: false, message: "Synthetic face does not match ID." });
      if (verificationFailure === "replaced") {
        const document = drafts.get(currentRole).documents.find(document => document.docType === "id");
        document.documentRevision = "replacement-id-revision";
        return reply(requestId, 409, { success: false, verified: false, message: "Your ID changed while the selfie was being checked. Verify against the current ID." });
      }
      drafts.get(currentRole).selfieVerified = true;
      if (selfieInterrupted) { selfieInterrupted = false; return send("Fetch.failRequest", { requestId, errorReason: "ConnectionReset" }); }
      return reply(requestId, 200, { success: true, verified: true });
    }
    return reply(requestId, 200, { success: true, vehicles: [], documents: [], notifications: [] });
  }
  return url.origin === base ? send("Fetch.continueRequest", { requestId }) : send("Fetch.failRequest", { requestId, errorReason: "Aborted" });
}
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id) { const call = pending.get(message.id); pending.delete(message.id); message.error ? call?.reject(new Error(message.error.message)) : call?.resolve(message.result); }
  else if (message.method === "Fetch.requestPaused") handle(message.params).catch(error => {
    if (error.message === "Invalid InterceptionId.") canceledRequests++; else errors.push(error.message);
  });
  else if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
};
const evaluate = async expression => {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
};
async function wait(expression, timeout = 16000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (await evaluate(`Boolean(${expression})`).catch(() => false)) return; await pause(80); }
  throw Error(`Timed out: ${expression}; ${await evaluate("document.body.innerText.slice(-1800)")}`);
}
let currentRole = "user";
const route = role => role === "owner" ? "/register-owner" : "/register";
const formStep = step => `document.querySelector('form[aria-label="Registration step ${step} of 5"]')`;
async function navigate(role) {
  currentRole = role;
  const before = await evaluate("window.registrationDocument");
  await send("Page.navigate", { url: base + route(role) });
  await wait(`window.registrationDocument !== ${JSON.stringify(before)} && document.querySelector('[data-registration-draft]') && !['loading'].includes(document.querySelector('[data-registration-draft]').dataset.draftState)`);
}
async function reload(step) {
  const before = await evaluate("window.registrationDocument");
  await send("Page.reload", { ignoreCache: true });
  await wait(`window.registrationDocument !== ${JSON.stringify(before)} && ${formStep(step)} && !document.querySelector('fieldset').disabled`);
}
const input = (selector, value, index = 0) => evaluate(`(() => { const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; if (!el) throw Error('Missing input');
  Object.getOwnPropertyDescriptor(el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); })()`);
const click = async label => {
  await wait(`[...document.querySelectorAll('button')].some(el => el.textContent.trim() === ${JSON.stringify(label)} && !el.disabled)`);
  return evaluate(`(() => { const el = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === ${JSON.stringify(label)}); if (!el) throw Error('Missing button: ' + ${JSON.stringify(label)}); el.click(); })()`);
};
async function seed(role, step, extra = {}) {
  await send("Page.navigate", { url: "about:blank" });
  await wait("location.href === 'about:blank'");
  await pause(150);
  const init = await send("Page.addScriptToEvaluateOnNewDocument", { source: `sessionStorage.removeItem('rentifypro.registrationDraft.v1.${role}');` });
  drafts.set(role, { role, fields: fieldsFor(role), step, revision: 1,
    emailVerified: true,
    documents: documentsFor(role), selfieVerified: true, expiresAt: new Date(Date.now() + 3600000).toISOString(), savedAt: new Date().toISOString(), ...extra });
  await navigate(role);
  await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: init.identifier });
}
const secretsAbsent = async () => assert.equal(await evaluate(`(() => {
  const values = [sessionStorage, localStorage].flatMap(storage => Object.keys(storage).map(key => storage.getItem(key)));
  return values.some(value => value.includes('MemoryOnly123!'));
})()`), false);
const reportPath = path.join(os.tmpdir(), `rentifypro-registration-recovery-browser${authUiOnly ? "-auth-ui" : lifecycleOnly ? "-lifecycle" : verificationErrorsOnly ? "-verification-errors" : uxOnly ? "-ux" : process.argv.includes("--mobile") ? "-mobile" : ""}.json`);
const confirmCancel = () => evaluate("document.querySelector('[aria-label=\"Confirm cancellation\"] button').click()");

try {
  await send("Page.enable"); await send("Runtime.enable"); await send("Fetch.enable", { patterns: [{ urlPattern: "http*" }] });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: "window.registrationDocument = Math.random();" });
  if (authUiOnly) {
    const emailIcon = () => evaluate(`(() => { const icon = document.querySelector('input[type=email]').parentElement.querySelector('svg.lucide-mail');
      const style = getComputedStyle(icon), frame = getComputedStyle(icon.parentElement);
      return { width: icon.getBoundingClientRect().width, height: icon.getBoundingClientRect().height, stroke: icon.getAttribute('stroke-width'),
        color: style.color, background: frame.backgroundColor, border: frame.borderColor, radius: frame.borderRadius, padding: frame.padding }; })()`);
    const assertMobileLayout = async (width, context) => {
      assert.equal(await evaluate(`(() => { const form = document.querySelector('form'); return form.scrollWidth <= form.clientWidth + 1
        && [...form.querySelectorAll('input, select, button')].filter(el => el.getClientRects().length).every(el => {
          const rect = el.getBoundingClientRect(); return rect.left >= -1 && rect.right <= innerWidth + 1; }); })()`), true, `${context} controls must fit at ${width}px`);
      if (width < 1024) assert.equal(await evaluate(`([...document.querySelectorAll('form input:not([type=checkbox]), form select')]
        .filter(el => el.getClientRects().length).every(el => parseFloat(getComputedStyle(el).fontSize) >= 16))`), true, `${context} readable mobile inputs`);
    };
    for (const [width, height] of [[320, 740], [360, 800], [390, 844], [430, 932], [768, 1024], [844, 390], [1440, 1000]]) {
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 768 });
      const before = await evaluate("window.registrationDocument");
      await send("Page.navigate", { url: base + "/signin" });
      await wait(`window.registrationDocument !== ${JSON.stringify(before)} && document.querySelector('input[type=password]') && !document.querySelector('button[aria-label="Refresh security check"]').disabled`);
      await assertMobileLayout(width, "Sign-in");
      assert.equal(await evaluate(`(() => { const answer = document.querySelector('input[placeholder="?"]').getBoundingClientRect();
        const refresh = document.querySelector('button[aria-label="Refresh security check"]').getBoundingClientRect();
        return refresh.top >= answer.bottom + 7 || refresh.left >= answer.right + 7; })()`), true, `Security check controls must not overlap at ${width}px`);
      const commonIcon = await emailIcon();
      assert.equal(commonIcon.width, 16); assert.equal(commonIcon.stroke, "2");
      await input('input[type=password]', "MemoryOnly123!"); await evaluate("document.querySelector('button[aria-label=\"Show password\"]').click()");
      assert.equal(await evaluate("document.querySelector('button[aria-label=\"Hide password\"]').getAttribute('aria-pressed')"), "true");
      await evaluate("document.querySelector('button[aria-label=\"Hide password\"]').click()"); await evaluate("document.querySelector('button[aria-label=\"Refresh security check\"]').click()");
      await wait("!document.querySelector('button[aria-label=\"Refresh security check\"]').disabled");
      await input('input[type=password]', "");
      if ([320, 1440].includes(width)) await send("Page.captureScreenshot", { format: "png" }).then(result => fs.writeFile(path.join(os.tmpdir(), `rentifypro-signin-icons-${width}.png`), Buffer.from(result.data, "base64")));
      checks.push(`Sign-in icons, password visibility, security refresh, and layout at ${width}x${height}`);
      for (const role of ["user", "owner"]) for (const step of [1, 2, 3, 4, 5]) {
        await seed(role, step); await wait(`${formStep(step)} && !document.querySelector('fieldset').disabled`); await pause(100);
        await assertMobileLayout(width, `${role} registration step ${step}`);
        if (step === 1) assert.deepEqual(await emailIcon(), commonIcon, "Email icons must use the same size, stroke, and frame across auth forms");
        if (role === "owner" && step === 1) {
          assert.equal(await evaluate("document.body.innerText.includes('Have these ready before you start')"), false);
          if (width < 1024) { await click("What you’ll need"); await wait("document.querySelector('.rp-registration-preparation button').getAttribute('aria-expanded') === 'true'"); }
          assert.deepEqual(await evaluate("[...document.querySelectorAll('.rp-registration-preparation li')].map(el => el.textContent)"), [
            "A readable Philippines-issued business document.", "A government ID and a camera for a live selfie.", "Access to your registration email.",
          ]);
          if (width < 1024) { await click("What you’ll need"); assert.equal(await evaluate("document.querySelector('.rp-registration-preparation button').getAttribute('aria-expanded')"), "false"); }
          if ([390, 1440].includes(width)) await send("Page.captureScreenshot", { format: "png" }).then(result => fs.writeFile(path.join(os.tmpdir(), `rentifypro-owner-checklist-icons-${width}.png`), Buffer.from(result.data, "base64")));
        }
        if (step === 5) {
          assert.equal(await evaluate("[...document.querySelectorAll('input[type=password]')].every(el => el.parentElement.querySelector('svg.lucide-lock'))"), true);
          await evaluate("document.querySelector('button[aria-label=\"Show password\"]').click()"); await wait("document.querySelector('button[aria-label=\"Hide password\"]')"); await evaluate("document.querySelector('button[aria-label=\"Hide password\"]').click()");
          assert.equal(await evaluate("[...document.querySelectorAll('button[aria-label=\"Show password\"]')].every(el => el.getBoundingClientRect().width >= 44 && el.getBoundingClientRect().height >= 44)"), true);
        }
        if (width < 1024) {
          await evaluate(`(() => { const inputs = [...document.querySelectorAll('form input, form select')].filter(el => el.getClientRects().length && !el.disabled);
            const last = inputs.at(-1); last?.focus(); last?.scrollIntoView({ block: 'center' }); })()`); await pause(100);
          assert.equal(await evaluate("!document.querySelector('.rp-registration-actions') || document.activeElement.getBoundingClientRect().bottom <= document.querySelector('.rp-registration-actions').getBoundingClientRect().top + 1"), true, "Sticky actions must not cover the focused input");
        }
        checks.push(`${role} registration step ${step} icons and responsive controls at ${width}x${height}`);
      }
    }
  } else if (lifecycleOnly) {
    for (const width of [390, 768, 1200]) for (const role of ["user", "owner"]) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
      for (const step of [1, 4, 5]) {
        await seed(role, step); await wait(`${formStep(step)} && !document.querySelector('fieldset').disabled`);
        const beforeAccounts = accounts.length;
        await click("Cancel registration"); await wait("document.activeElement?.textContent === 'Keep registering'");
        assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), true);
        if (step === 5) {
          await send("Page.captureScreenshot", { format: "png" }).then(result => fs.writeFile(path.join(os.tmpdir(),
            `rentifypro-${role}-cancel-${width}.png`), Buffer.from(result.data, "base64")));
        }
        await click("Keep registering"); assert.equal(await evaluate("document.querySelector('[aria-label=\"Confirm cancellation\"]') === null"), true);
        assert.equal(await evaluate(`Boolean(${formStep(step)})`), true);
        await click("Cancel registration"); await confirmCancel(); await wait("location.pathname === '/'");
        assert.equal(drafts.has(role), false); assert.equal(accounts.length, beforeAccounts);
        checks.push(`${role} cancel/keep at step ${step}, ${width}px; no account created`);
      }
      await seed(role, 5); await wait(formStep(5)); failure = "cancel";
      await click("Cancel registration"); await confirmCancel();
      await wait("document.querySelector('[data-draft-state=unavailable]') && !document.querySelector('[aria-label=\"Confirm cancellation\"] button').disabled");
      assert.equal(await evaluate("location.pathname"), route(role)); assert.equal(drafts.has(role), true);
      failure = ""; await confirmCancel(); await wait("location.pathname === '/'");
      checks.push(`${role} failed cancellation preserves progress and retries at ${width}px`);
      const unresolved = documentsFor(role).map(doc => doc.docType === "id" ? { ...doc, status: "pending_review", identityReadyForSelfie: false,
        automatedScreening: { outcome: "review_needed" }, reason: "Some details need manual comparison." } : doc);
      await seed(role, 4, { documents: unresolved, selfieVerified: false }); await wait("document.body.innerText.includes('Request manual verification')");
      await click("Request manual verification"); await wait("document.body.innerText.includes('Manual ID verification requested')");
      assert.equal(await evaluate("document.body.innerText.includes('Final approval') || document.body.innerText.includes('final approval')"), true);
      assert.equal(drafts.get(role).documents[0].status, "pending_review");
      checks.push(`${role} explicit manual assistance remains pending at ${width}px`);
      if (role === "owner") {
        await seed(role, 4, { documents: documentsFor(role).map(doc => doc.docType === "supporting" ? { ...doc, status: "pending_review",
          automatedScreening: { outcome: "correction_needed" }, reason: "Business name differs from registration." } : doc), selfieVerified: false });
        await wait("document.body.innerText.includes('Business name differs from registration.')");
        await click("Next");
        assert.equal(await evaluate("Boolean(document.querySelector('[data-identity-view=id]'))"), true);
        assert.equal(await evaluate("document.querySelector('[data-identity-view=selfie]') === null"), true);
        checks.push(`owner confirmed business correction blocks selfie continuation at ${width}px`);
      }
    }
  } else if (uxOnly) {
    for (const width of [390, 768, 1200, 1920]) for (const role of ["user", "owner"]) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
      await seed(role, 2);
      await wait(`${formStep(2)} && !document.querySelector('fieldset').disabled`);
      await pause(250);
      await evaluate("window.registrationSelect = document.querySelector('select'); window.registrationSelect.focus();");
      const beforeSave = saves.length;
      await evaluate("window.dispatchEvent(new Event('online'))");
      while (saves.length === beforeSave) await pause(80);
      await wait("document.querySelector('[data-draft-state=saved]')");
      assert.deepEqual(await evaluate("({sameNode:window.registrationSelect === document.querySelector('select'),focused:document.activeElement === window.registrationSelect})"), { sameNode: true, focused: true }, `${role} dropdown node and focus must survive autosave at ${width}px`);
      assert.equal(await evaluate("document.querySelector('[data-registration-draft]').getBoundingClientRect().height <= 60"), true, "Routine saving must use a compact stable row");
      checks.push(`${role} dropdown and compact draft status survive autosave at ${width}px`);

      await seed(role, 1);
      await wait(`${formStep(1)} && !document.querySelector('fieldset').disabled`);
      await click("Next"); await wait(formStep(2)); await pause(150);
      assert.equal(await evaluate("document.querySelector('.rp-registration-header').getBoundingClientRect().top >= 0 && scrollY < 5"), true, `${role} step navigation must keep the page header visible at ${width}px`);
      await pause(2100); await click("Next"); await wait(formStep(3)); await pause(150);
      assert.equal(await evaluate("document.querySelector('.rp-registration-header').getBoundingClientRect().top >= 0 && scrollY < 5"), true);
      checks.push(`${role} forward navigation keeps registration header and progress visible at ${width}px`);

      for (const phase of ["email", "documents", "face"]) {
        await seed(role, 4, phase === "email" ? { emailVerified: false, documents: [], selfieVerified: false }
          : phase === "documents" ? { documents: [], selfieVerified: false } : { selfieVerified: false });
        await wait(phase === "email" ? "document.querySelector('[data-verification-phase=email]')" : `document.querySelector('[data-identity-view]')?.dataset.identityView === '${phase === "documents" ? "id" : "selfie"}'`);
        assert.equal(await evaluate("document.querySelector('nav[aria-label=\"Verification phases\"]') === null"), true);
        assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth + 1 && document.querySelector('.rp-registration-header').getBoundingClientRect().top >= 0"), true);
        if (phase === "email") {
          assert.equal(await evaluate("document.body.innerText.includes('Clear Code') && document.querySelector('.rp-otp-fields').getBoundingClientRect().width <= 448"), true);
          await input('input[aria-label="Code digit 1"]', "123456"); await click("Clear Code");
          assert.equal(await evaluate("[...document.querySelectorAll('[aria-label^=\"Code digit\"]')].every(field=>!field.value)"), true);
          await click("Send Code"); await wait("document.body.innerText.includes('Resend in')");
        }
        if (phase === "documents" && role === "user") {
          await evaluate("window.registrationFileInput = document.querySelector('input[type=file]'); void 0;");
          await evaluate("window.dispatchEvent(new Event('online'))"); await pause(1100);
          assert.equal(await evaluate("window.registrationFileInput === document.querySelector('input[type=file]')"), true, "File picker must survive draft updates");
        }
        if (phase === "face" && width === 390) {
          await click("Open camera");
          await wait("document.querySelector('video')?.readyState >= 2");
          await evaluate("window.registrationCamera = document.querySelector('video').srcObject; void 0;");
          await evaluate("window.dispatchEvent(new Event('online'))"); await pause(1100);
          assert.equal(await evaluate("window.registrationCamera === document.querySelector('video').srcObject && window.registrationCamera.getTracks().every(track=>track.readyState==='live')"), true);
          await click("Take photo"); await wait("document.body.innerText.includes('Use selfie and continue')");
          await click("Retake"); await wait("document.querySelector('video')?.readyState >= 2");
          checks.push(`${role} live camera and capture controls survive autosaving at ${width}px`);
        }
        if ([390, 1200].includes(width)) await send("Page.captureScreenshot", { format: "png" }).then(result => fs.writeFile(path.join(os.tmpdir(), `rentify-registration-ux-${role}-${phase}-${width}.png`), Buffer.from(result.data, "base64")));
        assert.equal(await evaluate(`(() => {
          const actions=document.querySelector('.rp-registration-actions');
          const content=document.querySelector('.rp-auth-content');
          if(getComputedStyle(actions).position!=='fixed')content.scrollTo({top:content.scrollHeight,behavior:'instant'});
          const bounds=actions.getBoundingClientRect();
          return bounds.top >= 0 && bounds.bottom <= innerHeight + 1;
        })()`), true, `${role} ${phase} actions must be reachable without clipping at ${width}px`);
        checks.push(`${role} ${phase} uses the restored verification layout at ${width}px`);
      }
    }
  } else if (verificationErrorsOnly) {
    for (const width of [390, 1200]) for (const role of ["user", "owner"]) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
      await seed(role, 4, { selfieVerified: false });
      await click("Back to ID"); await reload(4);
      assert.equal(await evaluate("[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Replace ID') && document.body.innerText.includes('Your government ID is saved privately.')"), true, "A recovered private ID must show a saved state with a replacement action");
      checks.push(`${role} recovered ID is clearly saved with Replace ID at ${width}px`);
      await input('select', "PhilSys National ID"); await pause(2100);
      const beforeUpload = uploads.length;
      verificationFailure = "id"; await click("Upload and check ID");
      await wait("document.querySelector('[data-registration-draft]')?.dataset.draftState === 'restored' && !document.querySelector('fieldset').disabled");
      assert.equal(uploads.length, beforeUpload + 1);
      assert.equal(await evaluate("document.body.innerText.includes(\"We couldn't verify your ID\")"), false, "A recovered successful ID must not retain an upload failure");
      checks.push(`${role} saved ID recovers without a contradictory error or duplicate upload at ${width}px`);

      verificationFailure = "";
      await seed(role, 4, { selfieVerified: false });
      await click("Open camera"); await wait("document.querySelector('video')?.readyState >= 2");
      await click("Take photo"); await wait("document.querySelector('img[alt=\"Captured selfie preview\"]')");
      const photo = await evaluate("document.querySelector('img[alt=\"Captured selfie preview\"]').src");
      verificationFailure = "selfie"; await click("Use selfie and continue");
      await wait("!document.querySelector('fieldset').disabled && !!document.querySelector('[role=alert]')");
      assert.equal(await evaluate("document.querySelector('img[alt=\"Captured selfie preview\"]')?.src"), photo, "An unavailable face service must preserve the captured photo for retry");
      assert.equal(drafts.get(role).selfieVerified, false);
      checks.push(`${role} face service failure preserves the photo and unverified status at ${width}px`);

      await pause(2100); verificationFailure = "mismatch"; await click("Use selfie and continue");
      await wait("[...document.querySelectorAll('[role=alert]')].some(element=>element.textContent.includes('match your ID photo'))");
      assert.equal(await evaluate("document.querySelector('img[alt=\"Captured selfie preview\"]')?.src"), photo);
      assert.equal(drafts.get(role).selfieVerified, false);
      checks.push(`${role} a real mismatch remains blocked and keeps the retry photo at ${width}px`);

      await pause(2100); verificationFailure = ""; selfieInterrupted = true; await click("Use selfie and continue");
      await wait("document.body.innerText.includes('Selfie matched') && !document.querySelector('fieldset').disabled");
      assert.equal(await evaluate("[...document.querySelectorAll('[role=alert]')].some(element=>element.textContent.includes(\"couldn't verify\"))"), false);
      await reload(4); assert.equal(await evaluate("document.body.innerText.includes('Selfie matched')"), true);
      checks.push(`${role} retry and dropped successful response restore a clean matched state at ${width}px`);

      await seed(role, 4, { selfieVerified: false });
      await click("Open camera"); await wait("document.querySelector('video')?.readyState >= 2"); await click("Take photo");
      await wait("document.querySelector('img[alt=\"Captured selfie preview\"]')");
      verificationFailure = "replaced"; await click("Use selfie and continue");
      await wait("!document.querySelector('fieldset').disabled && !!document.querySelector('[role=alert]')");
      assert.equal(await evaluate("document.querySelector('img[alt=\"Captured selfie preview\"]') === null"), true, "A replaced ID must invalidate its previous captured selfie");
      assert.equal(drafts.get(role).selfieVerified, false);
      checks.push(`${role} changed ID invalidates the old capture instead of reusing it at ${width}px`);
      verificationFailure = "";
      assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), true);
    }
  } else {
  if (process.argv.includes("--mobile")) await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  for (const width of navigationOnly ? [] : process.argv.includes("--edges-only") ? [390] : [320, 390, 768, 1200]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
    for (const role of ["user", "owner"]) for (const phase of ["email", "documents", "face"]) {
      await seed(role, 4, phase === "email" ? { emailVerified: false, documents: [], selfieVerified: false }
        : phase === "documents" ? { documents: [], selfieVerified: false } : { selfieVerified: false });
      await wait(phase === "email" ? "document.querySelector('[data-verification-phase=email]')" : `document.querySelector('[data-identity-view]')?.dataset.identityView === '${phase === "documents" ? "id" : "selfie"}'`);
      await reload(4);
      assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), true);
      if (phase === "email") assert.equal(await evaluate("document.querySelector('input[type=file]') !== null"), false);
      if (role === "user" && phase === "email" && [390, 1200].includes(width)) {
        await send("Page.captureScreenshot", { format: "png" }).then(result => fs.writeFile(path.join(os.tmpdir(),
          `rentifypro-registration-email-${width}.png`), Buffer.from(result.data, "base64")));
      }
      checks.push(`${role} ${phase} phase restores at ${width}px`);
    }
  }
  for (const width of navigationOnly || process.argv.includes("--edges-only") ? [] : [320, 390, 768, 1200]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
    for (const role of ["user", "owner"]) for (let step = 1; step <= 5; step++) {
      await seed(role, step); await wait(formStep(step)); await reload(step);
      assert.equal(await evaluate("[...document.querySelectorAll('input[type=password]')].every(el => !el.value)"), true);
      assert.equal(await evaluate("document.querySelector('input[type=checkbox]')?.checked || false"), false);
      await secretsAbsent();
      if (step === 4) {
        assert.equal(await evaluate("document.querySelector('[data-identity-view]').dataset.identityView"), "selfie");
        assert.equal(await evaluate("document.body.innerText.includes('Your selfie matched')"), true);
        assert.equal(await evaluate("[...document.querySelectorAll('button')].some(el => el.textContent.trim() === 'Open camera')"), false);
      }
      if (step === 5) assert.ok(await evaluate("document.body.innerText.includes('Alice Example')"));
      assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), true, `${role} step ${step} overflows ${width}px`);
      checks.push(`${role} step ${step}: refresh and validated recovery at ${width}px`);
    }
  }
  if (!navigationOnly) {
  await seed("owner", 4); await click("Back to ID"); await wait("document.body.innerText.includes('Your business document is saved privately')");
  assert.equal(await evaluate("[...document.querySelectorAll('button')].find(el => el.textContent.trim() === 'Document uploaded')?.disabled"), true);
  checks.push("owner uploaded business document restores without a local File");

  await seed("user", 2, { documents: [], selfieVerified: false });
  await input('input[placeholder="John"]', "Alicia");
  await wait("document.querySelector('[data-registration-draft]').dataset.draftState === 'saved'");
  assert.equal(drafts.get("user").fields.firstName, "Alicia"); await reload(2);
  assert.equal(await evaluate('document.querySelector(\'input[placeholder="John"]\').value'), "Alicia");
  checks.push("automatic field save survives refresh");

  await input('input[placeholder="John"]', "Immediate"); await reload(2);
  assert.equal(await evaluate('document.querySelector(\'input[placeholder="John"]\').value'), "Immediate");
  checks.push("refresh before debounce completes replays pending fields through backend validation");

  failure = "network"; await input('input[placeholder="John"]', "Offline");
  await wait("document.querySelector('[data-registration-draft]').dataset.draftState === 'unavailable'");
  assert.equal(await evaluate('document.querySelector(\'input[placeholder="John"]\').value'), "Offline");
  const beforeFailureReload = await evaluate("window.registrationDocument");
  await send("Page.reload", { ignoreCache: true });
  await wait(`window.registrationDocument !== ${beforeFailureReload} && document.querySelector('[data-registration-draft]')?.dataset.draftState === 'unavailable'`);
  failure = ""; await click("Retry saving and recovery"); await wait("['saved', 'restored'].includes(document.querySelector('[data-registration-draft]').dataset.draftState) && !document.querySelector('fieldset').disabled");
  assert.equal(drafts.get("user").fields.firstName, "Offline"); checks.push("network save failure preserves pending edits through refresh and retry");

  failure = "invalid"; await input('input[placeholder="John"]', "Unconfirmed");
  await wait("document.querySelector('[data-registration-draft]').dataset.draftState === 'unavailable'");
  failure = ""; await click("Retry saving and recovery"); await wait("document.querySelector('[data-registration-draft]').dataset.draftState === 'saved'");
  checks.push("a malformed success response cannot show progress as saved");

  failure = "conflict"; await input('input[placeholder="John"]', "Stale");
  await wait("document.querySelector('[data-registration-draft]').dataset.draftState === 'conflict'");
  failure = ""; await click("Recover saved progress"); await wait("document.querySelector('[data-registration-draft]').dataset.draftState === 'restored'");
  assert.equal(await evaluate('document.querySelector(\'input[placeholder="John"]\').value'), "Unconfirmed"); checks.push("stale tab requires explicit recovery before it can save");

  failure = "expired"; await input('input[placeholder="John"]', "Expired");
  await wait("document.querySelector('[data-registration-draft]').dataset.draftState === 'expired'");
  assert.equal(await evaluate("document.querySelector('fieldset').disabled"), true); failure = "";
  await click("Cancel registration"); await confirmCancel(); await wait("location.pathname === '/'"); checks.push("expired draft cannot revive; confirmed cancellation clears it");

  await seed("user", 5, { documents: [], selfieVerified: false }); await wait(formStep(4));
  checks.push("missing uploaded evidence rolls a forged review step back to Identity");

  await seed("user", 4, { selfieVerified: false }); await wait("document.querySelector('[data-identity-view]')");
  await click("Back to ID"); await wait("document.querySelector('select')");
  await input('select', "PhilSys National ID"); await pause(2100); uploadInterrupted = true;
  await click("Upload and check ID"); await wait("document.querySelector('[data-registration-draft]').dataset.draftState === 'restored'");
  assert.equal(uploads.at(-1).body.document_revision, "fixture-id-revision");
  assert.equal(uploads.at(-1).body.id_image_base64, ""); checks.push("interrupted upload response recovers the private reference without file selection");

  await send("Page.navigate", { url: "about:blank" }); await wait("location.href === 'about:blank'"); await pause(150);
  drafts.delete("user");
  const legacyFields = fieldsFor("user"); delete legacyFields.idType;
  const legacySeed = await send("Page.addScriptToEvaluateOnNewDocument", { source: `
    sessionStorage.setItem('rentifypro.registrationDraft.v1.user', JSON.stringify({ version: 1, fields: ${JSON.stringify(legacyFields)}, expiresAt: Date.now() + 3600000 }));
    sessionStorage.setItem('rentify:pre-kyc:user:alice@gmail.com', ${JSON.stringify(token)});
  ` });
  await navigate("user"); await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: legacySeed.identifier });
  await wait(formStep(4)); await wait("document.querySelector('[data-verification-phase=email]')");
  await click("Send Code");
  await wait("document.body.innerText.includes('Code sent.') && !document.querySelector('input[aria-label=\"Code digit 1\"]').disabled");
  for (let index = 0; index < 6; index++) await input('input[aria-label^="Code digit"]', String(index + 1), index);
  await click("Verify Code"); await wait("document.querySelector('[data-identity-view]')?.dataset.identityView === 'selfie'");
  checks.push("legacy ordinary fields and signed upload session migrate without reupload");

  await evaluate(`navigator.mediaDevices.getUserMedia = async () => {
    const canvas = document.createElement('canvas'); canvas.width = 720; canvas.height = 960;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#b9d4df'; ctx.fillRect(0, 0, 720, 960);
    ctx.fillStyle = '#23434e'; ctx.fillRect(180, 240, 360, 480);
    return canvas.captureStream(12);
  }`);
  await click("Open camera"); await wait("[...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Take photo')");
  await click("Take photo"); await wait("[...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Use selfie and continue')");
  selfieInterrupted = true; await click("Use selfie and continue"); await wait("document.body.innerText.includes('Selfie matched')");
  await reload(4); assert.equal(await evaluate("document.body.innerText.includes('Selfie matched')"), true);
  checks.push("interrupted selfie response restores the backend result after refresh without another match");

  await seed("user", 5); await wait(formStep(5));
  await input('input[type="password"]', "MemoryOnly123!"); await input('input[type="password"]', "MemoryOnly123!", 1);
  assert.equal(await evaluate("[...document.querySelectorAll('input[type=password]')].every(el => el.value === 'MemoryOnly123!')"), true);
  await pause(1000); await secretsAbsent(); await reload(5);
  assert.equal(await evaluate("[...document.querySelectorAll('input[type=password]')].every(el => !el.value)"), true);
  checks.push("password remains only in memory and is requested again after refresh");
  }
  for (const role of ["user", "owner"]) {
    if (!completionOnly) {
    await seed(role, 4, { emailVerified: false }); await wait("document.querySelector('[data-verification-phase=email]')");
    await click("Next"); assert.ok(await evaluate("document.body.innerText.includes('Verify your email before continuing')"));
    await click("Send Code"); await wait("document.body.innerText.includes('Resend in')"); await reload(4);
    assert.equal(await evaluate("document.body.innerText.includes('Resend in')"), true);
    for (let index = 0; index < 6; index++) await input('input[aria-label^="Code digit"]', "0", index);
    await click("Verify Code"); await wait("document.body.innerText.includes('Synthetic incorrect code')");
    await input('input[aria-label="Code digit 1"]', "123456");
    assert.equal(await evaluate("[...document.querySelectorAll('input[aria-label^=\"Code digit\"]')].map(input => input.value).join('')"), "123456");
    otpInterrupted = true; await click("Verify Code");
    await wait("document.querySelector('[data-identity-view]')?.dataset.identityView === 'selfie'"); await reload(4);
    checks.push(`${role} OTP gate, cooldown, invalid code and interrupted verification recover`);
    await click("Back to ID"); await reload(4);
    assert.equal(await evaluate("document.querySelector('[data-identity-view]')?.dataset.identityView"), "id");
    assert.equal(drafts.get(role).selfieVerified, true);
    await pause(2100); await click("Back to Email"); await reload(4);
    await wait("document.body.innerText.includes('Email verified')"); await pause(2100); await click("Back");
    await wait(formStep(3)); await pause(2100); await click("Next");
    await wait("document.body.innerText.includes('Selfie matched')");
    await pause(2100); await click("Next"); await wait(formStep(5)); await reload(5);
    assert.equal(drafts.get(role).emailVerified, true); assert.equal(drafts.get(role).selfieVerified, true);
    checks.push(`${role} phase and step Back navigation keeps all completed checks`);
    await send("Page.navigate", { url: base + "/signin" });
    await wait(`location.pathname === '/signin' && !${formStep(5)} && document.body.innerText.length > 100`);
    await evaluate("history.back()");
    await wait(`location.pathname === ${JSON.stringify(route(role))} && ${formStep(5)} && !document.querySelector('fieldset').disabled`);
    await evaluate("history.forward()"); await wait("location.pathname === '/signin'");
    await evaluate("history.back()");
    await wait(`${formStep(5)} && !document.querySelector('fieldset').disabled`);
    assert.equal(drafts.get(role).emailVerified, true); assert.equal(drafts.get(role).selfieVerified, true);
    await secretsAbsent();
    checks.push(`${role} browser Back and Forward restore Review and completed checks`);
    await input('input[type="password"]', "MemoryOnly123!"); await input('input[type="password"]', "MemoryOnly123!", 1);
    await evaluate("document.querySelector('input[type=checkbox]').click()");
    drafts.get(role).documents.forEach(doc => { doc.status = "pending_review"; });
    const before = accounts.length; registrationInvalid = true;
    await click("Create Account");
    await wait(`document.body.innerText.includes('Account creation was not confirmed') && ${formStep(5)} && !document.querySelector('fieldset').disabled`);
    assert.equal(accounts.length, before); assert.equal(drafts.get(role).registrationComplete, undefined);
    assert.equal(drafts.get(role).emailVerified, true); assert.equal(drafts.get(role).selfieVerified, true);
    await secretsAbsent();
    checks.push(`${role} an unconfirmed account response preserves Review, the draft and completed checks`);
    await pause(2100); accountInterrupted = true;
    await click("Create Account"); await wait("document.querySelector('[data-registration-complete]')?.innerText.includes('Registration Complete')");
    assert.equal(accounts.length, before + 1); assert.equal(accounts.at(-1).kycStatus, "challenge_passed");
    await secretsAbsent();
    checks.push(`${role} Pending Review creation and dropped response recover without duplicate account or post-registration OTP`);
    await send("Page.navigate", { url: base + `/registerotp?role=${role}` });
    await wait(`location.pathname === ${JSON.stringify(route(role))} && document.querySelector('[data-registration-complete]')`);
    checks.push(`${role} former OTP URL returns to the correct saved registration`);
    await click("Sign in"); await wait("location.pathname === '/signin'");
    const clearedUntil = Date.now() + 5000;
    while (drafts.has(role) && Date.now() < clearedUntil) await pause(80);
    assert.equal(drafts.has(role), false);
    }

    await seed(role, 5); await wait(`${formStep(5)} && !document.querySelector('fieldset').disabled`);
    await evaluate(`(() => { for(const field of document.querySelectorAll('input[type=password]')) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,'MemoryOnly123!');field.dispatchEvent(new Event('input',{bubbles:true}));
    } document.querySelector('input[type=checkbox]').click(); })()`);
    await pause(100);
    assert.equal(await evaluate("[...document.querySelectorAll('input[type=password]')].every(field=>field.value==='MemoryOnly123!') && document.querySelector('input[type=checkbox]').checked"), true, `${role} rapid recovered-field entry must preserve every field`);
    drafts.get(role).documents.forEach(doc => { doc.status = "pending_review"; });
    const beforeRequests = registrationRequests.length;
    await evaluate("(() => { const button=[...document.querySelectorAll('button')].find(button=>button.innerText.trim()==='Create Account');button.click();button.click(); })()");
    await wait("document.querySelector('[data-registration-complete]')?.innerText.includes('Verification Pending')");
    assert.equal(registrationRequests.length, beforeRequests + 1);
    assert.equal(await evaluate("document.querySelector('form').getClientRects().length === 0 && document.querySelector('fieldset').disabled"), true);
    assert.equal(await evaluate("[...document.querySelectorAll('button')].some(button=>button.innerText.trim()==='Create Account')"), false);
    await pause(1800); assert.equal(await evaluate("location.pathname"), route(role));
    assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), true);
    await send("Page.captureScreenshot", { format: "png" }).then(result => fs.writeFile(path.join(os.tmpdir(),
      `rentifypro-${role}-registration-complete-${process.argv.includes("--mobile") ? "mobile" : "desktop"}.png`), Buffer.from(result.data, "base64")));
    await secretsAbsent(); checks.push(`${role} duplicate Create Account produces one request and shows Registration Complete separately from Verification Pending`);
    await click("Sign in"); await wait("location.pathname === '/signin'");
  }
  }
  assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), true);
  await evaluate("scrollTo(0, 0)");
  await send("Page.captureScreenshot", { format: "png" }).then(result => fs.writeFile(path.join(os.tmpdir(), process.argv.includes("--mobile")
    ? "rentifypro-registration-recovery-review-mobile.png" : "rentifypro-registration-recovery-review.png"), Buffer.from(result.data, "base64")));
  assert.deepEqual(errors, []);
  await fs.writeFile(reportPath, JSON.stringify({ fixtureOnly: true, checks, saves: saves.length, uploads: uploads.length, canceledRequests, errors }, null, 2));
  console.log(JSON.stringify({ fixtureOnly: true, passed: checks.length, report: reportPath }));
} finally {
  await new Promise(resolve => { ws.addEventListener("close", resolve, { once: true }); ws.close(); });
  await fetch(`http://127.0.0.1:9236/json/close/${target.id}`).catch(() => {});
}
