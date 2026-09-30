import React from "react";
import { ArrowLeft, CarFront } from "lucide-react";

export default function NotFoundPage({ onNavigateToHome, onNavigateToVehicles }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-16 text-slate-900">
      <section className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-[0_24px_70px_rgba(15,23,42,0.1)] sm:p-12">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-[#0B75E7]">
          <CarFront size={32} aria-hidden="true" />
        </div>
        <p className="mt-6 text-sm font-semibold uppercase tracking-[0.2em] text-[#0B75E7]">404</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">Page not found</h1>
        <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-slate-600 sm:text-base">
          The page you requested does not exist or may have moved. You can return home or continue browsing available vehicles.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <button type="button" onClick={onNavigateToHome} className="rp-btn-secondary inline-flex items-center justify-center gap-2 px-5 py-3">
            <ArrowLeft size={18} strokeWidth={2} aria-hidden="true" />
            Return home
          </button>
          <button type="button" onClick={onNavigateToVehicles} className="rp-btn-primary px-5 py-3">
            Browse vehicles
          </button>
        </div>
      </section>
    </main>
  );
}
