import { Check } from "lucide-react";

export default function RegistrationProgress({ currentStep, steps }) {
  const totalSteps = steps.length;
  const progress = totalSteps > 1 ? ((currentStep - 1) / (totalSteps - 1)) * 100 : 100;

  return (
    <nav className="mb-7" aria-label="Registration progress">
      <div className="mb-3 flex items-center justify-between gap-4 sm:hidden">
        <p className="text-sm font-semibold text-slate-900">Step {currentStep} of {totalSteps}</p>
        <p className="truncate text-sm font-medium text-blue-700">{steps[currentStep - 1]}</p>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-slate-200 sm:hidden"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={totalSteps}
        aria-valuenow={currentStep}
        aria-label={`${steps[currentStep - 1]}, step ${currentStep} of ${totalSteps}`}
      >
        <div
          className="h-full rounded-full bg-[#017FE6] transition-[width] duration-200"
          style={{ width: `${progress}%` }}
        />
      </div>

      <ol className="hidden grid-cols-[repeat(auto-fit,minmax(0,1fr))] gap-2 sm:grid">
        {steps.map((label, index) => {
          const number = index + 1;
          const complete = currentStep > number;
          const active = currentStep === number;
          return (
            <li key={label} className="relative min-w-0 text-center" aria-current={active ? "step" : undefined}>
              {index > 0 && (
                <span
                  aria-hidden="true"
                  className={`absolute left-[calc(-50%+24px)] right-[calc(50%+24px)] top-[17px] z-0 h-0.5 ${complete || active ? "bg-blue-500" : "bg-slate-200"}`}
                />
              )}
              <span
                className={`relative z-10 mx-auto flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold transition-colors ${
                  complete || active
                    ? "bg-[#017FE6] text-white"
                    : "bg-slate-100 text-slate-500"
                } ${active ? "ring-4 ring-blue-100" : ""}`}
              >
                {complete ? <Check size={16} strokeWidth={2.25} aria-hidden="true" /> : number}
              </span>
              <span className={`mt-2 block truncate text-xs font-semibold ${active ? "text-blue-700" : complete ? "text-slate-700" : "text-slate-400"}`}>
                {label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
