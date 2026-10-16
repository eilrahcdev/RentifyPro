export async function collectOverviewPages(fetchPage) {
  const fields = ["customers", "vehicles", "documents", "bookings"];
  const rows = Object.fromEntries(fields.map(field => [field, new Map()]));
  const alerts = new Map();
  const cursors = new Set();
  let cursor;
  let payload;
  do {
    payload = await fetchPage(cursor);
    for (const field of fields) for (const row of payload[field] || []) rows[field].set(row.id, row);
    for (const id of ["actionable-reports", "failed-admin-access", "pending-verification-notices"]) alerts.delete(id);
    for (const alert of payload.operationalAlerts || []) {
      const previous = alerts.get(alert.id);
      const global = ["actionable-reports", "failed-admin-access", "pending-verification-notices"].includes(alert.id);
      alerts.set(alert.id, { ...alert, count: global ? alert.count : (previous?.count || 0) + alert.count });
    }
    cursor = payload.page?.hasMore ? payload.page.nextCursor : null;
    if (payload.page?.hasMore && (!cursor || cursors.has(cursor))) throw new Error("The overview page changed unexpectedly. Refresh to load complete data.");
    if (cursor) cursors.add(cursor);
  } while (cursor);
  const combined = Object.fromEntries(fields.map(field => [field, [...rows[field].values()]]));
  const counts = { "overdue-returns": combined.bookings.filter(row => row.isOverdue).length,
    "pending-documents": combined.documents.filter(row => row.approval === "Pending" && row.reviewPurpose !== "Registration assistance").length,
    "registration-assistance": combined.documents.filter(row => row.approval === "Pending" && row.reviewPurpose === "Registration assistance").length,
    "outstanding-payments": combined.bookings.filter(row => row.paymentAmountDue > 0 && !["Cancelled", "Rejected"].includes(row.status)).length,
    "suspended-customers": combined.customers.filter(row => row.disabled).length,
    "unavailable-vehicles": combined.vehicles.filter(row => row.status !== "Available").length };
  return { ...payload, ...combined, operationalAlerts: [...alerts.values()].map(alert => ({ ...alert, count: counts[alert.id] ?? alert.count })).filter(alert => alert.count > 0) };
}
