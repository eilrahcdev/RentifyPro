export async function readApiResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (response.headers.get("X-RentifyPro-Proxy-Envelope") !== "1") return { response, data };
  if (!Number.isInteger(data.status) || data.status < 200 || data.status > 599 || !data.body || typeof data.body !== "object") {
    throw Object.assign(new Error("Could not read the response. Refresh your status and try again."), { status: 502 });
  }
  return { response: new Response(null, { status: data.status, headers: data.headers }), data: data.body };
}
