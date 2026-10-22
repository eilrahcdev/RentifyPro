import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarDays, Database, Eye, EyeOff, LoaderCircle, RefreshCw } from "lucide-react";
import { AdminPageHeader, AdminSidebar } from "./src/admin/components/AdminShell";
import {
  ConfirmationDialog,
  DocumentReviewDialog,
  FilterSelect,
  Toast,
  ViewerDialog,
} from "./src/admin/components/AdminUI";
import { monthOptions } from "./src/admin/analyticsPeriods";
import { adminDataApi } from "./src/admin/adminDataApi";
import { startOverviewRefresh } from "./src/admin/overviewRefresh";
import BookingsView from "./src/admin/pages/BookingsView";
import CustomersView from "./src/admin/pages/CustomersView";
import DashboardView from "./src/admin/pages/DashboardView";
import DocumentsView from "./src/admin/pages/DocumentsView";
import VehiclesView from "./src/admin/pages/VehiclesView";
import TransactionRecords from "./src/admin/pages/TransactionRecords";
import AuditLogsView from "./src/admin/pages/AuditLogsView";
import SecurityView from "./src/admin/pages/SecurityView";
import ReportsView from "./src/admin/pages/ReportsView";

const pageMeta = {
  dashboard: {
    title: "Dashboard",
    description: "Monitor operations, vehicles, documents, and customer activity in one place.",
  },
  bookings: {
    title: "Bookings",
    description: "Monitor platform rental activity, scheduling, and overdue returns without exposing operator finances.",
  },
  vehicles: {
    title: "Vehicles",
    description: "Manage your fleet, monitor availability, and review rental-ready units.",
  },
  customers: {
    title: "Customers",
    description: "Manage renters and operators with clear filters and quick access to account details.",
  },
  documents: {
    title: "Documents",
    description: "Review verification uploads from registered customers and registration applicants.",
  },
  transactions: {
    title: "Transaction Records",
    description: "Review payment activity across every renter, operator, and booking.",
  },
  reports: {
    title: "User Reports",
    description: "Review reports, inspect evidence, request more information, and issue fair moderation decisions.",
  },
  audit: {
    title: "Audit Logs",
    description: "Review Super Admin security events and sensitive management decisions.",
  },
  security: {
    title: "Security",
    description: "Control passkey protection, email backup, and active Super Admin sessions.",
  },
};

