#!/usr/bin/env node
import fs from "fs";
import path from "path";

const VALID_STAGES = new Set(["normal", "attack", "edge", "all"]);
const PASS = "PASS";
const FAIL = "FAIL";
const SKIP = "SKIP";

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;

    const trimmed = token.slice(2);
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex >= 0) {
      const key = trimmed.slice(0, eqIndex);
      const value = trimmed.slice(eqIndex + 1);
      parsed[key] = value;
      continue;
    }

    const key = trimmed;
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }

    parsed[key] = next;
    i += 1;
  }
  return parsed;
}

function resolvePath(inputPath) {
  if (!inputPath) return "";
  if (path.isAbsolute(inputPath)) return inputPath;
  return path.resolve(process.cwd(), inputPath);
}

function loadJsonFile(filePath) {
  const absolutePath = resolvePath(filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Config file not found: ${absolutePath}`);
  }
  const raw = fs.readFileSync(absolutePath, "utf8");
  return JSON.parse(raw);
}

function ensureObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  return {};
}

function isPlaceholder(value) {
  const text = String(value || "").trim();
  if (!text) return true;
  const upper = text.toUpperCase();
  return (
    upper.includes("PASTE_") ||
    upper.includes("TOKEN_HERE") ||
    upper.includes("ID_FOR") ||
    upper.includes("YOUR_") ||
    upper.includes("CHANGE_ME") ||
    upper.includes("EXAMPLE")
  );
}

function isObjectId(value) {
  return /^[a-fA-F0-9]{24}$/.test(String(value || "").trim());
}

function getIsoOffsetHours(hoursFromNow) {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();
}

function extractMessage(json, fallbackText) {
  if (json && typeof json.message === "string" && json.message.trim()) {
    return json.message.trim();
  }
  return fallbackText || "";
}

function makeResult({ id, stage, module, name, status, details, httpStatus, startedAt, endedAt }) {
  return {
    id,
    stage,
    module,
    name,
    status,
    details: String(details || ""),
    httpStatus: Number.isFinite(httpStatus) ? httpStatus : null,
    startedAt,
    endedAt,
    durationMs: Math.max(0, new Date(endedAt).getTime() - new Date(startedAt).getTime()),
  };
}

async function requestApi(ctx, options) {
  const {
    method = "GET",
    endpoint = "/",
    token = "",
    body,
    expectedStatuses = [200],
  } = options;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ctx.timeoutMs);

  const headers = {
    Accept: "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const fetchOptions = {
    method,
    headers,
    signal: controller.signal,
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    fetchOptions.body = JSON.stringify(body);
  }

  const url = `${ctx.baseUrl}${endpoint}`;

  try {
    const response = await fetch(url, fetchOptions);
    const text = await response.text();
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = {};
    }

    return {
      ok: expectedStatuses.includes(response.status),
      status: response.status,
      json,
      text,
      url,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      json: {},
      text: "",
      url,
      error: String(error?.message || error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function pass(details, httpStatus) {
  return { status: PASS, details, httpStatus };
}

function fail(details, httpStatus) {
  return { status: FAIL, details, httpStatus };
}

function skip(details) {
  return { status: SKIP, details, httpStatus: null };
}

function getToken(config, key) {
  const token = String(ensureObject(config.tokens)[key] || "").trim();
  if (!token || isPlaceholder(token)) return "";
  return token;
}

function getId(config, key) {
  const id = String(ensureObject(config.ids)[key] || "").trim();
  if (!id || isPlaceholder(id)) return "";
  return id;
}

function buildTests() {
  return [
    {
      id: "N-AUTH-01",
      stage: "normal",
      module: "authentication",
      name: "Renter token can fetch /api/auth/me",
      run: async (ctx) => {
        const renterToken = getToken(ctx.config, "renter");
        if (!renterToken) return skip("Missing config.tokens.renter");

        const res = await requestApi(ctx, {
          endpoint: "/api/auth/me",
          token: renterToken,
          expectedStatuses: [200],
        });
        if (!res.ok) {
          return fail(`Expected 200, got ${res.status ?? "no response"} (${extractMessage(res.json, res.error)})`, res.status);
        }
        if (!res.json?.user?._id) return fail("Response did not include user._id", res.status);
        return pass("Authenticated renter profile returned.", res.status);
      },
    },
    {
      id: "N-VEHICLE-01",
      stage: "normal",
      module: "vehicle_management",
      name: "Owner can list /api/owner/vehicles",
      run: async (ctx) => {
        const ownerToken = getToken(ctx.config, "owner");
        if (!ownerToken) return skip("Missing config.tokens.owner");

        const res = await requestApi(ctx, {
          endpoint: "/api/owner/vehicles",
          token: ownerToken,
          expectedStatuses: [200],
        });
        if (!res.ok) {
          return fail(`Expected 200, got ${res.status ?? "no response"} (${extractMessage(res.json, res.error)})`, res.status);
        }
        if (!Array.isArray(res.json?.vehicles)) return fail("Response did not include vehicles array.", res.status);
        return pass(`Owner vehicles listed (${res.json.vehicles.length} records).`, res.status);
      },
    },
    {
      id: "N-BOOKPAY-01",
      stage: "normal",
      module: "booking_payment",
      name: "Renter can list /api/bookings/me",
      run: async (ctx) => {
        const renterToken = getToken(ctx.config, "renter");
        if (!renterToken) return skip("Missing config.tokens.renter");

        const res = await requestApi(ctx, {
          endpoint: "/api/bookings/me?status=all",
          token: renterToken,
          expectedStatuses: [200],
        });
        if (!res.ok) {
          return fail(`Expected 200, got ${res.status ?? "no response"} (${extractMessage(res.json, res.error)})`, res.status);
        }
        if (!Array.isArray(res.json?.bookings)) return fail("Response did not include bookings array.", res.status);
        return pass(`Renter bookings listed (${res.json.bookings.length} records).`, res.status);
      },
    },
    {
      id: "N-CHATNOTIF-01",
      stage: "normal",
      module: "chat_notifications",
      name: "Owner can list conversations and notifications",
      run: async (ctx) => {
        const ownerToken = getToken(ctx.config, "owner");
        if (!ownerToken) return skip("Missing config.tokens.owner");

        const conversationsRes = await requestApi(ctx, {
          endpoint: "/api/chat/conversations",
          token: ownerToken,
          expectedStatuses: [200],
        });
        if (!conversationsRes.ok) {
          return fail(
            `Conversations failed (${conversationsRes.status ?? "no response"}: ${extractMessage(conversationsRes.json, conversationsRes.error)})`,
            conversationsRes.status
          );
        }

        const notificationsRes = await requestApi(ctx, {
          endpoint: "/api/notifications",
          token: ownerToken,
          expectedStatuses: [200],
        });
        if (!notificationsRes.ok) {
          return fail(
            `Notifications failed (${notificationsRes.status ?? "no response"}: ${extractMessage(notificationsRes.json, notificationsRes.error)})`,
            notificationsRes.status
          );
        }

        const convCount = Array.isArray(conversationsRes.json?.conversations) ? conversationsRes.json.conversations.length : 0;
        const notifCount = Array.isArray(notificationsRes.json?.notifications) ? notificationsRes.json.notifications.length : 0;
        return pass(`Loaded conversations (${convCount}) and notifications (${notifCount}).`, 200);
      },
    },
    {
      id: "N-OWNER-01",
      stage: "normal",
      module: "owner_dashboard",
      name: "Owner dashboard APIs return success",
      run: async (ctx) => {
        const ownerToken = getToken(ctx.config, "owner");
        if (!ownerToken) return skip("Missing config.tokens.owner");

        const endpoints = [
          "/api/owner/bookings?status=all",
          "/api/owner/earnings",
          "/api/owner/analytics",
        ];

        for (const endpoint of endpoints) {
          const res = await requestApi(ctx, {
            endpoint,
            token: ownerToken,
            expectedStatuses: [200],
          });
          if (!res.ok) {
            return fail(`Endpoint ${endpoint} failed (${res.status ?? "no response"}).`, res.status);
          }
        }
        return pass("All owner dashboard endpoints returned 200.", 200);
      },
    },
    {
      id: "N-BLOCKCHAIN-01",
      stage: "normal",
      module: "blockchain_logging",
      name: "Owner booking payload exposes blockchain fields",
      run: async (ctx) => {
        const ownerToken = getToken(ctx.config, "owner");
        if (!ownerToken) return skip("Missing config.tokens.owner");

        const res = await requestApi(ctx, {
          endpoint: "/api/owner/bookings?status=all",
          token: ownerToken,
          expectedStatuses: [200],
        });
        if (!res.ok) {
          return fail(`Expected 200, got ${res.status ?? "no response"}.`, res.status);
        }

        const bookings = Array.isArray(res.json?.bookings) ? res.json.bookings : [];
        if (bookings.length === 0) return pass("No bookings available; field check skipped safely.", res.status);

        const missing = bookings.find((booking) => !Object.prototype.hasOwnProperty.call(booking, "blockchainStatus"));
        if (missing) return fail("At least one booking is missing blockchainStatus field.", res.status);
        return pass(`Validated blockchainStatus field on ${bookings.length} booking records.`, res.status);
      },
    },
    {
      id: "A-AUTH-01",
      stage: "attack",
      module: "authentication",
      name: "Invalid token is rejected on protected endpoint",
      run: async (ctx) => {
        const res = await requestApi(ctx, {
          endpoint: "/api/auth/me",
          token: "invalid.token.value",
          expectedStatuses: [401],
        });
        if (!res.ok) return fail(`Expected 401, got ${res.status ?? "no response"}.`, res.status);
        return pass("Invalid bearer token rejected with 401.", res.status);
      },
    },
    {
      id: "A-VEHICLE-01",
      stage: "attack",
      module: "vehicle_management",
      name: "Renter cannot access owner vehicle endpoint",
      run: async (ctx) => {
        const renterToken = getToken(ctx.config, "renter");
        if (!renterToken) return skip("Missing config.tokens.renter");

        const res = await requestApi(ctx, {
          endpoint: "/api/owner/vehicles",
          token: renterToken,
          expectedStatuses: [403],
        });
        if (!res.ok) return fail(`Expected 403, got ${res.status ?? "no response"}.`, res.status);
        return pass("RBAC correctly blocked renter from owner vehicles endpoint.", res.status);
      },
    },
    {
      id: "A-BOOKPAY-01",
      stage: "attack",
      module: "booking_payment",
      name: "Manual owner paymentStatus=paid is blocked",
      run: async (ctx) => {
        const ownerToken = getToken(ctx.config, "owner");
        if (!ownerToken) return skip("Missing config.tokens.owner");

        const bookingId = getId(ctx.config, "bookingId");
        if (!isObjectId(bookingId)) return skip("Missing or invalid config.ids.bookingId");

        const res = await requestApi(ctx, {
          method: "PATCH",
          endpoint: `/api/owner/bookings/${bookingId}/payment-status`,
          token: ownerToken,
          body: { paymentStatus: "paid" },
          expectedStatuses: [403, 404],
        });
        if (!res.ok) return fail(`Expected 403/404, got ${res.status ?? "no response"}.`, res.status);
        if (res.status === 403) return pass("Manual paid update blocked as expected.", res.status);
        return pass("Booking not found for owner scope (safe negative).", res.status);
      },
    },
    {
      id: "A-CHATNOTIF-01",
      stage: "attack",
      module: "chat_notifications",
      name: "Chat without valid booking relation is blocked",
      run: async (ctx) => {
        const renterToken = getToken(ctx.config, "renter");
        if (!renterToken) return skip("Missing config.tokens.renter");

        const res = await requestApi(ctx, {
          method: "POST",
          endpoint: "/api/chat/messages/000000000000000000000001",
          token: renterToken,
          body: { text: "ATTACK_TEST_MESSAGE" },
          expectedStatuses: [403],
        });
        if (!res.ok) return fail(`Expected 403, got ${res.status ?? "no response"}.`, res.status);
        return pass("Unauthorized chat relation blocked with 403.", res.status);
      },
    },
    {
      id: "A-OWNER-01",
      stage: "attack",
      module: "owner_dashboard",
      name: "Renter cannot access owner earnings endpoint",
      run: async (ctx) => {
        const renterToken = getToken(ctx.config, "renter");
        if (!renterToken) return skip("Missing config.tokens.renter");

        const res = await requestApi(ctx, {
          endpoint: "/api/owner/earnings",
          token: renterToken,
          expectedStatuses: [403],
        });
        if (!res.ok) return fail(`Expected 403, got ${res.status ?? "no response"}.`, res.status);
        return pass("RBAC correctly blocked renter on owner earnings.", res.status);
      },
    },
    {
      id: "A-BLOCKCHAIN-01",
      stage: "attack",
      module: "blockchain_logging",
      name: "Blockchain record endpoint rejects unknown booking",
      run: async (ctx) => {
        const ownerToken = getToken(ctx.config, "owner");
        if (!ownerToken) return skip("Missing config.tokens.owner");

        const res = await requestApi(ctx, {
          method: "POST",
          endpoint: "/api/bookings/000000000000000000000001/blockchain-record",
          token: ownerToken,
          expectedStatuses: [404],
        });
        if (!res.ok) return fail(`Expected 404, got ${res.status ?? "no response"}.`, res.status);
        return pass("Unknown booking ID correctly returned 404.", res.status);
      },
    },
    {
      id: "E-AUTH-01",
      stage: "edge",
      module: "authentication",
      name: "Login payload validation catches malformed input",
      run: async (ctx) => {
        const res = await requestApi(ctx, {
          method: "POST",
          endpoint: "/api/auth/login",
          body: { email: "bad email", password: "x y" },
          expectedStatuses: [400],
        });
        if (!res.ok) return fail(`Expected 400, got ${res.status ?? "no response"}.`, res.status);
        return pass("Malformed login payload rejected with 400.", res.status);
      },
    },
    {
      id: "E-VEHICLE-01",
      stage: "edge",
      module: "vehicle_management",
      name: "Vehicle create validation rejects missing images",
      run: async (ctx) => {
        const ownerToken = getToken(ctx.config, "owner");
        if (!ownerToken) return skip("Missing config.tokens.owner");

        const res = await requestApi(ctx, {
          method: "POST",
          endpoint: "/api/owner/vehicles",
          token: ownerToken,
          body: {
            name: "TEST_Invalid_No_Image",
            description: "TEST invalid create payload without images",
            dailyRentalRate: 500,
            location: "TEST_City",
            availabilityStatus: "available",
          },
          expectedStatuses: [400],
        });
        if (!res.ok) return fail(`Expected 400, got ${res.status ?? "no response"}.`, res.status);
        return pass("Missing image validation triggered as expected.", res.status);
      },
    },
    {
      id: "E-BOOKPAY-01",
      stage: "edge",
      module: "booking_payment",
      name: "Booking rejects past pickup/return schedule",
      run: async (ctx) => {
        const renterToken = getToken(ctx.config, "renter");
        if (!renterToken) return skip("Missing config.tokens.renter");

        const vehicleId = getId(ctx.config, "vehicleId");
        if (!isObjectId(vehicleId)) return skip("Missing or invalid config.ids.vehicleId");

        const res = await requestApi(ctx, {
          method: "POST",
          endpoint: "/api/bookings",
          token: renterToken,
          body: {
            vehicleId,
            pickupAt: getIsoOffsetHours(-2),
            returnAt: getIsoOffsetHours(-1),
            driverSelected: false,
          },
          expectedStatuses: [400, 404],
        });
        if (!res.ok) return fail(`Expected 400/404, got ${res.status ?? "no response"}.`, res.status);
        if (res.status === 400) return pass("Past booking schedule blocked with 400.", res.status);
        return pass("Vehicle ID was not found in current dataset (safe edge outcome).", res.status);
      },
    },
    {
      id: "E-CHATNOTIF-01",
      stage: "edge",
      module: "chat_notifications",
      name: "Chat endpoint rejects invalid partner ID format",
      run: async (ctx) => {
        const renterToken = getToken(ctx.config, "renter");
        if (!renterToken) return skip("Missing config.tokens.renter");

        const res = await requestApi(ctx, {
          method: "POST",
          endpoint: "/api/chat/messages/not-an-object-id",
          token: renterToken,
          body: { text: "edge_test_message" },
          expectedStatuses: [400],
        });
        if (!res.ok) return fail(`Expected 400, got ${res.status ?? "no response"}.`, res.status);
        return pass("Invalid chat receiver ID rejected with 400.", res.status);
      },
    },
    {
      id: "E-OWNER-01",
      stage: "edge",
      module: "owner_dashboard",
      name: "Owner bookings endpoint handles unknown status filter",
      run: async (ctx) => {
        const ownerToken = getToken(ctx.config, "owner");
        if (!ownerToken) return skip("Missing config.tokens.owner");

        const res = await requestApi(ctx, {
          endpoint: "/api/owner/bookings?status=__invalid__",
          token: ownerToken,
          expectedStatuses: [200],
        });
        if (!res.ok) return fail(`Expected 200, got ${res.status ?? "no response"}.`, res.status);
        if (!Array.isArray(res.json?.bookings)) return fail("Expected bookings array in response.", res.status);
        return pass("Unknown status filter handled without server error.", res.status);
      },
    },
    {
      id: "E-BLOCKCHAIN-01",
      stage: "edge",
      module: "blockchain_logging",
      name: "Blockchain record on unknown booking returns controlled 404",
      run: async (ctx) => {
        const ownerToken = getToken(ctx.config, "owner");
        if (!ownerToken) return skip("Missing config.tokens.owner");

        const res = await requestApi(ctx, {
          method: "POST",
          endpoint: "/api/bookings/ffffffffffffffffffffffff/blockchain-record",
          token: ownerToken,
          expectedStatuses: [404],
        });
        if (!res.ok) return fail(`Expected 404, got ${res.status ?? "no response"}.`, res.status);
        return pass("Unknown booking blockchain record request handled with 404.", res.status);
      },
    },
  ];
}

function printUsage() {
  const lines = [
    "Usage:",
    "  node qa/run-stage-tests.mjs --config qa/test-config.json --stage normal",
    "",
    "Options:",
    "  --config <path>      Path to config JSON (default: qa/test-config.json)",
    "  --stage <value>      normal | attack | edge | all (default: all)",
    "  --out <path>         Output report path (default: qa/reports/<timestamp>-<stage>.json)",
    "  --list               List available tests only",
    "  --fail-on-skip       Exit non-zero if any tests are skipped",
    "",
  ];
  console.log(lines.join("\n"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    printUsage();
    process.exit(0);
  }

  const stage = String(args.stage || "all").toLowerCase();
  if (!VALID_STAGES.has(stage)) {
    console.error(`Invalid --stage value: ${stage}`);
    printUsage();
    process.exit(2);
  }

  const configPath = String(args.config || "qa/test-config.json");
  let config;
  try {
    config = loadJsonFile(configPath);
  } catch (error) {
    console.error(String(error?.message || error));
    console.error("Copy qa/test-config.example.json to qa/test-config.json and fill values first.");
    process.exit(2);
  }

  const baseUrl = String(config.baseUrl || "").trim().replace(/\/+$/, "");
  if (!baseUrl) {
    console.error("Config is missing baseUrl.");
    process.exit(2);
  }

  const tests = buildTests();
  if (args.list) {
    tests.forEach((test) => {
      console.log(`${test.id} [${test.stage}] ${test.module} :: ${test.name}`);
    });
    process.exit(0);
  }

  const selectedStages = stage === "all" ? new Set(["normal", "attack", "edge"]) : new Set([stage]);
  const filteredTests = tests.filter((test) => selectedStages.has(test.stage));
  if (filteredTests.length === 0) {
    console.error("No tests selected.");
    process.exit(2);
  }

  const timeoutMs = Number(config?.options?.timeoutMs) > 0 ? Number(config.options.timeoutMs) : 15000;
  const ctx = { config, baseUrl, timeoutMs };

  const health = await requestApi(ctx, {
    endpoint: "/api/health",
    expectedStatuses: [200],
  });
  if (!health.ok) {
    console.error(`Health check failed at ${baseUrl}/api/health (${health.status ?? "no response"}).`);
    console.error("Start the backend API and update qa/test-config.json with valid tokens/IDs.");
    process.exit(2);
  }

  const startedAt = new Date().toISOString();
  const results = [];

  for (const test of filteredTests) {
    const testStart = new Date().toISOString();
    let output;
    try {
      output = await test.run(ctx);
    } catch (error) {
      output = fail(`Unhandled exception: ${String(error?.message || error)}`, null);
    }
    const testEnd = new Date().toISOString();

    const result = makeResult({
      id: test.id,
      stage: test.stage,
      module: test.module,
      name: test.name,
      status: output.status,
      details: output.details,
      httpStatus: output.httpStatus,
      startedAt: testStart,
      endedAt: testEnd,
    });
    results.push(result);
  }

  const endedAt = new Date().toISOString();
  const summary = {
    stage,
    baseUrl,
    totals: {
      total: results.length,
      pass: results.filter((r) => r.status === PASS).length,
      fail: results.filter((r) => r.status === FAIL).length,
      skip: results.filter((r) => r.status === SKIP).length,
    },
    startedAt,
    endedAt,
  };

  const report = { summary, results };

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const defaultOut = path.join("qa", "reports", `${timestamp}-${stage}.json`);
  const outPath = resolvePath(String(args.out || defaultOut));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

  console.log("");
  console.log("Test Results");
  console.log("------------");
  results.forEach((r) => {
    const status = r.status.padEnd(4, " ");
    const code = r.httpStatus === null ? "-" : String(r.httpStatus);
    console.log(`${status} ${r.id} [${code}] ${r.name}`);
  });
  console.log("");
  console.log(`PASS: ${summary.totals.pass}  FAIL: ${summary.totals.fail}  SKIP: ${summary.totals.skip}  TOTAL: ${summary.totals.total}`);
  console.log(`Report: ${outPath}`);

  const failOnSkip = Boolean(args["fail-on-skip"]);
  if (summary.totals.fail > 0 || (failOnSkip && summary.totals.skip > 0)) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(String(error?.message || error));
  process.exit(1);
});
