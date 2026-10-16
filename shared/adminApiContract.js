export const ADMIN_API_CONTRACT_VERSION = "2.2.0";

export const ADMIN_API_ROUTES = Object.freeze({
  overview: "/admin/data",
  transactions: "/admin/transactions",
  auditLogs: "/admin/audit-logs",
  reports: "/admin/reports",
  reportTriage: "/admin/reports/:id",
  reportDecision: "/admin/reports/:id/decision",
  updateCustomer: "/admin/customers/:id",
  customerStatus: "/admin/customers/:id/status",
  archiveCustomer: "/admin/customers/:id/archive",
});

export const ADMIN_CUSTOMER_EDITABLE_FIELDS = Object.freeze(["name", "email", "phone", "role"]);
export const ADMIN_CRITICAL_ACTION_FIELDS = Object.freeze(["adminPassword", "reason"]);
