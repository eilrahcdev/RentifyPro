import { useEffect, useRef, useState } from "react";

export default function BookingActionRail({ label, children }) {
  const railRef = useRef(null);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const rail = railRef.current;
    const measure = () => setOverflows(rail.scrollWidth > rail.clientWidth + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(rail);
    [...rail.children].forEach((child) => observer.observe(child));
    measure();
    return () => observer.disconnect();
  }, [children]);

  return (
    <div className="min-w-0">
      <div
        ref={railRef}
        role="group"
        aria-label={`${label}${overflows ? ". Scroll horizontally for more actions." : ""}`}
        tabIndex={overflows ? 0 : undefined}
        onFocusCapture={(event) => {
          if (event.target !== event.currentTarget) {
            event.target.scrollIntoView({ block: "nearest", inline: "nearest" });
          }
        }}
        className="rp-booking-action-rail"
      >
        {children}
      </div>
      {overflows && <p className="mt-1 text-xs text-slate-600">Swipe or scroll for more actions</p>}
    </div>
  );
}
