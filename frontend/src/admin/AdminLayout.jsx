import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronDown, Database, RefreshCw, TriangleAlert } from "lucide-react";
import { AdminDataSkeleton } from "../components/LoadingSkeletons";
import { AdminPageHeader, AdminSidebar } from "./components/AdminShell";
import {
  ConfirmationDialog,
  DocumentReviewDialog,
  ViewerDialog,
} from "./components/AdminUI";
import { showActionToast } from "../utils/actionToast";
import { adminDataApi } from "./adminDataApi";
import BookingsView from "./pages/BookingsView";
import CustomersView from "./pages/CustomersView";
import DashboardView from "./pages/DashboardView";
import DocumentsView from "./pages/DocumentsView";
import VehiclesView from "./pages/VehiclesView";
import TransactionRecords from "./pages/TransactionRecords";
import ReportsView from "./pages/ReportsView";

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
    title: "Reports",
    description: "Review renter and operator complaints, evidence, sanctions, and appeals.",
  },
};

export default function AdminLayout({ user, onLogout }) {
  const [activeView, setActiveView] = useState("dashboard");
  const [viewContext, setViewContext] = useState({});
  const [dashboardPeriod, setDashboardPeriod] = useState(() => monthKey(new Date()));
  const [customers, setCustomers] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [loadState, setLoadState] = useState("loading");
  const [loadError, setLoadError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [syncedAt, setSyncedAt] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [viewerItem, setViewerItem] = useState(null);
  const [reviewDocument, setReviewDocument] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const actionLockRef = useRef(false);

  const displayName = user?.name || "Admin";
  const displayEmail = user?.email || "admin@example.com";
  const dashboardPeriodOptions = useMemo(() => {
    const months = new Set([monthKey(new Date())]);
    bookings.forEach((booking) => {
      const key = monthKey(booking.pickupAt || booking.createdAt);
      if (key) months.add(key);
    });
    for (let offset = 1; months.size < 6; offset += 1) {
      const date = new Date();
      date.setMonth(date.getMonth() - offset);
      months.add(monthKey(date));
    }
    return [...months].filter(Boolean).sort().reverse().slice(0, 12);
  }, [bookings]);

  const showFeedback = useCallback((message, tone = "success") => {
    showActionToast(message, { id: "admin-feedback", tone });
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
      setSyncedAt(payload.syncedAt || new Date().toISOString());
      setLoadState("ready");
      if (background) showFeedback("Dashboard data refreshed from RentifyPro.");
    } catch (error) {
      if (background) showFeedback(error.message, "error");
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
      else setMobileNavOpen(false);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [actionLoading, confirmation, reviewDocument, viewerItem]);

  const selectView = (view, context = {}) => {
    setActiveView(view);
    setViewContext(context);
    setMobileNavOpen(false);
  };

  const requestConfirmation = (config) => {
    if (!actionLoading) setConfirmation(config);
  };

  const confirmAction = async () => {
    if (!confirmation || actionLoading || actionLockRef.current) return;
    const pendingAction = confirmation;
    actionLockRef.current = true;
    setActionLoading(true);

    try {
      await pendingAction.onConfirm();
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
    title: vehicle.name,
    subtitle: `${vehicle.plateNumber} · ${vehicle.category} · ${vehicle.location} · ${vehicle.rentalRate}`,
    previewUrl: vehicle.image,
    mimeType: "image/*",
  });

  const viewCustomer = (customer) => setViewerItem({
    type: "Customer profile",
    title: customer.name,
    subtitle: `${customer.role} account using ${customer.email} and ${customer.phone}. Joined ${customer.created}.`,
  });

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
    subtitle: `${booking.renter} booked ${booking.vehicle}, operated by ${booking.operator}, from ${formatAdminDate(booking.pickupAt)} to ${formatAdminDate(booking.returnAt)}. Status: ${booking.isOverdue ? "Overdue" : booking.status}. Driver option: ${booking.driverSelected ? "Selected" : "Not selected"}.`,
  });

  const requestDocumentDecision = (document, approval, remarks = "") => {
    setReviewDocument(null);
    requestConfirmation({
      tone: approval === "Rejected" ? "danger" : "primary",
      title: `${approval === "Approved" ? "Approve" : "Reject"} this document?`,
      description: `${document.fileName} will be marked as ${approval.toLowerCase()} for ${document.customer}.${remarks ? ` Reason: ${remarks}` : ""}`,
      confirmLabel: `${approval === "Approved" ? "Approve" : "Reject"} document`,
      onConfirm: async () => {
        const payload = await adminDataApi.updateDocument(document.id, approval, remarks, document.reviewVersion);
        setDocuments((current) => current.map((item) => item.id === document.id ? payload.document : item));
        showFeedback(`Document marked as ${approval.toLowerCase()}.`);
      },
    });
  };

  const headerActions = (
    <div className="flex items-center gap-2">
      {activeView === "dashboard" ? <DashboardPeriodSelect value={dashboardPeriod} options={dashboardPeriodOptions} onChange={setDashboardPeriod} /> : null}
      <button
        type="button"
        onClick={() => void loadAdminData({ background: loadState === "ready" })}
        disabled={refreshing || loadState === "loading"}
        title={syncedAt ? `Last synced ${new Date(syncedAt).toLocaleString()}` : "Refresh dashboard data"}
        className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 disabled:cursor-wait disabled:opacity-60"
      >
        <RefreshCw size={18} strokeWidth={2} className={refreshing ? "animate-spin" : ""} aria-hidden="true" />
        <span className="hidden sm:inline">Refresh</span>
      </button>
    </div>
  );

  return (
    <div className="min-h-screen w-screen max-w-[100vw] overflow-x-hidden bg-[#f5f7fb] lg:w-auto">
      <ConfirmationDialog confirmation={confirmation} loading={actionLoading} onCancel={() => setConfirmation(null)} onConfirm={confirmAction} />
      <ViewerDialog item={viewerItem} onClose={() => setViewerItem(null)} />
      <DocumentReviewDialog
        key={reviewDocument?.id || "closed"}
        document={reviewDocument}
        onClose={() => setReviewDocument(null)}
        onApprove={() => requestDocumentDecision(reviewDocument, "Approved")}
        onReject={(remarks) => requestDocumentDecision(reviewDocument, "Rejected", remarks)}
      />

      <div className="min-h-screen w-full max-w-full lg:pl-64">
        <AdminSidebar
          activeView={activeView}
          displayName={displayName}
          displayEmail={displayEmail}
          mobileOpen={mobileNavOpen}
          onClose={() => setMobileNavOpen(false)}
          onSelect={selectView}
          onLogout={onLogout}
        />

        <main className="w-full min-w-0 max-w-full overflow-hidden">
          <AdminPageHeader
            {...pageMeta[activeView]}
            onMenuOpen={() => setMobileNavOpen(true)}
            actions={["transactions", "reports"].includes(activeView) ? null : headerActions}
          />

          <div className="mx-auto max-w-[1600px] p-4 sm:p-5 lg:p-5">
            {activeView === "transactions" ? <TransactionRecords /> : null}
            {activeView === "reports" ? <ReportsView /> : null}
            {!["transactions", "reports"].includes(activeView) && loadState === "loading" ? <AdminDataSkeleton view={activeView} /> : null}
            {!["transactions", "reports"].includes(activeView) && loadState === "error" ? <DataErrorState message={loadError} onRetry={() => void loadAdminData()} onLogout={onLogout} /> : null}
            {loadState === "ready" && activeView === "dashboard" ? <DashboardView vehicles={vehicles} customers={customers} documents={documents} bookings={bookings} period={dashboardPeriod} onSelect={selectView} /> : null}
            {loadState === "ready" && activeView === "bookings" ? <BookingsView key={`bookings-${viewContext.status || "all"}`} bookings={bookings} initialStatus={viewContext.status} onView={viewBooking} /> : null}
            {loadState === "ready" && activeView === "vehicles" ? <VehiclesView vehicles={vehicles} onView={viewVehicle} /> : null}
            {loadState === "ready" && activeView === "customers" ? <CustomersView key={`customers-${viewContext.role || "all"}`} customers={customers} adminEmail={displayEmail} initialRole={viewContext.role} onView={viewCustomer} /> : null}
            {loadState === "ready" && activeView === "documents" ? <DocumentsView key={`documents-${viewContext.status || "all"}`} documents={documents} initialStatus={viewContext.status} onView={viewDocument} onReview={setReviewDocument} /> : null}
          </div>
        </main>
      </div>
    </div>
  );
}

