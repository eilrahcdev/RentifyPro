import { useEffect } from "react";
import { createPortal } from "react-dom";

let activeScrollLocks = 0;
let previousBodyOverflow = "";

export default function ModalPortal({ children, lockScroll = true }) {
  useEffect(() => {
    if (!lockScroll) return undefined;

    if (activeScrollLocks === 0) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    activeScrollLocks += 1;

    return () => {
      activeScrollLocks = Math.max(0, activeScrollLocks - 1);
      if (activeScrollLocks === 0) {
        document.body.style.overflow = previousBodyOverflow;
      }
    };
  }, [lockScroll]);

  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}
