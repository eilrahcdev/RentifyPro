import { useEffect, useRef, useState } from "react";

export default function NotificationActionMenu({
  isUnread,
  isArchived,
  onViewDetails,
  onMarkAsRead,
  onArchive,
  onRestore,
  onDelete,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const closeMenu = (event) => {
      if (!menuRef.current?.contains(event.target)) setIsOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    document.addEventListener("mousedown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const runAction = (action) => {
    setIsOpen(false);
    action();
  };

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        type="button"
        aria-label="Notification actions"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((value) => !value)}
        className="rounded-lg px-2 py-1 text-lg leading-none text-slate-600 hover:bg-slate-100"
      >
        &#8942;
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 w-36 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          {onViewDetails && (
            <button type="button" role="menuitem" onClick={() => runAction(onViewDetails)} className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
              View details
            </button>
          )}
          {isArchived ? (
            <>
              <button type="button" role="menuitem" onClick={() => runAction(onRestore)} className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
                Restore
              </button>
              <button type="button" role="menuitem" onClick={() => runAction(onDelete)} className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50">
                Delete
              </button>
            </>
          ) : (
            <>
              {isUnread && (
                <button type="button" role="menuitem" onClick={() => runAction(onMarkAsRead)} className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
                  Mark as read
                </button>
              )}
              <button type="button" role="menuitem" onClick={() => runAction(onArchive)} className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
                Archive
              </button>
              {!isUnread && (
                <button type="button" role="menuitem" onClick={() => runAction(onDelete)} className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50">
                  Delete
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