function DataErrorState({ message, onRetry, onLogout }) {
  return (
    <div className="flex min-h-[420px] items-center justify-center rounded-2xl border border-rose-200 bg-white p-6 shadow-sm">
      <div className="max-w-lg text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-rose-50 text-rose-600"><Database size={24} strokeWidth={2} aria-hidden="true" /></span>
        <h2 className="mt-5 text-xl font-bold text-slate-950">Could not load the shared database</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">{message}</p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <button type="button" onClick={onRetry} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"><RefreshCw size={18} strokeWidth={2} aria-hidden="true" />Try Again</button>
          <button type="button" onClick={onLogout} className="h-11 rounded-xl border border-slate-300 px-5 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100">Return to Login</button>
        </div>
        <p className="mt-5 inline-flex items-start gap-2 text-left text-xs leading-5 text-slate-500"><TriangleAlert size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />The admin uses the same MongoDB database as the main RentifyPro website. It does not keep a separate copy.</p>
      </div>
    </div>
  );
}

function DashboardPeriodSelect({ value, options, onChange }) {
  return (
    <label className="relative inline-flex h-11 items-center rounded-xl border border-slate-200 bg-white pl-10 pr-8 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 focus-within:ring-4 focus-within:ring-blue-100">
      <CalendarDays aria-hidden="true" size={18} className="pointer-events-none absolute left-3 text-slate-500" />
      <span className="sr-only">Dashboard reporting month and year</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="h-full appearance-none bg-transparent pr-2 text-sm font-semibold text-slate-700 outline-none">
        {options.map((option) => <option key={option} value={option}>{periodLabel(option)}</option>)}
      </select>
      <ChevronDown aria-hidden="true" size={16} className="pointer-events-none absolute right-3 text-slate-500" />
    </label>
  );
}

function monthKey(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function periodLabel(value) {
  const [year, month] = String(value).split("-").map(Number);
  const date = new Date(year, month - 1, 1);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric" }).format(date);
}

function formatAdminDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "an unavailable date";
  return new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}
