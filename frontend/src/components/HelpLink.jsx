import { openHelp } from "../utils/helpNavigation";

export default function HelpLink({ guide, children, className = "" }) {
  return (
    <button
      type="button"
      onClick={() => openHelp(guide)}
      className={`inline-flex min-h-11 items-center rounded-lg text-sm font-semibold text-blue-700 underline decoration-blue-300 underline-offset-4 hover:text-blue-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${className}`}
    >
      {children}
    </button>
  );
}
