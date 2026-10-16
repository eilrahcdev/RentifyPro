import { useEffect, useRef } from "react";
import ModalPortal from "../../components/ModalPortal";

const openModals = [];
let previousRootInert = false;
const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function AdminModal({ children, onClose, busy = false, returnFocusRef }) {
  const containerRef = useRef(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);

  useEffect(() => { closeRef.current = onClose; busyRef.current = busy; }, [onClose, busy]);

  useEffect(() => {
    const container = containerRef.current;
    const root = document.getElementById("root");
    const previousFocus = returnFocusRef?.current || document.activeElement;
    if (!openModals.length && root) {
      previousRootInert = root.inert;
      root.inert = true;
    }
    openModals.push(container);
    openModals.forEach((modal) => { modal.inert = modal !== container; });
    const getPanel = () => container.querySelector('[role="dialog"], [role="alertdialog"]');
    const focusFrame = window.requestAnimationFrame(() => {
      const panel = getPanel();
      if (panel && !panel.hasAttribute("tabindex")) panel.tabIndex = -1;
      const initial = panel?.querySelector('[data-dialog-initial]:not([disabled])') || panel?.querySelector(focusableSelector);
      (initial || panel)?.focus({ preventScroll: true });
    });
    const handleKeyDown = (event) => {
      if (openModals.at(-1) !== container || event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!busyRef.current) closeRef.current?.();
      } else if (event.key === "Tab") {
        const panel = getPanel();
        const controls = [...(panel?.querySelectorAll(focusableSelector) || [])].filter((element) => element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (!first || !panel.contains(document.activeElement)) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      const index = openModals.indexOf(container);
      if (index >= 0) openModals.splice(index, 1);
      openModals.forEach((modal) => { modal.inert = modal !== openModals.at(-1); });
      if (!openModals.length && root) root.inert = previousRootInert;
      const canRestore = previousFocus instanceof HTMLElement && previousFocus !== document.body && previousFocus.isConnected && !previousFocus.closest("[inert]");
      const menuTrigger = document.querySelector('[aria-controls="admin-navigation"]');
      const restoreTarget = canRestore ? previousFocus : openModals.at(-1)?.querySelector(focusableSelector) || (menuTrigger?.getClientRects().length ? menuTrigger : document.getElementById("admin-main-content"));
      restoreTarget?.focus({ preventScroll: true });
    };
  }, [returnFocusRef]);

  return (
    <ModalPortal>
      <div ref={containerRef} className="admin-ui admin-modal" onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose?.();
      }}>
        {children}
      </div>
    </ModalPortal>
  );
}
