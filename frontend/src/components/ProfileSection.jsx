import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import useCompactLayout from "../hooks/useCompactLayout";

export default function ProfileSection({ title, summary, editing, saving, onEdit, children }) {
  const compact = useCompactLayout();
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const open = !compact || expanded || editing;
  return (
    <section className="rp-settings-card rp-profile-section">
      <div className="rp-profile-section__header">
        <h3>
          {compact ? (
            <button type="button" aria-expanded={open} aria-controls={id} disabled={editing}
              onClick={() => setExpanded((value) => !value)} className="rp-profile-section__toggle">
              {title}<ChevronDown size={18} aria-hidden="true" className={open ? "rotate-180" : ""} />
            </button>
          ) : title}
        </h3>
        <button type="button" disabled={saving} onClick={() => { setExpanded(true); onEdit(); }}
          className="rp-btn-secondary">{saving ? "Saving..." : editing ? "Save" : "Edit"}</button>
      </div>
      {!open && <p className="rp-profile-section__summary">{summary || "View or edit this section"}</p>}
      <div id={id} hidden={!open}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{children}</div>
      </div>
    </section>
  );
}
