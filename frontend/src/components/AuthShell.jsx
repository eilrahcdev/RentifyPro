import React from "react";
import { CheckCircle2 } from "lucide-react";

const DEFAULT_HIGHLIGHTS = [
  "Realtime booking and trip updates",
  "Secure, token-based account sessions",
  "Designed for both renters and owners",
];

export default function AuthShell({
  onNavigateToHome,
  badge = "Premium Mobility Marketplace",
  panelTitle = "Drive smarter with RentifyPro.",
  panelDescription = "Reserve, manage, and track rentals from one modern workspace.",
  highlights = DEFAULT_HIGHLIGHTS,
  contentMaxWidth = "max-w-lg",
  contentContainerClassName = "",
  children,
}) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 top-[-5.5rem] h-72 w-72 rounded-full bg-blue-300/25 blur-3xl" />
        <div className="absolute right-[-5rem] top-[8%] h-80 w-80 rounded-full bg-cyan-300/20 blur-3xl" />
        <div className="absolute bottom-[-7rem] left-[45%] h-96 w-96 -translate-x-1/2 rounded-full bg-blue-200/25 blur-3xl" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1500px] items-stretch gap-4 p-4 sm:gap-6 sm:p-6 lg:h-[100dvh] lg:gap-8 lg:p-8">
        <section className="hidden lg:flex lg:w-[44%] xl:w-[40%]">
          <div className="rp-surface relative h-full w-full overflow-hidden rounded-[30px] border border-white/60">
            <img
              src="/porsche 911.png"
              alt="RentifyPro showcase"
              className="absolute inset-0 h-full w-full object-cover"
              draggable={false}
            />
            <div className="absolute inset-0 bg-gradient-to-br from-slate-950/85 via-blue-950/55 to-blue-700/45" />

            <div className="relative z-10 flex h-full flex-col justify-between p-10">
              <div>
                <button
                  type="button"
                  onClick={onNavigateToHome}
                  className="inline-flex items-center rounded-full border border-white/25 bg-white/10 px-5 py-2 text-sm font-semibold text-white backdrop-blur hover:bg-white/20"
                >
                  Rentify<span className="text-blue-200">Pro</span>
                </button>
              </div>

              <div className="max-w-md">
                <span className="rp-chip mb-4 bg-white/10 text-slate-100 ring-1 ring-white/25">
                  {badge}
                </span>
                <h1 className="text-4xl font-extrabold leading-tight text-white xl:text-5xl">
                  {panelTitle}
                </h1>
                <p className="mt-4 text-base leading-relaxed text-slate-200">
                  {panelDescription}
                </p>
                <div className="mt-7 space-y-3">
                  {highlights.map((item) => (
                    <div key={item} className="flex items-center gap-3 text-sm text-slate-100">
                      <CheckCircle2 size={16} className="text-blue-200" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="flex min-w-0 flex-1 flex-col">
          <div className="lg:hidden">
            <button
              type="button"
              onClick={onNavigateToHome}
              className="rp-glass inline-flex items-center rounded-2xl px-4 py-2 text-xl font-extrabold text-slate-900 shadow-sm"
            >
              Rentify<span className="text-[#0b75e7]">Pro</span>
            </button>
          </div>

          <div className={`flex flex-1 justify-center overflow-y-auto ${contentContainerClassName}`}>
            <div className={`w-full ${contentMaxWidth} pb-4 pt-4 sm:pb-6`}>{children}</div>
          </div>
        </section>
      </div>
    </div>
  );
}
