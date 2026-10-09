import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import useCompactLayout from "../hooks/useCompactLayout";

export default function RegistrationActions({ children, spaceRef }) {
  const compact = useCompactLayout();
  const actionsRef = useRef(null);
  useEffect(() => {
    if (!compact || !spaceRef.current) return;
    const actionsElement = actionsRef.current;
    const spaceElement = spaceRef.current;
    const observer = new ResizeObserver(() => {
      spaceElement.style.height = `${actionsElement.getBoundingClientRect().height + 16}px`;
    });
    observer.observe(actionsElement);
    return () => observer.disconnect();
  }, [compact, spaceRef]);
  const actions = <div ref={actionsRef} className="rp-registration-actions flex items-center gap-3 pt-1">{children}</div>;
  return compact ? createPortal(actions, document.body) : actions;
}
