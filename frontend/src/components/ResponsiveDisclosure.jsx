import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import useCompactLayout from "../hooks/useCompactLayout";

export default function ResponsiveDisclosure({ label, children }) {
  const compact = useCompactLayout();
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const open = !compact || expanded;
  return (
    <div className="rp-responsive-disclosure">
      {compact && <button type="button" className="rp-btn-secondary mb-4" aria-expanded={open}
        aria-controls={id} onClick={() => setExpanded((value) => !value)}>
        {label}<ChevronDown size={18} aria-hidden="true" className={open ? "rotate-180" : ""} />
      </button>}
      <div id={id} hidden={!open}>{children}</div>
    </div>
  );
}
