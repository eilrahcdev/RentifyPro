import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import useCompactLayout from "../hooks/useCompactLayout";

export default function ProfileSection({ title, summary, editing, saving, disabled = false, readOnly = false, onEdit, onCancel, children }) {
  const compact = useCompactLayout();
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const open = !compact || expanded || editing;
  return (
    <section className="rp-settings-card rp-profile-section">
      <div className="rp-profile-section__header flex-wrap">
        <h3>
          {compact ? (
            <button type="button" aria-expanded={open} aria-controls={id} disabled={editing}
              onClick={() => setExpanded((value) => !value)} className="rp-profile-section__toggle">
              {title}<ChevronDown size={18} aria-hidden="true" className={open ? "rotate-180" : ""} />
            </button>
          ) : title}
        </h3>
        {!readOnly && (
          <div className="ml-auto flex flex-wrap gap-2">
            {editing && onCancel && <button type="button" disabled={saving || disabled} onClick={onCancel}
              aria-label={`Cancel ${title} changes`} className="rp-btn-secondary min-h-11 px-4">Cancel</button>}
            <button type="button" disabled={saving || disabled} onClick={() => { setExpanded(true); onEdit(); }}
              aria-label={`${editing ? "Save" : "Edit"} ${title}`} className="rp-btn-secondary min-h-11 min-w-16 px-4">
              {saving ? "Saving..." : editing ? "Save" : "Edit"}
            </button>
          </div>
        )}
      </div>
      {!open && <p className="rp-profile-section__summary">{summary || "View or edit this section"}</p>}
      <div id={id} hidden={!open}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{children}</div>
      </div>
    </section>
  );
}
