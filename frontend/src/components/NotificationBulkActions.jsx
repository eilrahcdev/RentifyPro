import { useEffect, useId, useRef, useState } from "react";
import { Archive, Check, ChevronDown, FolderArchive, Inbox, MailCheck, Minus, Trash2 } from "lucide-react";
import API from "../utils/api";
import { requestLiveCountersRefresh } from "../utils/liveCounters";
import { showActionToast } from "../utils/actionToast";
import ConfirmationModal from "./ConfirmationModal";
import ModalPortal from "./ModalPortal";
import NotificationToolbarButton from "./NotificationToolbarButton";

export default function NotificationBulkActions({ notifications, archived, selection, onSelectionChange, disabled, onBusyChange, onProcessed, onMarkedRead, onToggleArchive, onMarkAllAsRead, unreadCount }) {
  const [confirmation, setConfirmation] = useState(null);
  const [confirmationError, setConfirmationError] = useState("");
  const [busy, setBusy] = useState(false);
  const [menuPosition, setMenuPosition] = useState(null);
  const inFlightRef = useRef(false);
  const toolbarRef = useRef(null);
  const selectAllRef = useRef(null);
  const selectionControlRef = useRef(null);
  const menuButtonRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();
  const displayed = [...new Map(notifications.map(notification => [notification._id, notification])).values()];
  const selected = displayed.filter(notification => selection.ids.includes(notification._id));
  const allSelected = displayed.length > 0 && selected.length === displayed.length;
  const hasUnread = !archived && selected.some(notification => !notification.readAt);
  const options = [
    { label: "All", items: displayed },
    { label: "None", items: [] },
    { label: "Read", items: displayed.filter(notification => notification.readAt) },
    { label: "Unread", items: displayed.filter(notification => !notification.readAt) },
  ];
  const blocked = disabled || busy;
  const count = confirmation?.ids.length || 0;
  const archiving = confirmation?.action === "archive";

  useEffect(() => {
    if (!menuPosition) return undefined;
    menuRef.current?.querySelector('button:not(:disabled)')?.focus();
    const dismiss = (event) => {
      if (!menuRef.current?.contains(event.target) && !menuButtonRef.current?.contains(event.target)) setMenuPosition(null);
    };
    const reposition = () => setMenuPosition(null);
    document.addEventListener("pointerdown", dismiss);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [menuPosition]);

  const openMenu = () => {
    if (blocked) return;
    if (menuPosition) { setMenuPosition(null); return; }
    const bounds = selectionControlRef.current.getBoundingClientRect();
    setMenuPosition({ left: Math.max(8, Math.min(bounds.left, window.innerWidth - 184)), top: Math.max(8, Math.min(bounds.bottom + 4, window.innerHeight - 208)) });
  };

  const selectOption = ({ items }) => {
    if (blocked || items.length > 100) return;
    onSelectionChange({ ids: items.map(notification => notification._id) });
    setMenuPosition(null);
    menuButtonRef.current?.focus();
    showActionToast(items.length ? `${items.length} notification${items.length === 1 ? "" : "s"} selected.` : "Selection cleared.", { interactive: false, id: "notification-selection", tone: "info" });
  };

  const menuKeyDown = (event) => {
    if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); }
      setMenuPosition(null);
      menuButtonRef.current?.focus();
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const items = [...menuRef.current.querySelectorAll('button:not(:disabled)')];
      const current = items.indexOf(document.activeElement);
      const index = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[index]?.focus();
    }
  };

  const markSelectedRead = async () => {
    const ids = selected.filter(notification => !notification.readAt).map(notification => notification._id);
    if (inFlightRef.current || blocked || archived || !ids.length || ids.length > 100) return;
    inFlightRef.current = true;
    setBusy(true);
    onBusyChange(true);
    try {
      const response = await API.markAllNotificationsRead(ids);
      onMarkedRead(ids, new Date().toISOString());
      requestLiveCountersRefresh();
      const changed = response.modifiedCount ?? ids.length;
      showActionToast(`${changed} notification${changed === 1 ? "" : "s"} marked as read.`, { interactive: false, id: "notification-action" });
    } catch (error) {
      showActionToast(error.message || "Failed to mark selected notifications as read. Please try again.", { interactive: false, id: "notification-action", tone: "error" });
    } finally {
      inFlightRef.current = false;
      setBusy(false);
      onBusyChange(false);
      toolbarRef.current?.focus();
    }
  };

  const askToConfirm = (action) => {
    if (blocked || !selected.length || selected.length > 100 || (action === "delete" && hasUnread)) return;
    setConfirmationError("");
    setConfirmation({ action, ids: selected.map(notification => notification._id), archived });
  };

  const confirm = async () => {
    if (inFlightRef.current || !confirmation?.ids.length) return;
    const action = confirmation;
    inFlightRef.current = true;
    setBusy(true);
    onBusyChange(true);
    setConfirmationError("");
    try {
      const response = action.action === "archive"
        ? await API.archiveNotifications(action.ids)
        : await API.deleteNotifications(action.ids, { archived: action.archived });
      if (!Array.isArray(response.processedIds)) throw Error("The result could not be confirmed. Refresh the list before retrying.");
      const processedIds = [...new Set(response.processedIds)].filter(id => action.ids.includes(id));
      const remainingIds = action.ids.filter(id => !processedIds.includes(id));
      onProcessed(processedIds);
      onSelectionChange(previous => ({ ...previous, ids: previous.ids.filter(id => !processedIds.includes(id)) }));
      requestLiveCountersRefresh();
      if (remainingIds.length) {
        setConfirmation({ ...action, ids: remainingIds });
        setConfirmationError(`${processedIds.length} completed; ${remainingIds.length} could not be updated. Retry the remaining selection or cancel.`);
        showActionToast(`${processedIds.length} completed; ${remainingIds.length} could not be updated.`, { interactive: false, id: "notification-action", tone: "error" });
      } else {
        setConfirmation(null);
        onSelectionChange({ ids: [] });
        showActionToast(`${processedIds.length} notification${processedIds.length === 1 ? "" : "s"} ${action.action === "archive" ? "archived" : "deleted"}.`, { interactive: false, id: "notification-action" });
      }
    } catch (error) {
      setConfirmationError(error.message || "Failed to update selected notifications. Please try again.");
      showActionToast(error.message || "Failed to update selected notifications. Please try again.", { interactive: false, id: "notification-action", tone: "error" });
    } finally {
      inFlightRef.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  };

  return (
    <section ref={toolbarRef} tabIndex={-1} aria-label="Notification selection" aria-busy={blocked} className="flex flex-wrap items-center gap-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700">
      <div ref={selectionControlRef} role="group" aria-label="Notification selection controls" className="inline-flex h-10 shrink-0 items-center rounded hover:bg-slate-100">
        <label title="Select all displayed" className="relative inline-flex h-10 w-8 shrink-0 cursor-pointer items-center justify-center">
          <input type="checkbox" aria-label="Select all displayed" checked={allSelected} ref={element => { selectAllRef.current = element; if (element) element.indeterminate = selected.length > 0 && !allSelected; }} disabled={blocked || !displayed.length || displayed.length > 100} onChange={() => onSelectionChange({ ids: allSelected ? [] : displayed.map(notification => notification._id) })} className="h-[18px] w-[18px] appearance-none rounded-[2px] border-2 border-slate-600 bg-transparent checked:border-blue-700 checked:bg-blue-700 indeterminate:border-blue-700 indeterminate:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-40" />
          {selected.length > 0 && <span className="pointer-events-none absolute text-white" aria-hidden="true">{allSelected ? <Check size={14} strokeWidth={3} /> : <Minus size={14} strokeWidth={3} />}</span>}
        </label>
        <NotificationToolbarButton icon={ChevronDown} compact label="Selection options" buttonRef={menuButtonRef} disabled={blocked} aria-haspopup="menu" aria-expanded={Boolean(menuPosition)} aria-controls={menuPosition ? menuId : undefined} onClick={openMenu} onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); openMenu(); } }} />
      </div>
      {selected.length > 0 && (
        <>
          <p role="status" className="px-1 text-sm font-semibold text-slate-900">{selected.length} selected</p>
          {!archived && <NotificationToolbarButton icon={Archive} label="Archive selected" tooltip="Archive" disabled={blocked} onClick={() => askToConfirm("archive")} />}
          <NotificationToolbarButton icon={Trash2} label="Delete selected" tooltip="Delete" disabled={blocked || hasUnread} onClick={() => askToConfirm("delete")} />
          {!archived && <NotificationToolbarButton icon={MailCheck} label="Mark selected as read" tooltip="Mark as read" disabled={blocked || !hasUnread} onClick={markSelectedRead} />}
        </>
      )}
      {!archived && !selected.length && <NotificationToolbarButton icon={MailCheck} label="Mark all as read" disabled={blocked || !unreadCount} onClick={onMarkAllAsRead} />}
      <NotificationToolbarButton icon={archived ? Inbox : FolderArchive} label={archived ? "View active notifications" : "View archive"} disabled={blocked} onClick={onToggleArchive} />
      {hasUnread && <p className="w-full text-sm text-slate-600">Read selected notifications before deleting them. You can archive unread notifications.</p>}
      {(displayed.length > 100 || selected.length >= 100) && <p className="w-full text-sm text-slate-600">Select up to 100 notifications per action.</p>}
      {menuPosition && <ModalPortal lockScroll={false}>
        <div ref={menuRef} id={menuId} role="menu" aria-label="Select notifications" onKeyDown={menuKeyDown} style={menuPosition} className="fixed z-[110] w-44 rounded-lg border border-slate-200 bg-white p-1 text-sm text-slate-700 shadow-lg">
          {options.map(option => <button key={option.label} type="button" role="menuitem" disabled={blocked || option.items.length > 100} onClick={() => selectOption(option)} className="block min-h-11 w-full rounded px-4 text-left hover:bg-slate-100 focus-visible:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-40">{option.label}</button>)}
        </div>
      </ModalPortal>}
      {confirmation && <ConfirmationModal
        title={`${archiving ? "Archive" : "Delete"} ${count} notification${count === 1 ? "" : "s"}?`}
        message={archiving ? "Move these notifications to your archive. You can restore them later." : "These notifications will be permanently deleted. This cannot be undone."}
        confirmLabel={`${archiving ? "Archive" : "Delete"} ${count}`}
        busyLabel={archiving ? "Archiving..." : "Deleting..."}
        icon={archiving ? Archive : Trash2}
        busy={busy}
        error={confirmationError}
        onCancel={() => { if (!inFlightRef.current) setConfirmation(null); }}
        onConfirm={confirm}
        fallbackFocusRef={toolbarRef}
      />}
    </section>
  );
}
