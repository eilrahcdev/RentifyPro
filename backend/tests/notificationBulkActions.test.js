import test from "node:test";
import assert from "node:assert/strict";
import Notification from "../models/Notification.js";
import NotificationDelivery from "../models/NotificationDelivery.js";
import { archiveNotifications, deleteNotifications } from "../controllers/notification.controller.js";
import notificationRouter from "../routes/notification.routes.js";
import { protect } from "../middleware/auth.middleware.js";

const userId = "507f1f77bcf86cd799439011";
const otherUserId = "507f1f77bcf86cd799439012";
const id = (n) => `507f1f77bcf86cd7994390${String(n).padStart(2, "0")}`;
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const request = (ids, role = "user", archived = false) => ({ user: { _id: userId, role }, body: { ids, archived } });
const fixture = () => [
  { _id: id(1), user: userId, readAt: new Date(), archived_at: null },
  { _id: id(2), user: userId, readAt: null, archived_at: null },
  { _id: id(3), user: otherUserId, readAt: new Date(), archived_at: null },
  { _id: id(4), user: userId, readAt: null, archived_at: new Date() },
  { _id: id(5), user: userId, readAt: new Date(), archived_at: null },
];
const matches = (row, scope) => Object.entries(scope).every(([key, value]) => {
  if (value === null) return row[key] == null;
  if (typeof value === "object" && "$in" in value) return value.$in.map(String).includes(String(row[key]));
  if (typeof value === "object" && "$ne" in value) return row[key] != null;
  return String(row[key]) === String(value);
});
function setup(t, options = {}) {
  let rows = options.rows || fixture();
  const writes = [], cleanups = [], queries = [];
  t.mock.method(Notification, "find", (scope) => {
    queries.push(scope);
    if (options.lookupError) throw Error("Synthetic lookup failure");
    return { select: () => ({ lean: async () => rows.filter(row => matches(row, scope)).map(row => ({ ...row })) }) };
  });
  t.mock.method(Notification, "findOneAndUpdate", async (scope, update) => {
    writes.push({ action: "archive", scope, update });
    if (options.failId === scope._id) throw Error("Synthetic archive failure");
    if (options.raceId === scope._id) return null;
    const row = rows.find(item => matches(item, scope));
    if (!row) return null;
    Object.assign(row, update.$set);
    return { ...row };
  });
  t.mock.method(Notification, "findOneAndDelete", async (scope) => {
    writes.push({ action: "delete", scope });
    if (options.failId === scope._id) throw Error("Synthetic delete failure");
    if (options.raceId === scope._id) return null;
    const row = rows.find(item => matches(item, scope));
    if (!row) return null;
    rows = rows.filter(item => item !== row);
    return { ...row };
  });
  t.mock.method(NotificationDelivery, "deleteMany", async (scope) => {
    cleanups.push(scope);
    if (options.cleanupFailId === scope.notification) throw Error("Synthetic cleanup failure");
    return { deletedCount: 1 };
  });
  return { rows: () => rows, writes, cleanups, queries };
}

for (const [name, handler] of [["archive", archiveNotifications], ["delete", deleteNotifications]]) {
  for (const ids of [undefined, null, [], "all", ["bad-id"], [null], [3], [{ $ne: null }], Array(101).fill(id(1))]) {
    test(`${name} rejects invalid or unbounded ID arrays before querying`, async (t) => {
      const state = setup(t), res = response();
      await handler(request(ids), res);
      assert.equal(res.statusCode, 400);
      assert.equal(state.queries.length, 0);
      assert.equal(state.writes.length, 0);
      assert.equal(state.cleanups.length, 0);
    });
  }
  test(`${name} rejects a mixed selection containing another user's notification without changes`, async (t) => {
    const state = setup(t), res = response();
    await handler(request([id(1), id(3)]), res);
    assert.equal(res.statusCode, 409);
    assert.equal(state.queries[0].user, userId);
    assert.equal(state.writes.length, 0);
    assert.equal(state.cleanups.length, 0);
    assert.equal(state.rows().length, 5);
  });
  test(`${name} rejects stale view selections before changing any item`, async (t) => {
    const state = setup(t), res = response();
    await handler(request([id(1), id(4)]), res);
    assert.equal(res.statusCode, 409);
    assert.equal(state.writes.length, 0);
    assert.equal(state.cleanups.length, 0);
  });
  test(`${name} reports lookup failures without leaking internal error details`, async (t) => {
    const state = setup(t, { lookupError: true }), res = response();
    await handler(request([id(1)]), res);
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.message.includes("Synthetic"), false);
    assert.equal(state.writes.length, 0);
  });
}

for (const role of ["user", "owner"]) {
  test(`${role} archives only the selected read and unread notifications`, async (t) => {
    const state = setup(t), res = response();
    await archiveNotifications(request([id(1), id(2)], role), res);
    assert.equal(res.body.success, true);
    assert.deepEqual(res.body.processedIds, [id(1), id(2)]);
    assert.equal(res.body.processedCount, 2);
    assert.ok(state.rows().find(row => row._id === id(1)).archived_at instanceof Date);
    assert.equal(state.rows().find(row => row._id === id(2)).readAt, null);
    assert.equal(state.rows().find(row => row._id === id(5)).archived_at, null);
    assert.equal(state.rows().find(row => row._id === id(3)).archived_at, null);
    assert.equal(state.cleanups.length, 0);
    for (const write of state.writes) assert.equal(write.scope.user, userId);
  });
  test(`${role} deletes only selected active read notifications and their delivery records`, async (t) => {
    const state = setup(t), res = response();
    await deleteNotifications(request([id(1), id(5)], role), res);
    assert.deepEqual(res.body.processedIds, [id(1), id(5)]);
    assert.equal(res.body.success, true);
    assert.deepEqual(state.rows().map(row => row._id), [id(2), id(3), id(4)]);
    assert.deepEqual(state.cleanups, [{ user: userId, notification: id(1) }, { user: userId, notification: id(5) }]);
    for (const write of state.writes) assert.deepEqual(write.scope.readAt, { $ne: null });
  });
}

