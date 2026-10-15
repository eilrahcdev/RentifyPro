import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarDays, Database, LoaderCircle, RefreshCw } from "lucide-react";
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
    description: "Review customer verification files, permits, and IDs in one organized workspace.",
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
  const [syncedAt, setSyncedAt] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [viewerItem, setViewerItem] = useState(null);
  const [reviewDocument, setReviewDocument] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState("");
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

  const showFeedback = useCallback((message) => {
    window.clearTimeout(feedbackTimerRef.current);
    setFeedbackMessage(message);
    feedbackTimerRef.current = window.setTimeout(() => setFeedbackMessage(""), 3200);
  }, []);

  const closeMobileNav = useCallback(() => {
    setMobileNavOpen(false);
    window.requestAnimationFrame(() => mobileMenuButtonRef.current?.focus());
  }, []);

  const loadAdminData = useCallback(async ({ background = false } = {}) => {
    if (background) setRefreshing(true);
    else setLoadState("loading");
    setLoadError("");

    try {
      const payload = await adminDataApi.getOverview();
      setCustomers(Array.isArray(payload.customers) ? payload.customers : []);
      setVehicles(Array.isArray(payload.vehicles) ? payload.vehicles : []);
      setDocuments(Array.isArray(payload.documents) ? payload.documents : []);
      setBookings(Array.isArray(payload.bookings) ? payload.bookings : []);
      setOperationalAlerts(Array.isArray(payload.operationalAlerts) ? payload.operationalAlerts : []);
      setSyncedAt(payload.syncedAt || new Date().toISOString());
      setLoadState("ready");
      if (background) showFeedback("Dashboard data refreshed from RentifyPro.");
    } catch (error) {
      if (background) showFeedback(error.message);
      else {
        setLoadError(error.message);
        setLoadState("error");
      }
    } finally {
      setRefreshing(false);
    }
  }, [showFeedback]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadAdminData(), 0);
    return () => window.clearTimeout(initialLoad);
  }, [loadAdminData]);

  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key !== "Escape") return;
      if (confirmation && !actionLoading) setConfirmation(null);
      else if (reviewDocument) setReviewDocument(null);
      else if (viewerItem) setViewerItem(null);
      else if (mobileNavOpen) closeMobileNav();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [actionLoading, closeMobileNav, confirmation, mobileNavOpen, reviewDocument, viewerItem]);

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
      showFeedback(error.message || "The action could not be completed.");
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
    const customerEmail = String(customer.email || "").trim().toLowerCase();
    const customerDocuments = documents.filter(
      (document) => document.customerId
        ? String(document.customerId) === String(customer.id)
        : Boolean(customerEmail) && String(document.email || "").trim().toLowerCase() === customerEmail,
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
      },
    });
  };

  const viewDocument = (document) => setViewerItem({
    type: document.document,
    title: document.fileName,
    subtitle: `${document.customer} submitted this file on ${document.submitted}. Current status: ${document.approval}.`,
    previewUrl: document.previewUrl,
    mimeType: document.mimeType,
  });

  const viewBooking = (booking) => setViewerItem({
    type: "Booking operations",
    title: `Booking #${booking.reference}`,
    booking,
  });

  const requestDocumentDecision = (document, approval) => {
    setReviewDocument(null);
    requestConfirmation({
      tone: approval === "Rejected" ? "danger" : "primary",
      title: `${approval === "Approved" ? "Approve" : "Reject"} this document?`,
      description: `${document.fileName} will be marked as ${approval.toLowerCase()} for ${document.customer}.`,
      confirmLabel: `${approval === "Approved" ? "Approve" : "Reject"} document`,
      requireReason: true,
      requirePassword: true,
      onConfirm: async ({ reason, adminPassword }) => {
        const payload = await adminDataApi.updateDocument(document.id, { approval, reason, adminPassword, reviewVersion: document.reviewVersion });
        setDocuments((current) => current.map((item) => item.id === document.id ? payload.document : item));
        showFeedback(`Document marked as ${approval.toLowerCase()}.`);
      },
    });
  };

  const requestDocumentComparison = (document, comparison) => {
    setReviewDocument(null);
    requestConfirmation({
      tone: "primary", title: "Save the inspected document comparison?",
      description: "The backend will compare the entered document fields against registration. Final document approval remains a separate decision.",
      confirmLabel: "Save comparison", requireReason: true, requirePassword: true,
      onConfirm: async ({ reason, adminPassword }) => {
        const payload = await adminDataApi.compareDocument(document.id, { ...comparison, reason, adminPassword });
        const updated = { ...document, ...payload.document };
        setDocuments((current) => current.map((item) => item.id === document.id ? updated : item));
        setReviewDocument(updated);
        showFeedback("Document comparison saved. Final approval is still required.");
      },
    });
  };

  const headerActions = (
    <div className="flex items-center gap-3">
      {activeView === "dashboard" && syncedAt ? <p className="hidden text-xs text-slate-500 xl:block">Updated {formatSyncTime(syncedAt)}</p> : null}
      <button
        type="button"
        onClick={() => activeView === "transactions" ? setTransactionRefreshSignal((current) => current + 1) : void loadAdminData({ background: loadState === "ready" })}
        disabled={activeView === "transactions" ? transactionRefreshing : refreshing || loadState === "loading"}
        aria-label={activeView === "transactions" ? "Refresh transaction records" : "Refresh admin data"}
        title={activeView === "transactions" ? "Refresh transaction records" : syncedAt ? `Last synced ${new Date(syncedAt).toLocaleString()}` : "Refresh dashboard data"}
        className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 disabled:cursor-wait disabled:opacity-60"
      >
        <RefreshCw size={17} className={(activeView === "transactions" ? transactionRefreshing : refreshing) ? "animate-spin" : ""} />
        <span className="hidden sm:inline">{(activeView === "transactions" ? transactionRefreshing : refreshing) ? "Refreshing…" : "Refresh"}</span>
      </button>
    </div>
  );

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-canvas">
      <a href="#admin-main-content" className="fixed left-4 top-4 z-[10001] -translate-y-24 rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-xl transition-transform focus:translate-y-0">Skip to main content</a>
      <Toast message={feedbackMessage} />
      <ConfirmationDialog confirmation={confirmation} loading={actionLoading} onCancel={() => setConfirmation(null)} onConfirm={confirmAction} />
      <ViewerDialog item={viewerItem} onClose={() => setViewerItem(null)} />
      <DocumentReviewDialog
        document={reviewDocument}
        onClose={() => setReviewDocument(null)}
        onApprove={() => requestDocumentDecision(reviewDocument, "Approved")}
        onReject={() => requestDocumentDecision(reviewDocument, "Rejected")}
        onCompare={(comparison) => requestDocumentComparison(reviewDocument, comparison)}
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

        <main id="admin-main-content" tabIndex={-1} className="w-full min-w-0 max-w-full overflow-hidden">
          <AdminPageHeader
            {...pageMeta[activeView]}
            onMenuOpen={() => setMobileNavOpen(true)}
            menuButtonRef={mobileMenuButtonRef}
            actions={["reports", "audit", "security"].includes(activeView) ? null : headerActions}
          />

          <div className="mx-auto max-w-[1600px] p-4 sm:p-6 lg:p-7">
            {activeView === "transactions" ? <TransactionRecords refreshSignal={transactionRefreshSignal} onRefreshStateChange={setTransactionRefreshing} /> : null}
            {activeView === "reports" ? <ReportsView key={`reports-${viewContext.status || "all"}`} initialStatus={viewContext.status || "all"} onFeedback={showFeedback} /> : null}
            {activeView === "audit" ? <AuditLogsView key={`audit-${viewContext.outcome || "all"}`} initialOutcome={viewContext.outcome || "all"} /> : null}
            {activeView === "security" ? <SecurityView onCurrentSessionRevoked={onLogout} /> : null}
            {!["transactions", "reports", "audit", "security"].includes(activeView) && loadState === "loading" ? <DataLoadingState /> : null}
            {!["transactions", "reports", "audit", "security"].includes(activeView) && loadState === "error" ? <DataErrorState message={loadError} onRetry={() => void loadAdminData()} onLogout={onLogout} /> : null}
            {loadState === "ready" && activeView === "dashboard" ? <DashboardView vehicles={vehicles} customers={customers} documents={documents} bookings={bookings} alerts={operationalAlerts} period={dashboardPeriod} periodControl={<DashboardPeriodSelect value={dashboardPeriod} options={dashboardPeriodOptions} onChange={setDashboardPeriod} />} onSelect={selectView} onViewBooking={viewBooking} /> : null}
            {loadState === "ready" && activeView === "bookings" ? <BookingsView key={`bookings-${viewContext.status || "all"}`} bookings={bookings} initialStatus={viewContext.status} onView={viewBooking} /> : null}
            {loadState === "ready" && activeView === "vehicles" ? <VehiclesView vehicles={vehicles} onView={viewVehicle} /> : null}
            {loadState === "ready" && activeView === "customers" ? <CustomersView key={`customers-${viewContext.role || "all"}-${viewContext.status || "all"}`} customers={customers} adminEmail={displayEmail} initialRole={viewContext.role} initialStatus={viewContext.status} onView={viewCustomer} onEdit={updateCustomer} onToggleDisabled={requestCustomerStatusChange} onDelete={requestCustomerDeletion} /> : null}
            {loadState === "ready" && activeView === "documents" ? <DocumentsView key={`documents-${viewContext.status || "all"}`} documents={documents} initialStatus={viewContext.status} onView={viewDocument} onReview={setReviewDocument} /> : null}
          </div>
        </main>
      </div>
    </div>
  );
}

function DataLoadingState() {
  return (
    <div className="flex min-h-[420px] items-center justify-center rounded-2xl border border-slate-200 bg-white shadow-sm">
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
    <div className="flex min-h-[420px] items-center justify-center rounded-2xl border border-rose-200 bg-white p-6 shadow-sm">
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