export default function AdminAccountPage({ user, onLogout }) {
  const [activeView, setActiveView] = useState("dashboard");
  const [viewContext, setViewContext] = useState({});
  const [dashboardPeriod, setDashboardPeriod] = useState(() => monthKey(new Date()));
  const [customers, setCustomers] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [operationalAlerts, setOperationalAlerts] = useState([]);
  const [loadState, setLoadState] = useState("loading");
  const [loadError, setLoadError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [transactionRefreshSignal, setTransactionRefreshSignal] = useState(0);
  const [transactionRefreshing, setTransactionRefreshing] = useState(false);
  const [transactionsVisible, setTransactionsVisible] = useState(true);
  const [syncedAt, setSyncedAt] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [viewerItem, setViewerItem] = useState(null);
  const [reviewDocument, setReviewDocument] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const feedbackTimerRef = useRef(null);
  const actionLockRef = useRef(false);
  const mobileMenuButtonRef = useRef(null);

  const displayName = user?.name || "Admin";
  const displayEmail = user?.email || "admin@example.com";
  const dashboardPeriodOptions = useMemo(() => {
    const dates = bookings.map((booking) => booking.pickupAt || booking.createdAt);
    const options = monthOptions(dates);
    // Recorded future pickups remain available in the scheduling calendar.
    dates.forEach((date) => {
      const value = monthKey(date);
      if (value > monthKey(new Date()) && !options.some((option) => option.value === value)) {
        const [year, month] = value.split("-").map(Number);
        options.push({ value, label: new Date(year, month - 1, 1).toLocaleDateString("en-PH", { month: "long", year: "numeric" }) });
      }
    });
    return options.sort((first, second) => second.value.localeCompare(first.value));
  }, [bookings]);

  const showFeedback = useCallback((message, tone = "success") => {
    window.clearTimeout(feedbackTimerRef.current);
    setFeedback({ message, tone });
    feedbackTimerRef.current = tone === "error" ? null : window.setTimeout(() => setFeedback(null), 6000);
  }, []);

  const closeMobileNav = useCallback(() => {
    setMobileNavOpen(false);
    window.requestAnimationFrame(() => mobileMenuButtonRef.current?.focus());
  }, []);

  const overviewRequest = useRef(0);
  const overviewInFlight = useRef(0);
  const invalidateOverview = useCallback(() => { overviewRequest.current++; }, []);
  const loadAdminData = useCallback(async ({ background = false, notify = true } = {}) => {
    const requestId = ++overviewRequest.current;
    overviewInFlight.current++;
    if (background) setRefreshing(true);
    else setLoadState("loading");

    try {
      const payload = await adminDataApi.getOverview();
      if (requestId !== overviewRequest.current) return;
      setCustomers(Array.isArray(payload.customers) ? payload.customers : []);
      setVehicles(Array.isArray(payload.vehicles) ? payload.vehicles : []);
      setDocuments(Array.isArray(payload.documents) ? payload.documents : []);
      setBookings(Array.isArray(payload.bookings) ? payload.bookings : []);
      setOperationalAlerts(Array.isArray(payload.operationalAlerts) ? payload.operationalAlerts : []);
      setSyncedAt(payload.syncedAt || new Date().toISOString());
      setLoadError("");
      setLoadState("ready");
      if (background && notify) showFeedback("Dashboard data refreshed from RentifyPro.");
      return payload;
    } catch (error) {
      if (requestId !== overviewRequest.current) return;
      setLoadError(error.message);
      if (background) { if (notify) showFeedback(error.message, "error"); }
      else {
        setLoadError(error.message);
        setLoadState("error");
      }
    } finally {
      overviewInFlight.current--;
      if (requestId === overviewRequest.current) setRefreshing(false);
    }
  }, [showFeedback]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadAdminData(), 0);
    return () => { window.clearTimeout(initialLoad); invalidateOverview(); };
  }, [loadAdminData, invalidateOverview]);

  useEffect(() => {
    if (loadState !== "ready" || ["transactions", "reports", "audit", "security"].includes(activeView)) return;
    return startOverviewRefresh({
      refresh: () => loadAdminData({ background: true, notify: false }),
      isBusy: () => overviewInFlight.current > 0,
      isPaused: () => Boolean(viewerItem || reviewDocument || confirmation || actionLoading),
    });
  }, [activeView, loadState, viewerItem, reviewDocument, confirmation, actionLoading, loadAdminData]);

  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key === "Escape" && !event.defaultPrevented && mobileNavOpen) closeMobileNav();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [closeMobileNav, mobileNavOpen]);

  useEffect(() => () => window.clearTimeout(feedbackTimerRef.current), []);

  const selectView = (view, context = {}) => {
    setActiveView(view);
    setViewContext(context);
    setMobileNavOpen(false);
    if (mobileNavOpen) window.requestAnimationFrame(() => document.getElementById("admin-main-content")?.focus());
  };

  const requestConfirmation = (config) => {
    if (!actionLoading) setConfirmation(config);
  };

  const confirmAction = async (values = {}) => {
    if (!confirmation || actionLoading || actionLockRef.current) return;
    const pendingAction = confirmation;
    actionLockRef.current = true;
    setActionLoading(true);

    try {
      await pendingAction.onConfirm(values);
      setConfirmation(null);
    } catch (error) {
      showFeedback(error.message || "The action could not be completed.", "error");
    } finally {
      actionLockRef.current = false;
      setActionLoading(false);
    }
  };

  const viewVehicle = (vehicle) => setViewerItem({
    type: "Vehicle details",
    vehicle,
    title: vehicle.name,
    subtitle: `${vehicle.plateNumber} · ${vehicle.category} · ${vehicle.location} · ${vehicle.rentalRate}`,
    previewUrl: vehicle.image,
    mimeType: "image/*",
  });

  const viewCustomer = (customer) => {
    const customerDocuments = documents.filter(
      (document) => !document.ownershipConflict && document.accountLink?.status === "registered"
        && String(document.accountLink.customerId) === String(customer.id),
    );

    setViewerItem({
      type: "Customer profile",
      title: customer.name,
      customer,
      documents: customerDocuments,
    });
  };

  const updateCustomer = async (customer, changes) => {
    const payload = await adminDataApi.updateCustomer(customer.id, changes);
    setCustomers((current) => current.map((item) => item.id === customer.id ? payload.customer : item));
    showFeedback("Customer account updated.");
    await loadAdminData({ background: true, notify: false });
  };

  const requestCustomerStatusChange = (customer) => {
    const disabling = !customer.disabled;
    requestConfirmation({
      tone: disabling ? "danger" : "primary",
      title: `${disabling ? "Disable" : "Enable"} ${customer.name}?`,
      description: disabling
        ? "This customer will be signed out and blocked from logging in until an administrator enables the account."
        : "This customer will be allowed to log in and use RentifyPro again.",
      confirmLabel: `${disabling ? "Disable" : "Enable"} account`,
      requireReason: true,
      requirePassword: true,
      onConfirm: async ({ reason, adminPassword }) => {
        const payload = await adminDataApi.setCustomerDisabled(customer.id, { disabled: disabling, reason, adminPassword });
        setCustomers((current) => current.map((item) => item.id === customer.id ? payload.customer : item));
        showFeedback(payload.message);
        await loadAdminData({ background: true, notify: false });
      },
    });
  };

  const requestCustomerDeletion = (customer) => {
    requestConfirmation({
      tone: "danger",
      title: `Archive and anonymize ${customer.name}?`,
      description: "This blocks access, removes identity and verification data, and preserves anonymized booking history for operational records. Active bookings must be resolved first.",
      confirmLabel: "Archive account",
      requireReason: true,
      requirePassword: true,
      onConfirm: async ({ reason, adminPassword }) => {
        const payload = await adminDataApi.archiveCustomer(customer.id, { reason, adminPassword });
        setCustomers((current) => current.filter((item) => item.id !== customer.id));
        showFeedback(payload.message);
        await loadAdminData({ background: true, notify: false });
      },
    });
  };

  const viewDocument = (document) => setViewerItem({
    type: document.document,
    title: document.fileName,
    subtitle: `${document.customer} submitted this file on ${document.submitted}. Current status: ${document.approval}.`,
    previewUrl: document.previewUrl,
    mimeType: document.mimeType,
    document,
  });

  const viewBooking = (booking) => setViewerItem({
    type: "Booking operations",
    title: `Booking #${booking.reference}`,
    booking,
  });

  const saveDocumentDecision = async (document, approval, { reason, adminPassword, inspection }) => {
    const payload = await adminDataApi.updateDocument(document.id, { approval, reason, adminPassword, reviewVersion: document.reviewVersion,
      ...(inspection ? { inspection } : {}) });
    setDocuments((current) => current.map((item) => item.id === document.id ? payload.document : item));
    showFeedback(payload.reconciliationPending ? payload.message : `Document marked as ${approval.toLowerCase()}.`);
    const overview = await loadAdminData({ background: true, notify: false });
    if (approval !== "Approved" || payload.reconciliationPending || !overview) return;
    const link = payload.document.accountLink;
    const customer = link?.status === "registered" ? overview.customers?.find(item => item.id === link.customerId) : null;
    showFeedback(link?.status === "registration_incomplete" ? "Document approved. The applicant must finish registration before a customer account can become active."
      : !customer ? "Document approved. The account link needs review before treating a customer as verified."
        : customer.status === "Active" ? "Document approved. Customer account is now active."
          : customer.status === "Suspended" ? "Document approved. Customer account remains suspended."
            : customer.verification?.pendingReasons?.length ? `Document approved. Customer still needs: ${customer.verification.pendingReasons.join(", ")}.`
              : "Document approved. Review the customer's remaining verification requirements.");
  };

  const approveDocument = async (document, details) => {
    if (actionLoading || actionLockRef.current) return;
    actionLockRef.current = true;
    setActionLoading(true);
    try {
      await saveDocumentDecision(document, "Approved", details);
      setReviewDocument(null);
    } finally {
      actionLockRef.current = false;
      setActionLoading(false);
    }
  };

  const requestDocumentDecision = (document, approval) => {
    setReviewDocument(null);
    requestConfirmation({
      tone: approval === "Rejected" ? "danger" : "primary",
      title: `${approval === "Approved" ? "Approve" : "Reject"} this document?`,
      description: `${document.fileName} will be marked as ${approval.toLowerCase()} for ${document.customer}.`,
      confirmLabel: `${approval === "Approved" ? "Approve" : "Reject"} document`,
      requireReason: true,
      requirePassword: true,
      reasonPresets: approval === "Rejected" ? [
        { label: "Blurry or unreadable", value: "The document is blurry or unreadable. Please upload a clear, complete image of the original document." },
        { label: "Incomplete document", value: "Part of the document is missing or cropped. Please upload the complete original with all required details visible." },
        { label: "Registration details differ", value: "The document details do not match your registration. Please correct the registration details or upload the matching document." },
        { label: "Wrong document type", value: "The uploaded document does not match the selected document type. Please select the correct type and upload its original." },
        { label: "Expired document", value: "The document has expired. Please upload a current, valid document of an accepted type." },
      ] : undefined,
      onConfirm: details => saveDocumentDecision(document, approval, details),
    });
  };

  const headerActions = (
    <div className="flex items-center gap-3">
      {activeView === "dashboard" && syncedAt ? <p className="hidden text-xs text-slate-500 xl:block">Updated {formatSyncTime(syncedAt)}</p> : null}
      {activeView === "transactions" ? <button
        type="button"
        onClick={() => setTransactionsVisible(current => !current)}
        aria-label={transactionsVisible ? "Hide transaction records" : "Show transaction records"}
        title={transactionsVisible ? "Hide transaction records" : "Show transaction records"}
        aria-pressed={!transactionsVisible}
        aria-controls="transaction-records-content"
        className="admin-icon-button border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
      >{transactionsVisible ? <Eye size={18} aria-hidden="true" /> : <EyeOff size={18} aria-hidden="true" />}</button> : null}
      <button
        type="button"
        onClick={() => activeView === "transactions" ? setTransactionRefreshSignal((current) => current + 1) : void loadAdminData({ background: loadState === "ready" })}
        disabled={activeView === "transactions" ? transactionRefreshing : refreshing || loadState === "loading"}
        aria-label={activeView === "transactions" ? "Refresh transaction records" : "Refresh admin data"}
        title={activeView === "transactions" ? "Refresh transaction records" : syncedAt ? `Last synced ${new Date(syncedAt).toLocaleString()}` : "Refresh dashboard data"}
        className="admin-button disabled:opacity-60"
      >
        <RefreshCw size={17} className={(activeView === "transactions" ? transactionRefreshing : refreshing) ? "animate-spin" : ""} />
        <span>{(activeView === "transactions" ? transactionRefreshing : refreshing) ? "Refreshing…" : "Refresh"}</span>
      </button>
    </div>
  );

  return (
    <div className="admin-ui min-h-screen w-full max-w-full bg-canvas">
      <a href="#admin-main-content" className="fixed left-4 top-4 z-[10001] -translate-y-24 rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-xl transition-transform focus:translate-y-0">Skip to main content</a>
      <Toast message={feedback?.message} tone={feedback?.tone} onDismiss={() => { window.clearTimeout(feedbackTimerRef.current); setFeedback(null); }} />
      <ConfirmationDialog confirmation={confirmation} loading={actionLoading} onCancel={() => setConfirmation(null)} onConfirm={confirmAction} />
      <ViewerDialog item={viewerItem} onClose={() => setViewerItem(null)} onReviewDocument={document => { setViewerItem(null); setReviewDocument(document); }} />
      <DocumentReviewDialog
        document={reviewDocument}
        onClose={() => setReviewDocument(null)}
        onApprove={details => approveDocument(reviewDocument, details)}
        onCompare={async details => {
          const payload = await adminDataApi.compareDocument(reviewDocument.id, details);
          setDocuments(current => current.map(item => item.id === reviewDocument.id ? payload.document : item));
          setReviewDocument(null);
          showFeedback("ID comparison saved. The applicant can refresh verification and continue if all required checks passed. Final approval remains pending.");
        }}
        onReject={() => requestDocumentDecision(reviewDocument, "Rejected")}
      />

      <div className="min-h-screen w-full max-w-full lg:pl-64">
        <AdminSidebar
          activeView={activeView}
          displayName={displayName}
          displayEmail={displayEmail}
          mobileOpen={mobileNavOpen}
          onClose={closeMobileNav}
          onSelect={selectView}
          onLogout={onLogout}
        />

        <main id="admin-main-content" tabIndex={-1} inert={mobileNavOpen} className="w-full min-w-0 max-w-full">
          <AdminPageHeader
            {...pageMeta[activeView]}
            onMenuOpen={() => setMobileNavOpen(true)}
            menuButtonRef={mobileMenuButtonRef}
            menuOpen={mobileNavOpen}
            stackActionsOnMobile={activeView === "transactions"}
            actions={["reports", "audit", "security"].includes(activeView) ? null : headerActions}
          />

          <div className="mx-auto max-w-[1600px] p-4 sm:p-6 lg:p-7">
            {activeView === "transactions" ? <div id="transaction-records-content"><TransactionRecords key={`transactions-${viewContext.outstandingOnly ? "outstanding" : "all"}`} initialFilter={viewContext.outstandingOnly ? "outstanding" : "all"} visible={transactionsVisible} refreshSignal={transactionRefreshSignal} onRefreshStateChange={setTransactionRefreshing} /></div> : null}
            {activeView === "reports" ? <ReportsView key={`reports-${viewContext.status || "all"}`} initialStatus={viewContext.status || "all"} onFeedback={showFeedback} /> : null}
            {activeView === "audit" ? <AuditLogsView key={`audit-${viewContext.outcome || "all"}`} initialOutcome={viewContext.outcome || "all"} /> : null}
            {activeView === "security" ? <SecurityView onCurrentSessionRevoked={onLogout} /> : null}
            {!["transactions", "reports", "audit", "security"].includes(activeView) && loadState === "loading" ? <DataLoadingState /> : null}
            {!["transactions", "reports", "audit", "security"].includes(activeView) && loadState === "error" ? <DataErrorState message={loadError} onRetry={() => void loadAdminData()} onLogout={onLogout} /> : null}
            {!["transactions", "reports", "audit", "security"].includes(activeView) && loadState === "ready" && loadError ? <p role="status" className="mb-4 text-sm text-amber-800">Data may be outdated. {loadError} Use Refresh to retry.</p> : null}
            {loadState === "ready" && activeView === "dashboard" ? <DashboardView vehicles={vehicles} customers={customers} documents={documents} bookings={bookings} alerts={operationalAlerts} period={dashboardPeriod} periodControl={<DashboardPeriodSelect value={dashboardPeriod} options={dashboardPeriodOptions} onChange={setDashboardPeriod} />} onSelect={selectView} onViewBooking={viewBooking} /> : null}
            {loadState === "ready" && activeView === "bookings" ? <BookingsView key={`bookings-${viewContext.status || "all"}`} bookings={bookings} initialStatus={viewContext.status} onView={viewBooking} /> : null}
            {loadState === "ready" && activeView === "vehicles" ? <VehiclesView vehicles={vehicles} onView={viewVehicle} /> : null}
            {loadState === "ready" && activeView === "customers" ? <CustomersView key={`customers-${viewContext.role || "all"}-${viewContext.status || "all"}`} customers={customers} adminEmail={displayEmail} initialRole={viewContext.role} initialStatus={viewContext.status} onView={viewCustomer} onEdit={updateCustomer} onToggleDisabled={requestCustomerStatusChange} onDelete={requestCustomerDeletion} /> : null}
            {loadState === "ready" && activeView === "documents" ? <DocumentsView key={`documents-${viewContext.status || "all"}-${viewContext.purpose || "all"}`} documents={documents} initialStatus={viewContext.status} initialPurpose={viewContext.purpose} onView={viewDocument} onReview={setReviewDocument} /> : null}
          </div>
        </main>
      </div>
    </div>
  );
}

