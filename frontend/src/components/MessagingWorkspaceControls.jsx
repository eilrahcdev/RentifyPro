import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Archive, ArrowLeft, Mail, MessageCircle, MoreHorizontal, Search, X } from "lucide-react";
import { getInitialsFromName } from "../utils/dateUtils";

export function ChatFolderNav({ folder, onChange }) {
  return (
    <nav className="rp-chat-folder-nav" aria-label="Message folders">
      <button type="button" className={folder === "inbox" ? "is-active" : ""} aria-current={folder === "inbox" ? "page" : undefined} onClick={() => onChange("inbox")}>
        <MessageCircle size={20} aria-hidden="true" /><span>Chats</span>
      </button>
      <button type="button" className={folder === "archived" ? "is-active" : ""} aria-current={folder === "archived" ? "page" : undefined} onClick={() => onChange("archived")}>
        <Archive size={20} aria-hidden="true" /><span>Archived</span>
      </button>
    </nav>
  );
}

export function ChatSearchField({ value, onChange, searching, onSearchStart, onSearchEnd, label }) {
  return (
    <div className={`rp-chat-search-control ${searching ? "is-searching" : ""}`}>
      {searching && <button type="button" className="rp-chat-search-back" onClick={onSearchEnd} aria-label="Exit search"><ArrowLeft size={18} aria-hidden="true" /></button>}
      <div className="rp-chat-search">
        <Search size={17} aria-hidden="true" />
        <label className="sr-only" htmlFor={label.replace(/\W/g, "-").toLowerCase()}>{label}</label>
        <input id={label.replace(/\W/g, "-").toLowerCase()} value={value} onFocus={onSearchStart} onChange={(event) => onChange(event.target.value)} placeholder="Search conversations" autoComplete="off" />
      </div>
    </div>
  );
}

export function ConversationActionMenu({ label, open, onToggle, onClose, actions }) {
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const [position, setPosition] = useState(null);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    requestAnimationFrame(() => menuRef.current?.querySelector('[role="menuitem"]')?.focus({ preventScroll: true }));
    const closeOutside = (event) => {
      if (!menuRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target)) onCloseRef.current();
    };
    const close = () => onCloseRef.current();
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("wheel", close, { passive: true });
    window.addEventListener("touchmove", close, { passive: true });
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("wheel", close);
      window.removeEventListener("touchmove", close);
      window.removeEventListener("resize", close);
    };
  }, [open, actions.length]);

  const handleToggle = () => {
    if (!open) {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) {
        const width = 200;
        const height = actions.length * 44 + 12;
        setPosition({
          left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
          top: rect.bottom + height + 8 <= window.innerHeight ? rect.bottom + 4 : Math.max(8, rect.top - height - 4),
        });
      }
    }
    onToggle();
  };

  const handleMenuKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      triggerRef.current?.focus();
      return;
    }
    const items = [...menuRef.current.querySelectorAll('[role="menuitem"]:not(:disabled)')];
    const index = items.indexOf(document.activeElement);
    let next = index;
    if (event.key === "ArrowDown") next = (index + 1) % items.length;
    else if (event.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else return;
    event.preventDefault();
    items[next]?.focus();
  };

  return (
    <>
      <button type="button" ref={triggerRef} className="rp-chat-more-button" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={handleToggle}>
        <MoreHorizontal size={20} aria-hidden="true" />
      </button>
      {open && position && createPortal(
        <div ref={menuRef} className="rp-chat-action-menu" role="menu" aria-label={label} style={position} onKeyDown={handleMenuKeyDown}>
          {actions.map(({ label: actionLabel, icon: Icon, onClick, danger, disabled }) => (
            <button key={actionLabel} type="button" role="menuitem" disabled={disabled} className={danger ? "is-danger" : ""} onClick={() => { onClose(); triggerRef.current?.focus({ preventScroll: true }); onClick(); }}>
              <Icon size={17} aria-hidden="true" /><span>{actionLabel}</span>
            </button>
          ))}
        </div>, document.body
      )}
    </>
  );
}

export function ChatParticipantDetails({ partner, booking, onClose, modal = false, showBookingContext = true }) {
  const closeRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const [failedAvatar, setFailedAvatar] = useState("");
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    closeRef.current?.focus();
    if (!modal) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onCloseRef.current();
      if (event.key !== "Tab") return;
      const focusable = [...document.querySelectorAll(".rp-chat-details-pane button, .rp-chat-details-pane a")];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [modal]);

  const vehicleName = booking?.vehicle?.name && booking.vehicle.name !== "Vehicle" ? booking.vehicle.name : "";
  const status = String(booking?.status || "");
  const bookingLabel = status === "completed" ? "Recently rented" : "Vehicle in latest booking";
  return (
    <div className="rp-chat-details-overlay">
      <button type="button" className="rp-chat-details-backdrop" aria-label="Close participant details" onClick={onClose} tabIndex={modal ? 0 : -1} />
      <aside className="rp-chat-details-pane" aria-label={`Details for ${partner?.name || "participant"}`} role={modal ? "dialog" : undefined} aria-modal={modal ? "true" : undefined}>
        <div className="rp-chat-details-heading"><h2>Chat details</h2><button ref={closeRef} type="button" aria-label="Close chat details" onClick={onClose}><X size={20} aria-hidden="true" /></button></div>
        <div className="rp-chat-details-person">
          {partner?.avatar && failedAvatar !== partner.avatar ? <img src={partner.avatar} alt="" onError={() => setFailedAvatar(partner.avatar)} /> : <span aria-hidden="true">{getInitialsFromName(partner?.name || "User")}</span>}
          <h3>{partner?.name || "User"}</h3>
          {partner?.email && <p><Mail size={16} aria-hidden="true" />{partner.email}</p>}
        </div>
        {showBookingContext && <div className="rp-chat-details-booking">
          <h3>Booking context</h3>
          {vehicleName ? <><span>{bookingLabel}</span><p>{vehicleName}</p><small>{status === "completed" ? "Completed booking" : status === "extended" ? "Extended booking" : "Confirmed booking"}</small></> : <p>No confirmed rental to show yet.</p>}
        </div>}
      </aside>
    </div>
  );
}
