import { Eye, EyeOff } from "lucide-react";
import { useId, useState } from "react";

export default function PasswordInput({ label, labelClassName = "mb-1.5 block text-sm font-semibold text-slate-800", wrapperClassName = "", className = "", ...inputProps }) {
  const inputId = useId();
  const [visible, setVisible] = useState(false);
  const visibilityLabel = `${visible ? "Hide" : "Show"} password`;

  return (
    <div className={wrapperClassName}>
      <label htmlFor={inputId} className={labelClassName}>{label}</label>
      <div className="relative">
        <input {...inputProps} id={inputId} type={visible ? "text" : "password"} className={`${className} pr-12`} />
        <button type="button" onClick={() => setVisible(current => !current)} disabled={inputProps.disabled} aria-label={visibilityLabel} aria-pressed={visible} aria-controls={inputId} title={visibilityLabel} className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-slate-500 hover:bg-slate-50 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 disabled:cursor-not-allowed disabled:opacity-50">
          {visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}
