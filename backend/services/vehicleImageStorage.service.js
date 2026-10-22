import path from "node:path";
import { stat } from "node:fs/promises";
import { BlobServiceClient } from "@azure/storage-blob";

export const MAX_SHARED_VEHICLE_IMAGE_BYTES = 5 * 1024 * 1024;
const contentTypes = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
const provider = (env) => String(env.VEHICLE_IMAGE_STORAGE || "local").trim();

export function getVehicleImageStorageErrors(env = process.env) {
  if (provider(env) === "local") return [];
  if (provider(env) !== "azure") return ["VEHICLE_IMAGE_STORAGE must be local or azure."];
  const errors = [];
  const connection = String(env.VEHICLE_IMAGE_AZURE_CONNECTION_STRING || "").trim();
  if (!connection || /(?:DefaultEndpointsProtocol|BlobEndpoint)=http(?:;|:)/i.test(connection)
      || !/(?:DefaultEndpointsProtocol=https(?:;|$)|BlobEndpoint=https:\/\/)/i.test(connection)) {
    errors.push("VEHICLE_IMAGE_AZURE_CONNECTION_STRING must configure HTTPS Blob Storage.");
  }
  if (!/^(?!.*--)[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(env.VEHICLE_IMAGE_AZURE_CONTAINER || "vehicle-images")) {
    errors.push("VEHICLE_IMAGE_AZURE_CONTAINER must be a valid dedicated vehicle-image container name.");
  }
  return errors;
}

export function assertVehicleImageStorageConfiguration() {
  const errors = getVehicleImageStorageErrors();
  if (errors.length) throw new Error(errors.join("\n"));
  if (provider(process.env) === "azure") containerClient();
}

function containerClient() {
  const errors = getVehicleImageStorageErrors();
  if (errors.length) throw new Error(errors.join("\n"));
  if (provider(process.env) === "local") return null;
  try {
    return BlobServiceClient.fromConnectionString(process.env.VEHICLE_IMAGE_AZURE_CONNECTION_STRING, {
      retryOptions: { maxTries: 2, tryTimeoutInMs: 10000 },
    }).getContainerClient(process.env.VEHICLE_IMAGE_AZURE_CONTAINER || "vehicle-images");
  } catch {
    throw new Error("Shared vehicle image storage configuration is invalid.");
  }
}

export function vehicleImageContentType(filename) {
  if (!/^[a-z0-9][a-z0-9._-]{0,180}$/i.test(filename)) return "";
  return contentTypes[path.extname(filename).toLowerCase()] || "";
}

function blobClient(filename) {
  if (!vehicleImageContentType(filename)) throw new Error("Invalid managed vehicle image filename.");
  return containerClient()?.getBlockBlobClient(filename) || null;
}

export async function publishSharedVehicleImage(filename, localPath, { skipExisting = false } = {}) {
  const client = blobClient(filename);
  if (!client) return false;
  const file = await stat(localPath);
  if (!file.isFile() || file.size < 1 || file.size > MAX_SHARED_VEHICLE_IMAGE_BYTES) {
    throw new Error("Vehicle image exceeds the shared storage size limit.");
  }
  try {
    await client.uploadFile(localPath, {
      conditions: { ifNoneMatch: "*" },
      blobHTTPHeaders: { blobContentType: vehicleImageContentType(filename), blobCacheControl: "public, max-age=31536000, immutable" },
      abortSignal: AbortSignal.timeout(30000),
    });
    return true;
  } catch (error) {
    if (skipExisting && error.statusCode === 412) return false;
    throw new Error("Shared vehicle image storage could not save the photo.");
  }
}

export async function readSharedVehicleImage(filename) {
  const client = blobClient(filename);
  if (!client) return null;
  let stream;
  try {
    const result = await client.download(0, undefined, { abortSignal: AbortSignal.timeout(15000) });
    stream = result.readableStreamBody;
    if (!stream || result.contentLength > MAX_SHARED_VEHICLE_IMAGE_BYTES) throw new Error("Invalid image size.");
    let size = 0;
    const chunks = [];
    for await (const chunk of stream) {
      size += chunk.length;
      if (size > MAX_SHARED_VEHICLE_IMAGE_BYTES) throw new Error("Invalid image size.");
      chunks.push(chunk);
    }
    if (!size) throw new Error("Empty image.");
    return Buffer.concat(chunks);
  } catch (error) {
    if (error.code === "BlobNotFound") return null;
    throw new Error("Shared vehicle image storage could not read the photo.");
  } finally {
    stream?.destroy();
  }
}

export async function removeSharedVehicleImage(filename) {
  const client = blobClient(filename);
  if (!client) return false;
  try {
    return (await client.deleteIfExists({ abortSignal: AbortSignal.timeout(15000) })).succeeded;
  } catch {
    throw new Error("Shared vehicle image storage could not remove the photo.");
  }
}
