/* global Netlify */
const upstreamOrigin = "https://rentifypro-api.azurewebsites.net";
const longVerificationPath = /^\/api\/kyc\/(?:face\/detect|id-register|selfie\/verify|documents\/(?:id|supporting)|reverify\/(?:id-register|selfie\/verify)|pre\/(?:id-register|selfie\/verify|supporting-doc\/verify))\/?$/;

function streamVerification(pendingResponse, abort) {
  const encoder = new TextEncoder();
  let heartbeat;
  const body = new ReadableStream({
    start(controller) {
      // Send headers immediately while face-service startup/checks finish upstream.
      controller.enqueue(encoder.encode(" \n"));
      heartbeat = setInterval(() => controller.enqueue(encoder.encode(" \n")), 10000);
      void (async () => {
        let result;
        try {
          const response = await pendingResponse;
          if (response.headers.has("set-cookie")) throw new Error("Cookie-changing routes cannot be streamed");
          result = { status: response.status, body: await response.json(), headers: {
            "Retry-After": response.headers.get("Retry-After") || "", Date: response.headers.get("Date") || "",
          } };
        } catch {
          result = { status: 502, body: { message: "Could not finish verification. Refresh your status before trying again." } };
        } finally { clearInterval(heartbeat); }
        if (!abort.signal.aborted) {
          controller.enqueue(encoder.encode(JSON.stringify(result)));
          controller.close();
        }
      })();
    },
    cancel() { clearInterval(heartbeat); abort.abort(); },
  });
  return new Response(body, { headers: { "Content-Type": "application/json", "X-RentifyPro-Proxy-Envelope": "1",
    "Cache-Control": "private, no-store", "CDN-Cache-Control": "no-store", "Netlify-CDN-Cache-Control": "no-store" } });
}

export async function proxyRequest(request, { ip, secret, fetchUpstream = fetch, now = Date.now() }) {
  if (!secret || secret.length < 32 || !ip) {
    return Response.json({ success: false, message: "RentifyPro is temporarily unavailable. Please try again later." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const incoming = new URL(request.url);
  const target = new URL(upstreamOrigin);
  target.pathname = incoming.pathname;
  target.search = incoming.search;
  const timestamp = String(now);
  const canonical = `${timestamp}\n${ip}\n${request.method}\n${target.pathname}${target.search}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(canonical))), byte => byte.toString(16).padStart(2, "0")).join("");
  const headers = new Headers(request.headers);
  for (const name of ["host", "connection", "content-length", "forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto"]) headers.delete(name);
  headers.set("x-rentifypro-proxy-ip", ip);
  headers.set("x-rentifypro-proxy-time", timestamp);
  headers.set("x-rentifypro-proxy-signature", signature);
  headers.set("origin", request.headers.get("origin") || incoming.origin);
  try {
    const abort = new AbortController();
    const pendingResponse = fetchUpstream(new Request(target, {
      method: request.method, headers, redirect: "manual", signal: AbortSignal.any([request.signal, abort.signal]),
      ...(!["GET", "HEAD"].includes(request.method) ? { body: request.body, duplex: "half" } : {}),
    }));
    if (request.method === "POST" && longVerificationPath.test(target.pathname)) return streamVerification(pendingResponse, abort);
    const response = await pendingResponse;
    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("content-length");
    responseHeaders.set("Cache-Control", "private, no-store");
    responseHeaders.set("CDN-Cache-Control", "no-store");
    responseHeaders.set("Netlify-CDN-Cache-Control", "no-store");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders });
  } catch {
    return Response.json({ success: false, message: "Cannot connect to RentifyPro. Please try again." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}

export default async function handler(request, context) {
  return proxyRequest(request, { ip: context.ip, secret: Netlify.env.get("NETLIFY_PROXY_SECRET") });
}
