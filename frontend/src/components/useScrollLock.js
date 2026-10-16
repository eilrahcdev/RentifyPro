import { useEffect } from "react";

let activeScrollLocks = 0;
let previousBodyOverflow = "";

export default function useScrollLock(active = true) {
  useEffect(() => {
    if (!active) return undefined;
    if (activeScrollLocks === 0) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    activeScrollLocks += 1;
    return () => {
      activeScrollLocks = Math.max(0, activeScrollLocks - 1);
      if (activeScrollLocks === 0) document.body.style.overflow = previousBodyOverflow;
    };
  }, [active]);
}
