import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../frontend/node_modules/esbuild/lib/main.js";

// Native canvas checks only: no API, account, database or document transmission.
const root = fileURLToPath(new URL("..", import.meta.url));
const chromePath = process.env.KYC_TEST_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profile = await fs.mkdtemp(path.join(os.tmpdir(), "rentifypro-kyc-quality-"));
const bundle = await build({ entryPoints: [path.join(root, "frontend/src/utils/cameraKyc.js")], bundle: true,
  platform: "browser", format: "iife", globalName: "kycQuality", write: false });
const child = spawn(chromePath, ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-background-networking",
  "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, "--remote-debugging-pipe", "about:blank"],
{ windowsHide: true, stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
const pending = new Map();
let sequence = 0, buffer = "", closed = false;
const stopped = new Promise((resolve) => child.once("close", () => { closed = true; resolve(); }));
const failPending = (error) => { for (const task of pending.values()) task.reject(error); pending.clear(); };
child.once("error", () => failPending(Error("The isolated test browser could not start.")));
child.once("close", () => failPending(Error("The isolated test browser closed.")));
child.stdio[4].on("data", (chunk) => {
  buffer += chunk.toString();
  let end;
  while ((end = buffer.indexOf("\0")) >= 0) {
    const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
    if (!message.id) continue;
    const task = pending.get(message.id); pending.delete(message.id);
    if (message.error) task?.reject(Error(message.error.message)); else task?.resolve(message.result);
  }
});
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++sequence;
  const timeout = setTimeout(() => { pending.delete(id); reject(Error(`Browser check timed out: ${method}`)); }, 15000);
  pending.set(id, { resolve: (result) => { clearTimeout(timeout); resolve(result); }, reject: (error) => { clearTimeout(timeout); reject(error); } });
  child.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0");
});
try {
  const { targetInfos } = await send("Target.getTargets");
  const target = targetInfos.find((entry) => entry.type === "page");
  const { sessionId } = await send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw Error("A native document-image check failed inside the isolated browser.");
    return result.result.value;
  };
  await evaluate(bundle.outputFiles[0].text + `;
    window.checkQuality=async(file)=>{try{return {accepted:true,...await kycQuality.validateDocumentImageFile(file)}}
    catch(error){return {accepted:false,message:error.message}}};`);
  const results = await evaluate(`(async()=>{
    const checks=[];
    for(const [name,shade,text,width,height] of [['white-paper',255,true,1366,2048],['blank-paper',255,false,1366,2048],
      ['dark-image',10,false,1366,2048],['low-resolution',255,true,320,240]]){
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');
      ctx.fillStyle='rgb('+shade+','+shade+','+shade+')';ctx.fillRect(0,0,width,height);
      if(text){ctx.fillStyle='#111';ctx.font='bold 28px Arial';for(let y=140;y<height-140;y+=150)ctx.fillText('SYNTHETIC DOCUMENT QUALITY TEST',140,y);}
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg'));
      checks.push({name,...await checkQuality(new File([blob],name+'.jpg',{type:'image/jpeg'}))});
    }
    return checks;
  })()`);
  assert.equal(results[0].accepted, true);
  for (const result of results.slice(1)) assert.equal(result.accepted, false, result.name);
  for (const result of results) console.log(JSON.stringify(result));
  const samples = process.argv.find((arg) => arg.startsWith("--sample-directory="))?.slice(19);
  if (samples) {
    for (const name of ["ID4.jpg", "dti.jpg", "ID1.jpg", "bir.jpg"]) {
      const bytes = await fs.readFile(path.join(path.resolve(samples), name));
      const result = await evaluate(`(async()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(bytes.toString("base64"))}),c=>c.charCodeAt(0));
        return checkQuality(new File([bytes],'local-document.jpg',{type:'image/jpeg'}));})()`);
      console.log(JSON.stringify({ name, ...result }));
      assert.equal(result.accepted, true, `Native image-quality rejection: ${name}`);
    }
  }
} finally {
  if (!closed) { try { await send("Browser.close"); } catch {} }
  if (!closed) await Promise.race([stopped, new Promise((resolve) => setTimeout(resolve, 3000))]);
  if (!closed) { child.kill(); await stopped; }
  assert.equal(path.dirname(profile), path.resolve(os.tmpdir()));
  assert.ok(path.basename(profile).startsWith("rentifypro-kyc-quality-"));
  await fs.rm(profile, { recursive: true, force: true });
}