test("bulk delete requires an explicit boolean notification view", async (t) => {
  const state = setup(t);
  for (const archived of [undefined, null, "false", 1]) {
    const req = request([id(1)]); req.body.archived = archived;
    const res = response(); await deleteNotifications(req, res);
    assert.equal(res.statusCode, 400);
  }
  assert.equal(state.queries.length, 0);
});
test("active unread items prevent the entire bulk delete before delivery cleanup", async (t) => {
  const state = setup(t), res = response();
  await deleteNotifications(request([id(1), id(2)]), res);
  assert.equal(res.statusCode, 409);
  assert.equal(state.writes.length, 0);
  assert.equal(state.cleanups.length, 0);
});
test("archived unread notifications retain their existing deletion eligibility", async (t) => {
  const state = setup(t), res = response();
  await deleteNotifications(request([id(4)], "owner", true), res);
  assert.equal(res.body.success, true);
  assert.equal(state.rows().some(row => row._id === id(4)), false);
  assert.deepEqual(state.writes[0].scope.archived_at, { $ne: null });
  assert.equal("readAt" in state.writes[0].scope, false);
});
test("duplicate and uppercase IDs are normalized without repeated operations", async (t) => {
  const state = setup(t), res = response();
  await archiveNotifications(request([id(1), id(1).toUpperCase(), ` ${id(1)} `]), res);
  assert.deepEqual(res.body.processedIds, [id(1)]);
  assert.equal(state.writes.length, 1);
});
test("the exact 100-item batch boundary is accepted without truncating targets", async (t) => {
  const ids = Array.from({ length: 100 }, (_, index) => (1000 + index).toString(16).padStart(24, "0"));
  const state = setup(t, { rows: ids.map(value => ({ _id: value, user: userId, archived_at: null, readAt: null })) });
  const res = response(); await archiveNotifications(request(ids), res);
  assert.equal(res.body.success, true);
  assert.equal(res.body.processedCount, 100);
  assert.deepEqual(res.body.processedIds, ids);
  assert.equal(state.writes.length, 100);
});
test("legacy deleted notifications cannot be included in either batch action", async (t) => {
  const state = setup(t);
  state.rows().find(row => row._id === id(1)).deleted_at = new Date();
  for (const handler of [archiveNotifications, deleteNotifications]) {
    const res = response(); await handler(request([id(1)]), res);
    assert.equal(res.statusCode, 409);
  }
  assert.equal(state.writes.length, 0);
  assert.equal(state.cleanups.length, 0);
});
test("repeating a completed archive request cannot affect other notifications", async (t) => {
  const state = setup(t);
  await archiveNotifications(request([id(1)]), response());
  const res = response(); await archiveNotifications(request([id(1)]), res);
  assert.equal(res.statusCode, 409);
  assert.equal(state.writes.length, 1);
  assert.equal(state.rows().find(row => row._id === id(5)).archived_at, null);
});
for (const [handler, action] of [[archiveNotifications, "archive"], [deleteNotifications, "delete"]]) {
  for (const options of [{ failId: id(5) }, { raceId: id(5) }]) {
    test(`${action} reports confirmed successes separately from failures and races`, async (t) => {
      const state = setup(t, options), res = response();
      await handler(request([id(1), id(5)]), res);
      assert.equal(res.body.success, false);
      assert.deepEqual(res.body.processedIds, [id(1)]);
      assert.deepEqual(res.body.failedIds, [id(5)]);
      assert.equal(res.body.failedCount, 1);
      assert.equal(state.rows().some(row => row._id === id(5)), true);
    });
  }
}
test("delivery cleanup failure leaves the notification available for retry", async (t) => {
  const state = setup(t, { cleanupFailId: id(1) }), res = response();
  await deleteNotifications(request([id(1)]), res);
  assert.deepEqual(res.body.failedIds, [id(1)]);
  assert.equal(state.writes.length, 0);
  assert.equal(state.rows().some(row => row._id === id(1)), true);
});
test("batch routes precede parameter routes and retain authentication and authorization", async () => {
  const routes = notificationRouter.stack.filter(layer => layer.route).map(layer => layer.route);
  for (const [path, method] of [["/bulk/archive", "patch"], ["/bulk", "delete"]]) {
    const index = routes.findIndex(route => route.path === path && route.methods[method]);
    assert.ok(index >= 0 && index < routes.findIndex(route => route.path.startsWith("/:id")));
    assert.equal(routes[index].stack.length, 3);
    assert.equal(routes[index].stack[0].handle, protect);
    const res = response();
    await routes[index].stack[0].handle({ headers: {}, cookies: {} }, res, () => assert.fail("Unauthenticated request passed authentication"));
    assert.equal(res.statusCode, 401);
  }
});
