import { LogOut, X } from "lucide-react";
import AdminModal from "../admin/components/AdminModal";

export default function LogoutModal({ isOpen, onCancel, onConfirm }) {
  if (!isOpen) return null;

  return (
    <AdminModal onClose={onCancel}>
        <div role="dialog" aria-modal="true" aria-labelledby="admin-logout-title" aria-describedby="admin-logout-description" className="relative w-full max-w-md overflow-y-auto bg-white">
          <div className="admin-modal-header">
            <button type="button" onClick={onCancel} className="admin-icon-button absolute right-4 top-4 text-slate-500 hover:bg-slate-100" aria-label="Close sign out">
              <X size={16} />
            </button>
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
                <LogOut size={20} aria-hidden="true" />
              </div>
              <div>
                <h3 id="admin-logout-title" className="text-xl font-bold text-slate-900">Sign Out?</h3>
                <p className="text-xs text-slate-500">You will need to sign in again.</p>
              </div>
            </div>
          </div>

          <div className="p-5">
            <p id="admin-logout-description" className="mb-6 text-sm text-slate-600">
              Are you sure you want to sign out of your admin account? You&apos;ll need to sign in again to access the admin control panel.
            </p>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button type="button" data-dialog-initial onClick={onCancel} className="admin-button">
                Cancel
              </button>
              <button type="button" onClick={onConfirm} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
                Sign Out
              </button>
            </div>
          </div>
        </div>
    </AdminModal>
  );
}
