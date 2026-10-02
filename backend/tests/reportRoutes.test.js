import test from "node:test";
import assert from "node:assert/strict";

import adminRouter from "../routes/admin.routes.js";
import reportRouter from "../routes/report.routes.js";
import { requireModerationCapability } from "../middleware/moderation.middleware.js";
import { releaseExpiredModerationSuspension } from "../utils/accountModeration.js";
import { isMessageReportableBy } from "../controllers/report.controller.js";
import Report, {
  BOOKING_OWNER_REPORT_CATEGORIES,
  BOOKING_RENTER_REPORT_CATEGORIES,
  CHAT_MESSAGE_REPORT_CATEGORIES,
  REPORT_CATEGORIES,
} from "../models/Report.js";

const route = (router, path, method) => router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]);

test("report submission and case access are protected routes", () => {
  const createRoute = route(reportRouter, "/", "post");
  const mineRoute = route(reportRouter, "/mine", "get");
  const appealRoute = route(reportRouter, "/:id/appeal", "post");
  const messageRoute = route(reportRouter, "/messages/:messageId", "post");
  const globalMiddleware = reportRouter.stack.slice(0, reportRouter.stack.indexOf(mineRoute)).filter((layer) => !layer.route);

  assert.ok(createRoute);
  assert.ok(mineRoute);
  assert.ok(appealRoute);
  assert.ok(messageRoute);
  assert.ok(globalMiddleware.length >= 2);
  assert.ok(createRoute.route.stack.length >= 5, "submission should include role, rate limit, upload, validation, and controller layers");
});

test("only the receiver can report one visible incoming chat message", () => {
  const message = {
    sender: "64b000000000000000000001",
    receiver: "64b000000000000000000002",
    isDeleted: false,
  };
  assert.equal(isMessageReportableBy(message, message.receiver), true);
  assert.equal(isMessageReportableBy(message, message.sender), false);
  assert.equal(isMessageReportableBy({ ...message, isDeleted: true }, message.receiver), false);
  assert.equal(isMessageReportableBy({ ...message, receiver: "64b000000000000000000003" }, "64b000000000000000000002"), false);
});

test("report categories are scoped to their report section", () => {
  assert.ok(BOOKING_OWNER_REPORT_CATEGORIES.includes("unsafe_vehicle"));
  assert.ok(!BOOKING_OWNER_REPORT_CATEGORIES.includes("vehicle_damage"));
  assert.ok(BOOKING_RENTER_REPORT_CATEGORIES.includes("vehicle_damage"));
  assert.ok(!BOOKING_RENTER_REPORT_CATEGORIES.includes("unsafe_vehicle"));
  assert.ok(CHAT_MESSAGE_REPORT_CATEGORIES.includes("spam"));
  assert.ok(CHAT_MESSAGE_REPORT_CATEGORIES.includes("privacy_violation"));
  assert.ok(!CHAT_MESSAGE_REPORT_CATEGORIES.includes("payment_dispute"));
  assert.ok(!CHAT_MESSAGE_REPORT_CATEGORIES.includes("vehicle_damage"));

  for (const category of [
    ...BOOKING_OWNER_REPORT_CATEGORIES,
    ...BOOKING_RENTER_REPORT_CATEGORIES,
    ...CHAT_MESSAGE_REPORT_CATEGORIES,
  ]) {
    assert.ok(REPORT_CATEGORIES.includes(category));
  }
});

test("chat report cases require one message and use message-scoped uniqueness", async () => {
  const ids = [
    "64b000000000000000000001",
    "64b000000000000000000002",
    "64b000000000000000000003",
  ];
  const report = new Report({
    sourceType: "chat_message",
    reporter: ids[0],
    reportedUser: ids[1],
    reporterRole: "user",
    reportedRole: "owner",
    reportedMessage: ids[2],
    messageSnapshot: { text: "A single reported message", sender: ids[1], receiver: ids[0] },
    category: "harassment",
    description: "A specific incoming chat message was reported for review.",
  });
  await report.validate();
  assert.equal(report.booking, null);
  const messageIndex = Report.schema.indexes().find(([, options]) => options.name === "unique_message_report");
  assert.deepEqual(messageIndex?.[0], { reporter: 1, reportedMessage: 1 });
  assert.deepEqual(messageIndex?.[1]?.partialFilterExpression, { sourceType: "chat_message" });
});

test("admin exposes report review and decision routes behind admin authorization", () => {
  const listRoute = route(adminRouter, "/reports", "get");
  const updateRoute = route(adminRouter, "/reports/:id", "patch");
  const decisionRoute = route(adminRouter, "/reports/:id/decision", "post");
  const listIndex = adminRouter.stack.indexOf(listRoute);
  const globalMiddleware = adminRouter.stack.slice(0, listIndex).filter((layer) => !layer.route);

  assert.ok(listRoute);
  assert.ok(updateRoute);
  assert.ok(decisionRoute);
  assert.ok(globalMiddleware.length >= 2);
});

test("scoped moderation middleware blocks only an active capability restriction", () => {
  const middleware = requireModerationCapability("booking");
  let nextCalls = 0;
  const response = {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };

  middleware({ user: { role: "user", moderationRestrictions: { bookingUntil: new Date(Date.now() + 60_000) } } }, response, () => { nextCalls += 1; });
  assert.equal(response.statusCode, 403);
  assert.equal(response.payload.code, "MODERATION_RESTRICTION");
  assert.equal(nextCalls, 0);

  middleware({ user: { role: "user", moderationRestrictions: { bookingUntil: new Date(Date.now() - 60_000) } } }, response, () => { nextCalls += 1; });
  assert.equal(nextCalls, 1);
});

test("an expired report suspension is released without touching unrelated accounts", async () => {
  let updates = 0;
  const user = {
    _id: "64b000000000000000000001",
    isDisabled: true,
    disabledUntil: new Date(Date.now() - 60_000),
    disabledSourceReport: "64b000000000000000000002",
    disabledBy: "admin",
    disabledReason: "Temporary moderation suspension",
    constructor: {
      async updateOne(filter) {
        assert.equal(String(filter._id), user._id);
        updates += 1;
      },
    },
  };

  assert.equal(await releaseExpiredModerationSuspension(user), true);
  assert.equal(updates, 1);
  assert.equal(user.isDisabled, false);

  const unrelated = {
    ...user,
    isDisabled: true,
    disabledUntil: null,
    disabledSourceReport: null,
  };
  assert.equal(await releaseExpiredModerationSuspension(unrelated), false);
  assert.equal(updates, 1);
});