function DataLoadingState() {
  return (
    <div role="status" className="flex min-h-[420px] items-center justify-center rounded-2xl border border-slate-200 bg-white p-4">
      <div className="text-center">
        <LoaderCircle size={34} className="mx-auto animate-spin text-blue-600" />
        <p className="mt-4 font-semibold text-slate-900">Loading RentifyPro data</p>
        <p className="mt-1 text-sm text-slate-500">Reading customers, vehicles, bookings, and documents from the shared database.</p>
      </div>
    </div>
  );
}

function DataErrorState({ message, onRetry, onLogout }) {
  return (
    <div role="alert" className="flex min-h-[420px] items-center justify-center rounded-2xl border border-rose-200 bg-white p-6">
      <div className="max-w-lg text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-rose-50 text-rose-600"><Database size={26} /></span>
        <h2 className="mt-5 text-xl font-bold text-slate-950">Could not load the shared database</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">{message}</p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <button type="button" onClick={onRetry} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"><RefreshCw size={17} />Try Again</button>
          <button type="button" onClick={onLogout} className="h-11 rounded-xl border border-slate-300 px-5 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100">Return to Login</button>
        </div>
        <p className="mt-5 inline-flex items-start gap-2 text-left text-xs leading-5 text-slate-500"><AlertTriangle size={15} className="mt-0.5 shrink-0" />The admin uses the same MongoDB database as the main RentifyPro website. It does not keep a separate copy.</p>
      </div>
    </div>
  );
}

function DashboardPeriodSelect({ value, options, onChange }) {
  return (
    <FilterSelect aria-label="Dashboard reporting month and year" icon={CalendarDays} value={value} options={options} onChange={onChange} className="w-full sm:w-56" />
  );
}

function formatSyncTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "just now";
  return new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit" }).format(date);
}

function monthKey(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
