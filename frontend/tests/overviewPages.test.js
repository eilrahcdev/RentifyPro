import test from "node:test";
import assert from "node:assert/strict";
import { collectOverviewPages } from "../src/admin/overviewPages.js";

test("overview pages preserve complete dashboard cohorts and do not multiply global alerts", async () => {
  const page = index => ({ customers: [{ id: `customer-${index}` }], documents: [{ id: `document-${index}`, approval: "Pending" }],
    operationalAlerts: [{ id: "pending-documents", count: 1 }, { id: "actionable-reports", count: 3 }],
    page: { hasMore: index === 1, nextCursor: index === 1 ? "next" : null } });
  const result = await collectOverviewPages(async cursor => page(cursor ? 2 : 1));
  assert.equal(result.customers.length, 2);
  assert.equal(result.documents.length, 2);
  assert.equal(result.operationalAlerts.find(alert => alert.id === "pending-documents").count, 2);
  assert.equal(result.operationalAlerts.find(alert => alert.id === "actionable-reports").count, 3);
});
test("incomplete or looping page responses never silently produce partial dashboards", async () => {
  await assert.rejects(collectOverviewPages(async () => ({ page: { hasMore: true, nextCursor: "same" } })), /complete data/);
  await assert.rejects(collectOverviewPages(async () => ({ page: { hasMore: true } })), /complete data/);
});

test("overview pages keep assistance counts separate from final approvals and retain queue navigation", async () => {
  const result = await collectOverviewPages(async cursor => ({
    documents: cursor ? [{ id: "submitted", approval: "Pending", reviewPurpose: "Final approval" }]
      : [{ id: "draft", approval: "Pending", reviewPurpose: "Registration assistance" }],
    operationalAlerts: cursor ? [{ id: "pending-documents", count: 1 }]
      : [{ id: "registration-assistance", count: 1, context: { purpose: "Registration assistance" } }],
    page: { hasMore: !cursor, nextCursor: cursor ? null : "next" },
  }));
  assert.equal(result.operationalAlerts.find(alert => alert.id === "pending-documents").count, 1);
  const assistance = result.operationalAlerts.find(alert => alert.id === "registration-assistance");
  assert.equal(assistance.count, 1);
  assert.equal(assistance.context.purpose, "Registration assistance");
});
