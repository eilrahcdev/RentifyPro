import { useEffect, useState } from "react";
import "./VehicleCard.css";
import AuthRouteSkeleton from "./AuthRouteSkeleton";
import Block from "./SkeletonBlock";

export function DelayedSkeleton({ children, delay = 300 }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), delay);
    return () => window.clearTimeout(timer);
  }, [delay]);

  return visible ? children : null;
}

export function SkeletonRegion({ label, className = "", children }) {
  return (
    <div role="status" aria-label={label} className={className}>
      {children}
    </div>
  );
}

export function VehicleCardSkeleton({ managed = false }) {
  return (
    <article className={`rp-vehicle-card pointer-events-none select-none !border-neutral-200 !bg-neutral-50 !shadow-none ${managed ? "rp-vehicle-card--managed" : ""}`}>
      <div className="rp-vehicle-card__preview">
        <span className="rp-vehicle-card__media relative">
          <Block className="aspect-[16/10] w-full !rounded-2xl" />
          <span className="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
            <Block className="h-6 w-20 !rounded-full !bg-neutral-200" />
            <Block className="h-6 w-14 !rounded-full !bg-neutral-200" />
          </span>
        </span>
      </div>
      <div className="rp-vehicle-card__body">
        <div className="rp-vehicle-card__topline">
          <Block className="h-3 w-1/3" />
        </div>
        <Block className="mt-2 h-6 w-3/4" />
        <div className="rp-vehicle-card__location">
          <Block className="h-3 w-3 shrink-0 !rounded-full" />
          <Block className="h-3 w-1/2" />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Block className="h-6 w-20 !rounded-full" />
          <Block className="h-6 w-24 !rounded-full" />
          <Block className="h-6 w-20 !rounded-full" />
        </div>
        {managed && <Block className="mt-3 h-4 w-3/4" />}
        <div className="rp-vehicle-card__bottom">
          {managed && <div className="mb-3 flex items-center gap-2"><Block className="h-3 w-20" /><Block className="h-10 min-w-0 flex-1" /></div>}
          <div className="rp-vehicle-card__footer !border-neutral-200">
            <div className="space-y-2">
              <Block className="h-3 w-12" />
              <Block className="h-6 w-24" />
            </div>
            {managed ? <div className="flex w-full gap-2"><Block className="h-11 flex-1" /><Block className="h-11 flex-1" /></div> : <Block className="h-11 w-28" />}
          </div>
        </div>
      </div>
    </article>
  );
}

export function VehicleGridSkeleton({ label = "Loading vehicles", count = 4, className = "rp-market-grid", managed = false }) {
  return (
    <SkeletonRegion label={label} className={className}>
      {Array.from({ length: count }, (_, index) => <VehicleCardSkeleton key={index} managed={managed} />)}
    </SkeletonRegion>
  );
}

function BookingCardSkeleton() {
  return (
    <article className="rounded-3xl border border-neutral-200 bg-neutral-50 p-4 sm:p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 gap-4">
          <Block className="rp-booking-thumbnail h-20 w-24 shrink-0 !rounded-2xl sm:h-24 sm:w-32" />
          <div className="min-w-0 flex-1 space-y-2 py-1">
            <Block className="h-3 w-24" />
            <Block className="h-6 w-44 max-w-full" />
            <Block className="h-4 w-36 max-w-full" />
          </div>
        </div>
        <div className="flex gap-2 md:justify-end">
          <Block className="h-7 w-24 !rounded-full" />
          <Block className="h-7 w-20 !rounded-full" />
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2 border-t border-neutral-200 pt-5 sm:gap-3 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="space-y-2 rounded-xl bg-neutral-100 p-3">
            <Block className="h-3 w-16" />
            <Block className="h-4 w-4/5" />
          </div>
        ))}
      </div>
      <Block className="mt-2 h-11 w-full" />
      <div className="mt-4 flex flex-wrap gap-2 border-t border-neutral-200 pt-4">
        <Block className="h-11 w-28" />
        <Block className="h-11 w-24" />
      </div>
    </article>
  );
}

export function BookingListSkeleton({ label = "Loading bookings", count = 2 }) {
  return (
    <SkeletonRegion label={label} className="space-y-4">
      {Array.from({ length: count }, (_, index) => <BookingCardSkeleton key={index} />)}
    </SkeletonRegion>
  );
}

export function ActivityListSkeleton({ label = "Loading updates", count = 3 }) {
  return (
    <SkeletonRegion label={label} className="space-y-3">
      {Array.from({ length: count }, (_, index) => (
        <article key={index} className="flex items-start justify-between gap-4 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
          <div className="min-w-0 flex-1">
            <Block className="h-4 w-2/5" />
            <Block className="mt-3 h-3 w-4/5" />
            <Block className="mt-2 h-3 w-3/5" />
            <div className="mt-3 flex gap-2"><Block className="h-3 w-24" /><Block className="h-5 w-16 !rounded-full" /></div>
          </div>
          <Block className="h-9 w-9 shrink-0" />
        </article>
      ))}
    </SkeletonRegion>
  );
}

export function ConversationListSkeleton({ label = "Loading conversations" }) {
  return (
    <SkeletonRegion label={label} className="space-y-2 p-3">
      {[0, 1, 2, 3].map((item) => (
        <div key={item} className="flex items-center gap-3 rounded-xl p-2">
          <Block className="h-11 w-11 shrink-0 !rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Block className="h-4 w-2/3" />
            <Block className="h-3 w-5/6" />
          </div>
        </div>
      ))}
    </SkeletonRegion>
  );
}

function InboxDetailSkeleton({ className = "hidden md:flex" }) {
  return (
    <div aria-hidden="true" className={`${className} flex-col items-center justify-center gap-3 border-l border-neutral-200`}>
      <Block className="h-10 w-10 !rounded-full" />
      <Block className="h-4 w-40" />
      <Block className="h-3 w-56 max-w-[80%]" />
    </div>
  );
}

export function MessageThreadSkeleton({ label = "Loading messages" }) {
  return (
    <SkeletonRegion label={label} className="space-y-5 px-4 py-6">
      <div className="flex gap-2"><Block className="h-8 w-8 !rounded-full" /><Block className="h-16 w-2/3 max-w-72" /></div>
      <Block className="ml-auto h-12 w-1/2 max-w-64" />
      <div className="flex gap-2"><Block className="h-8 w-8 !rounded-full" /><Block className="h-20 w-3/5 max-w-64" /></div>
    </SkeletonRegion>
  );
}

export function OwnerDashboardSkeleton() {
  return (
    <SkeletonRegion label="Loading dashboard" className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="space-y-4 rounded-2xl bg-neutral-50 p-5">
            <Block className="h-3 w-2/3" />
            <Block className="h-8 w-1/2" />
            <Block className="h-3 w-3/4" />
          </div>
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.9fr)_minmax(320px,0.92fr)]">
        <div className="rounded-2xl bg-neutral-50 p-5">
          <Block className="h-5 w-40" />
          <div className="mt-5 grid grid-cols-7 gap-2">
            {Array.from({ length: 35 }, (_, index) => <Block key={index} className="aspect-square w-full" />)}
          </div>
        </div>
        <div className="space-y-3 rounded-2xl bg-neutral-50 p-5">
          <Block className="h-5 w-36" />
          {[0, 1, 2].map((item) => <Block key={item} className="h-20 w-full" />)}
        </div>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        {[0, 1].map((panel) => (
          <div key={panel} className="space-y-4 rounded-2xl bg-neutral-50 p-5">
            <Block className="h-5 w-44" />
            {[0, 1, 2].map((item) => (
              <div key={item} className="flex items-center gap-3 border-t border-neutral-200 pt-3">
                <Block className="h-9 w-9 shrink-0 !rounded-full" />
                <div className="flex-1 space-y-2"><Block className="h-4 w-3/5" /><Block className="h-3 w-4/5" /></div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

export function AnalyticsContentSkeleton() {
  return (
    <SkeletonRegion label="Loading vehicle analytics" className="space-y-5">
      <div className="rounded-2xl bg-neutral-50 p-5"><Block className="h-6 w-52" /><Block className="mt-2 h-4 w-4/5 max-w-lg" /><div className="mt-5 space-y-4">{[0, 1, 2].map((item) => <div key={item} className="space-y-3 border-t border-neutral-200 pt-4"><div className="flex justify-between"><Block className="h-4 w-40" /><Block className="h-6 w-20 !rounded-full" /></div><Block className="h-2 w-full !rounded-full" /><div className="grid grid-cols-3 gap-3">{[0, 1, 2].map((metric) => <Block key={metric} className="h-10 w-full" />)}</div></div>)}</div></div>
      <div className="rounded-2xl bg-neutral-50 p-5">
        <Block className="h-5 w-48" />
        <Block className="mt-3 h-3 w-3/4 max-w-lg" />
        <div className="mt-8 flex h-48 items-end gap-3 sm:h-64">
          {["h-[45%]", "h-[70%]", "h-[55%]", "h-[85%]", "h-[62%]", "h-[78%]"].map((height, index) => <Block key={index} className={`w-full !rounded-b-none ${height}`} />)}
        </div>
      </div>
      <div className="space-y-4 rounded-2xl bg-neutral-50 p-5">
        <Block className="h-5 w-52" />
        {[0, 1, 2].map((item) => (
          <div key={item} className="space-y-2 border-t border-neutral-200 pt-4">
            <Block className="h-4 w-1/2" />
            <Block className="h-3 w-full" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">{[0, 1].map((panel) => <div key={panel} className="space-y-4 rounded-2xl bg-neutral-50 p-5"><Block className="h-5 w-44" />{[0, 1, 2].map((item) => <div key={item} className="flex items-center gap-3"><Block className="h-4 w-16" /><Block className="h-3 flex-1 !rounded-full" /><Block className="h-4 w-12" /></div>)}</div>)}</div>
    </SkeletonRegion>
  );
}

export function EarningsContentSkeleton() {
  return (
    <SkeletonRegion label="Loading earnings" className="space-y-5">
      <div className="flex flex-wrap justify-between gap-3"><div className="space-y-2"><Block className="h-7 w-52" /><Block className="h-4 w-64 max-w-full" /></div><Block className="h-11 w-36" /></div>
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((item) => <div key={item} className="space-y-3 rounded-2xl bg-neutral-50 p-5"><Block className="h-4 w-2/3" /><Block className="h-8 w-1/2" /></div>)}
      </div>
      <div className="space-y-4 rounded-2xl bg-neutral-50 p-5"><Block className="h-5 w-48" /><div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[0, 1, 2, 3].map((item) => <Block key={item} className="h-14 w-full" />)}</div></div>
      <div className="overflow-hidden rounded-2xl bg-neutral-50"><div className="overflow-x-auto"><div className="min-w-[760px]"><div className="grid grid-cols-7 gap-3 bg-neutral-100 p-4">{[0, 1, 2, 3, 4, 5, 6].map((item) => <Block key={item} className="h-4 w-4/5" />)}</div>{[0, 1, 2, 3].map((row) => <div key={row} className="grid grid-cols-7 gap-3 border-t border-neutral-200 p-4">{[0, 1, 2, 3, 4, 5, 6].map((cell) => <Block key={cell} className="h-4 w-4/5" />)}</div>)}</div></div></div>
    </SkeletonRegion>
  );
}

export function AdminDataSkeleton({ view = "dashboard" }) {
  if (view === "dashboard") return (
    <SkeletonRegion label="Loading admin dashboard" className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {[0, 1, 2, 3, 4, 5].map((item) => <div key={item} className="space-y-3 rounded-2xl bg-neutral-50 p-4"><Block className="h-3 w-2/3" /><Block className="h-8 w-1/2" /><Block className="h-3 w-3/4" /></div>)}
      </div>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.25fr)_minmax(380px,1fr)]">
        <div className="rounded-2xl bg-neutral-50 p-5"><Block className="h-5 w-40" /><div className="mt-6 flex h-64 items-end gap-4">{[0, 1, 2, 3, 4].map((item) => <Block key={item} className={`w-full ${item % 2 ? "h-2/3" : "h-1/2"}`} />)}</div></div>
        <div className="rounded-2xl bg-neutral-50 p-5"><Block className="h-5 w-40" /><Block className="mx-auto mt-8 aspect-square w-48 !rounded-full" /></div>
      </div>
      <div className="rounded-2xl bg-neutral-50 p-5"><div className="flex justify-between gap-3"><Block className="h-5 w-48" /><Block className="h-10 w-24" /></div><div className="mt-4 grid grid-cols-7 gap-1">{Array.from({ length: 35 }, (_, index) => <Block key={index} className="h-12 w-full sm:h-16" />)}</div></div>
      <div className="rounded-2xl bg-neutral-50 p-5"><Block className="h-5 w-52" /><div className="mt-4 space-y-3">{[0, 1, 2].map((item) => <div key={item} className="flex gap-3 border-t border-neutral-200 pt-3"><Block className="h-4 w-20" /><Block className="h-4 flex-1" /><Block className="h-6 w-20 !rounded-full" /></div>)}</div></div>
    </SkeletonRegion>
  );
  if (["vehicles", "bookings", "customers", "documents"].includes(view)) return (
    <SkeletonRegion label={`Loading ${view}`} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((item) => <div key={item} className="space-y-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-4"><Block className="h-4 w-28" /><Block className="h-8 w-16" /></div>)}</div>
      <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50">
        <div className="grid gap-4 border-b border-neutral-200 p-4 lg:grid-cols-[minmax(260px,1.5fr)_220px_220px_auto]"><Block className="h-11 w-full" /><Block className="h-11 w-full" /><Block className="h-11 w-full" /><Block className="h-11 w-28" /></div>
        <div className="overflow-x-auto"><div className="min-w-[940px]"><div className="grid grid-cols-7 gap-4 border-b border-neutral-200 bg-neutral-100 p-4">{[0, 1, 2, 3, 4, 5, 6].map((item) => <Block key={item} className="h-3 w-4/5" />)}</div>{[0, 1, 2, 3, 4].map((row) => <div key={row} className="grid grid-cols-7 items-center gap-4 border-b border-neutral-200 p-4"><div className="flex items-center gap-2"><Block className="h-10 w-12 shrink-0" /><Block className="h-4 w-full" /></div>{[0, 1, 2, 3, 4, 5].map((cell) => <Block key={cell} className="h-4 w-4/5" />)}</div>)}</div></div>
      </div>
    </SkeletonRegion>
  );
  return (
    <SkeletonRegion label={`Loading ${view}`} className="space-y-4 rounded-2xl bg-neutral-50 p-5">
      <div className="flex flex-wrap justify-between gap-3"><Block className="h-6 w-44" /><Block className="h-10 w-48" /></div>
      {[0, 1, 2, 3, 4].map((item) => <div key={item} className="flex gap-4 border-t border-neutral-200 pt-4"><Block className="h-10 w-10 shrink-0 !rounded-full" /><Block className="h-10 w-1/3" /><Block className="hidden h-10 flex-1 sm:block" /></div>)}
    </SkeletonRegion>
  );
}

function RenterHeaderSkeleton() {
  return (
    <div className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-5">
      <div className="mx-auto max-w-7xl rounded-3xl border border-neutral-200 bg-neutral-50">
        <div className="flex min-h-[4.25rem] items-center justify-between gap-2 px-3 py-2 sm:gap-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3"><Block className="h-9 w-9 shrink-0 !rounded-full sm:h-10 sm:w-10" /><Block className="h-6 w-24 sm:w-32" /></div>
          <div className="hidden items-center gap-5 rounded-full border border-neutral-200 bg-neutral-100 px-4 py-3 lg:flex"><Block className="h-4 w-12" /><Block className="h-4 w-16" /><Block className="h-4 w-16" /><Block className="h-4 w-12" /><Block className="h-4 w-16" /></div>
          <div className="flex items-center gap-2"><Block className="hidden h-10 w-10 rounded-xl lg:block" /><Block className="h-10 w-10 rounded-xl" /></div>
        </div>
      </div>
    </div>
  );
}

function HelpRouteSkeleton({ label }) {
  const path = typeof window === "undefined" ? "/help" : window.location.pathname.toLowerCase();
  const isIndex = path === "/help" || path === "/help/";
  const isAudience = /^\/help\/(renter|owner)\/?$/.test(path);
  return (
    <div role="status" aria-label={label} className="min-h-screen bg-neutral-100">
      <div aria-hidden="true">
        <div className="border-b border-neutral-200 bg-neutral-50"><div className="mx-auto flex min-h-20 max-w-3xl items-center gap-4 px-4 py-3 sm:px-6"><Block className="h-11 w-11 rounded-xl" /><Block className="h-6 w-16" /></div></div>
        <main className="mx-auto max-w-4xl px-4 pb-16 pt-8 sm:px-6 sm:pt-12">
          <div className="mx-auto max-w-3xl space-y-3"><Block className="h-9 w-3/4 max-w-md" /><Block className="h-4 w-full max-w-2xl" /><Block className="h-4 w-5/6 max-w-xl" /></div>
          {isIndex ? (
            <div className="mx-auto mt-8 grid max-w-3xl gap-4 sm:grid-cols-2">{[0, 1].map((item) => <div key={item} className="space-y-3 rounded-xl border border-neutral-200 bg-neutral-50 p-5"><Block className="h-5 w-3/4" /><Block className="h-4 w-full" /><Block className="h-4 w-4/5" /></div>)}</div>
          ) : isAudience ? (
            <div className="mx-auto mt-10 max-w-3xl space-y-5"><Block className="h-6 w-44" />{[0, 1, 2, 3].map((item) => <div key={item} className="space-y-2 border-t border-neutral-200 py-4"><Block className="h-5 w-1/2" /><Block className="h-4 w-5/6" /></div>)}</div>
          ) : (
            <div className="mx-auto mt-8 max-w-3xl space-y-8"><div className="space-y-3 rounded-xl bg-neutral-50 p-6"><Block className="h-5 w-40" /><Block className="h-4 w-full" /><Block className="h-4 w-5/6" /></div>{[0, 1, 2].map((item) => <div key={item} className="space-y-3"><Block className="h-6 w-48" /><Block className="h-4 w-full" /><Block className="h-4 w-4/5" /></div>)}<div className="space-y-3 border-t border-neutral-200 pt-6"><Block className="h-6 w-44" /><Block className="h-11 w-36" /></div></div>
          )}
        </main>
      </div>
    </div>
  );
}

function VehicleTypeCarouselSkeleton() {
  return (
    <div className="relative mx-auto h-[30rem] max-w-[70rem] overflow-hidden">
      {[-1, 1, 0].map((position) => (
        <div
          key={position}
          className={`absolute left-1/2 top-8 flex h-96 w-[78%] max-w-[24rem] flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50 md:h-[27rem] md:w-[60%] md:max-w-[29rem] ${position === 0 ? "z-10" : "z-0"}`}
          style={{ transform: `translateX(${position === -1 ? "-62%" : position === 1 ? "-38%" : "-50%"}) rotate(${position * 4}deg)` }}
        >
          <Block className="min-h-0 w-full flex-1 !rounded-none" />
          <div className="space-y-3 p-4 sm:p-5"><Block className="h-6 w-2/3" /><Block className="h-4 w-full" /><Block className="h-9 w-28" /></div>
        </div>
      ))}
    </div>
  );
}

function RouteContent({ page }) {
  if (page === "home") return (
    <>
      <div className="mx-auto max-w-7xl bg-neutral-100 px-5 pb-28 pt-28 sm:rounded-b-3xl sm:px-8 sm:pt-36">
        <div className="max-w-3xl space-y-5"><Block className="h-6 w-40" /><Block className="h-12 w-4/5" /><Block className="h-12 w-3/5" /><Block className="h-5 w-4/5" /><div className="flex gap-3 pt-2"><Block className="h-11 w-36" /><Block className="h-11 w-28" /></div></div>
      </div>
      <div className="mx-auto -mt-16 max-w-6xl px-4 sm:-mt-20 sm:px-6"><div className="rounded-2xl bg-neutral-50 p-5 sm:p-6"><Block className="mb-4 h-6 w-64 max-w-full" /><div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]"><Block className="h-12 w-full" /><Block className="h-12 w-full" /><Block className="h-12 w-full md:w-36" /></div></div></div>
      <div className="mx-auto max-w-7xl space-y-6 px-5 py-16 sm:px-8 sm:py-20"><Block className="h-5 w-40" /><Block className="h-9 w-72 max-w-full" /><VehicleTypeCarouselSkeleton /></div>
      <div className="mx-auto max-w-7xl space-y-6 px-5 py-16 sm:px-8 sm:py-20"><Block className="h-5 w-36" /><Block className="h-9 w-60 max-w-full" /><Block className="h-4 w-3/5" /><VehicleGridSkeleton label="Loading featured vehicles" count={4} className="rp-featured-carousel" /></div>
      <section className="bg-neutral-200 py-12 sm:py-16">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div className="space-y-3"><Block className="h-4 w-40 !bg-neutral-300" /><Block className="h-8 w-72 max-w-full" /><Block className="h-4 w-4/5 max-w-lg" /></div>
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {[0, 1, 2].map((item) => <div key={item} className="flex gap-4 border-t border-neutral-300 pt-5"><Block className="h-12 w-12 shrink-0 !rounded-full" /><div className="flex-1 space-y-3"><Block className="h-4 w-10" /><Block className="h-5 w-3/4" /><Block className="h-4 w-full" /><Block className="h-4 w-5/6" /></div></div>)}
          </div>
        </div>
      </section>
      <section className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-20">
        <div className="mb-10 space-y-3 text-center"><Block className="mx-auto h-4 w-36" /><Block className="mx-auto h-9 w-64 max-w-full" /><Block className="mx-auto h-4 w-3/4 max-w-md" /></div>
        <div className="mb-8 space-y-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-6 sm:p-8"><Block className="h-7 w-40" /><Block className="h-4 w-full" /><Block className="h-4 w-5/6" /><Block className="h-4 w-3/4" /></div>
        <div className="grid gap-5 md:grid-cols-12">
          {[0, 1, 2].map((item) => <div key={item} className={`overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50 ${item === 0 ? "md:col-span-5 md:row-span-2" : "md:col-span-7 sm:grid sm:grid-cols-2"}`}><Block className={item === 0 ? "aspect-[16/9] w-full !rounded-none" : "h-52 w-full !rounded-none sm:h-full"} /><div className="space-y-3 p-6"><Block className="h-5 w-3/4" /><Block className="h-4 w-full" /><Block className="h-4 w-5/6" /></div></div>)}
        </div>
      </section>
      <section className="mx-auto max-w-7xl px-5 pb-20 pt-12 sm:px-8">
        <Block className="mx-auto mb-10 h-9 w-72 max-w-full" />
        <div className="grid gap-6 md:grid-cols-3">{[0, 1, 2].map((item) => <div key={item} className="overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50"><Block className="aspect-[16/10] w-full !rounded-none" /><div className="space-y-3 p-6"><Block className="h-5 w-3/4" /><Block className="h-4 w-full" /><Block className="h-4 w-5/6" /></div></div>)}</div>
      </section>
      <footer className="mx-auto max-w-7xl bg-neutral-200 px-5 py-14 sm:px-8"><div className="grid gap-8 md:grid-cols-4">{[0, 1, 2, 3].map((item) => <div key={item} className="space-y-3"><Block className="h-5 w-3/4" /><Block className="h-4 w-full" /><Block className="h-4 w-4/5" /></div>)}</div></footer>
    </>
  );

  if (page === "vehicles") return (
    <main className="mx-auto max-w-[1440px] space-y-6 px-4 pb-16 pt-24 sm:px-6 sm:pt-28">
      <Block className="h-9 w-72 max-w-full" /><Block className="h-4 w-4/5 max-w-xl" />
      <div className="flex flex-wrap items-center justify-between gap-4"><div className="space-y-2"><Block className="h-4 w-32" /><Block className="h-8 w-44" /><Block className="h-4 w-52" /></div><Block className="h-12 w-full sm:w-72" /></div>
      <div className="flex flex-wrap gap-2">{[0, 1, 2, 3, 4].map((item) => <Block key={item} className="h-10 w-24 !rounded-full" />)}</div>
      <div className="rp-fleet-results">
        <VehicleGridSkeleton label="Loading available vehicles" count={4} />
      </div>
    </main>
  );

  if (page === "vehicle-details") return (
    <main className="mx-auto max-w-[1380px] space-y-5 px-4 pb-16 pt-24 sm:px-6 sm:pt-28">
      <div className="flex flex-col gap-4 rounded-2xl bg-neutral-50 p-5 lg:flex-row lg:items-center lg:justify-between"><div className="flex min-w-0 items-center gap-3"><Block className="h-11 w-11 shrink-0" /><div className="min-w-0 flex-1 space-y-3"><div className="flex flex-wrap items-center gap-2"><Block className="h-8 w-52 max-w-full" /><Block className="h-7 w-20 !rounded-full" /></div><Block className="h-4 w-36 max-w-full" /></div></div><div className="space-y-2"><Block className="h-3 w-28" /><Block className="h-8 w-36" /></div></div>
      <div className="grid gap-5 xl:grid-cols-[1.65fr_1fr]">
        <div className="space-y-5">
          <div className="rounded-2xl bg-neutral-50 p-5"><Block className="aspect-[16/10] w-full sm:aspect-[16/9]" /><div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-6">{[0, 1, 2, 3].map((item) => <Block key={item} className="h-16 w-full" />)}</div></div>
          <div className="rounded-2xl bg-neutral-50 p-5"><Block className="h-6 w-44" /><div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((item) => <div key={item} className="space-y-2 rounded-xl bg-neutral-100 p-3"><Block className="h-3 w-16" /><Block className="h-4 w-4/5" /></div>)}</div></div>
          <div className="space-y-3 rounded-2xl bg-neutral-50 p-5"><Block className="h-6 w-44" /><Block className="h-4 w-full" /><Block className="h-4 w-5/6" /><Block className="h-4 w-2/3" /></div>
          <div className="rounded-2xl bg-neutral-50 p-5"><Block className="h-6 w-40" /><div className="mt-4 flex flex-wrap items-center gap-4 rounded-xl bg-neutral-100 p-4"><Block className="h-16 w-16 !rounded-full" /><div className="min-w-0 flex-1 space-y-2"><Block className="h-5 w-36" /><Block className="h-4 w-48 max-w-full" /></div><Block className="h-11 w-28" /></div></div>
        </div>
        <div className="space-y-5">
          <div className="space-y-4 rounded-2xl bg-neutral-50 p-5"><Block className="h-6 w-40" /><Block className="h-4 w-4/5" /><div className="grid grid-cols-2 gap-3">{[0, 1, 2, 3].map((item) => <div key={item} className="space-y-2"><Block className="h-3 w-20" /><Block className="h-12 w-full" /></div>)}</div><Block className="h-16 w-full" /><Block className="h-12 w-full" /></div>
          <div className="rounded-2xl bg-neutral-50 p-5"><div className="flex justify-between gap-3"><Block className="h-6 w-24" /><Block className="h-7 w-20 !rounded-full" /></div><Block className="mt-3 h-4 w-4/5" /><div className="mt-4 space-y-3">{[0, 1, 2].map((item) => <div key={item} className="space-y-3 rounded-xl bg-neutral-100 p-4"><div className="flex items-center gap-2"><Block className="h-9 w-9 !rounded-full" /><Block className="h-4 w-28" /></div><Block className="h-4 w-full" /><Block className="h-4 w-3/4" /></div>)}</div></div>
        </div>
      </div>
    </main>
  );

  if (page === "booking-history") return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 pb-16 pt-24 sm:px-6">
      <div className="space-y-3"><Block className="h-4 w-36" /><div className="flex items-center justify-between gap-3"><Block className="h-9 w-48" /><Block className="h-11 w-28" /></div><Block className="h-4 w-72 max-w-full" /><Block className="h-4 w-44" /></div>
      <div className="flex w-full gap-2 overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50 p-2 sm:w-fit">{[0, 1, 2, 3].map((item) => <Block key={item} className="h-10 w-20 shrink-0" />)}</div>
      <BookingListSkeleton />
    </main>
  );

  if (page === "realtime-chat") return (
    <main className="mx-auto max-w-[1380px] space-y-5 px-4 pb-12 pt-24 sm:px-6 sm:pt-28">
      <div className="flex items-center justify-between gap-4 rounded-2xl bg-neutral-50 p-5"><div className="flex items-center gap-4"><Block className="h-12 w-12 shrink-0" /><div className="space-y-2"><Block className="h-3 w-24" /><Block className="h-8 w-40" /><Block className="h-4 w-64 max-w-full" /></div></div><Block className="hidden h-8 w-36 !rounded-full sm:block" /></div>
      <div className="grid min-h-[32rem] overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50 md:grid-cols-[minmax(260px,0.38fr)_1fr]">
        <div className="border-r border-neutral-200"><div className="space-y-3 border-b border-neutral-200 p-4"><Block className="h-5 w-36" /><Block className="h-11 w-full" /></div><ConversationListSkeleton /></div>
        <InboxDetailSkeleton />
      </div>
    </main>
  );

  if (page === "notifications") return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 pb-16 pt-24 sm:px-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center"><div className="space-y-2"><Block className="h-4 w-28" /><Block className="h-9 w-48" /><Block className="h-4 w-44" /></div><div className="flex flex-wrap gap-2"><Block className="h-10 w-24" /><Block className="h-10 w-24" /><Block className="h-10 w-36" /></div></div>
      <ActivityListSkeleton label="Loading notifications" />
    </main>
  );

  if (page === "account-settings") return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6 px-4 pb-16 pt-24 sm:px-6 lg:flex-row">
      <aside className="hidden w-72 shrink-0 space-y-2 self-start rounded-2xl bg-neutral-50 p-5 lg:block">{[0, 1, 2, 3, 4, 5].map((item) => <div key={item} className="flex items-center gap-3 p-2"><Block className="h-5 w-5 shrink-0" /><Block className="h-4 w-4/5" /></div>)}</aside>
      <div className="min-w-0 flex-1 space-y-6"><div className="space-y-2"><Block className="h-4 w-32" /><Block className="h-9 w-52" /><Block className="h-4 w-4/5 max-w-md" /></div><div className="flex items-center gap-4 rounded-2xl bg-neutral-50 p-6"><Block className="h-24 w-24 shrink-0 !rounded-full" /><div className="space-y-3"><Block className="h-6 w-40" /><Block className="h-4 w-48" /><Block className="h-4 w-28" /></div></div>{[0, 1, 2].map((panel) => <div key={panel} className="space-y-4 rounded-2xl bg-neutral-50 p-5"><div className="flex justify-between"><Block className="h-6 w-48" /><Block className="h-10 w-20" /></div><div className="grid gap-4 sm:grid-cols-2">{[0, 1, 2, 3].map((field) => <div key={field} className="space-y-2"><Block className="h-4 w-24" /><Block className="h-11 w-full" /></div>)}</div></div>)}</div>
    </main>
  );

  if (page === "reports") return (
    <main className="mx-auto max-w-6xl space-y-5 px-4 pb-16 pt-24 sm:px-6">
      <div className="flex flex-col justify-between gap-4 rounded-3xl border border-neutral-200 bg-neutral-50 p-5 sm:flex-row sm:items-center sm:p-6"><div className="space-y-2"><Block className="h-3 w-28" /><Block className="h-8 w-56" /><Block className="h-4 w-full max-w-md" /></div><Block className="h-10 w-28" /></div>
      <div className="flex w-fit gap-2 rounded-xl border border-neutral-200 bg-neutral-50 p-1">{[0, 1, 2].map((item) => <Block key={item} className="h-10 w-24" />)}</div>
      {[0, 1].map((item) => <article key={item} className="space-y-4 rounded-3xl border border-neutral-200 bg-neutral-50 p-5 sm:p-6"><div className="flex justify-between gap-3"><div className="space-y-2"><Block className="h-3 w-36" /><Block className="h-6 w-52" /><Block className="h-4 w-44" /></div><Block className="h-7 w-24 !rounded-full" /></div><Block className="h-4 w-full" /><Block className="h-4 w-4/5" /><div className="flex gap-2 border-t border-neutral-200 pt-4"><Block className="h-10 w-28" /><Block className="h-10 w-24" /></div></article>)}
    </main>
  );

  if (page === "about") return (
    <main className="mx-auto max-w-5xl px-4 pb-20 pt-24 sm:px-6 sm:pt-28">
      <div className="mb-12 space-y-3 text-center"><Block className="mx-auto h-9 w-64 max-w-full" /><Block className="mx-auto h-4 w-4/5 max-w-md" /></div>
      <div className="mx-auto mb-14 max-w-4xl space-y-4 rounded-xl border border-neutral-200 bg-neutral-50 p-6 sm:p-8"><Block className="h-6 w-40" />{[0, 1, 2].map((item) => <div key={item} className="space-y-2"><Block className="h-4 w-full" /><Block className="h-4 w-5/6" /></div>)}</div>
      <div className="mx-auto mb-16 grid max-w-4xl gap-6 sm:grid-cols-3">{[0, 1, 2].map((item) => <div key={item} className="space-y-3 rounded-xl border border-neutral-200 bg-neutral-50 p-6 text-center"><Block className="mx-auto h-8 w-20" /><Block className="mx-auto h-4 w-24" /></div>)}</div>
      <Block className="mx-auto mb-10 h-8 w-48" /><div className="grid gap-8 md:grid-cols-3">{[0, 1, 2].map((item) => <div key={item} className="space-y-3 rounded-xl border border-neutral-200 bg-neutral-50 p-6"><Block className="mx-auto h-14 w-14 !rounded-full" /><Block className="mx-auto h-5 w-3/4" /><Block className="h-4 w-full" /><Block className="h-4 w-5/6" /></div>)}</div>
    </main>
  );

  if (page === "privacy-policy" || page === "terms-and-conditions") return (
    <main className="mx-auto max-w-4xl space-y-8 px-4 pb-20 pt-28 sm:px-6">
      <div className="space-y-3"><Block className="h-9 w-2/3" /><Block className="h-4 w-full" /><Block className="h-4 w-5/6" /></div>
      {[0, 1, 2, 3].map((section) => <section key={section} className="space-y-3"><Block className="h-6 w-1/3" /><Block className="h-4 w-full" /><Block className="h-4 w-full" /><Block className="h-4 w-4/5" /></section>)}
    </main>
  );

  return <main className="mx-auto max-w-7xl space-y-6 px-4 pb-16 pt-24 sm:px-6"><Block className="h-8 w-56 max-w-full" /><Block className="h-4 w-4/5 max-w-md" /><div className="rounded-2xl bg-neutral-50 p-5 sm:p-8"><Block className="h-5 w-1/3" /><Block className="mt-6 h-12 w-full" /><Block className="mt-4 h-12 w-full" /><Block className="mt-4 h-12 w-3/4" /></div></main>;
}

function OwnerPageHeadingSkeleton({ actions = false }) {
  return <div className="flex flex-wrap items-start justify-between gap-3"><div className="space-y-2"><Block className="h-8 w-52 max-w-full" /><Block className="h-4 w-72 max-w-full" /></div>{actions && <Block className="h-11 w-28" />}</div>;
}

function OwnerRouteContent() {
  let tab = "Dashboard";
  try {
    tab = new URLSearchParams(window.location.search).get("tab") || sessionStorage.getItem("rentifypro:owner-active-page") || tab;
  } catch {
    // A dashboard-shaped placeholder remains useful when storage is unavailable.
  }
  if (tab === "Analytics") return <div className="space-y-5"><OwnerPageHeadingSkeleton actions /><AnalyticsContentSkeleton /></div>;
  if (tab === "Earnings") return <EarningsContentSkeleton />;
  if (tab === "Vehicles") return <div className="space-y-6"><OwnerPageHeadingSkeleton /><Block className="h-4 w-40" /><div className="flex flex-col gap-3 rounded-xl bg-neutral-50 p-4 md:flex-row"><Block className="h-11 w-full md:flex-1" /><Block className="h-11 w-full md:w-48" /></div><VehicleGridSkeleton label="Loading your vehicles" className="rp-owner-vehicle-grid" managed /></div>;
  if (tab === "Bookings") return <div className="space-y-6"><OwnerPageHeadingSkeleton actions /><Block className="h-4 w-48" /><div className="flex flex-wrap gap-2 rounded-2xl bg-neutral-50 p-2">{[0, 1, 2, 3, 4].map((item) => <Block key={item} className="h-10 w-24" />)}</div><BookingListSkeleton /></div>;
  if (tab === "Notifications" || tab === "Reviews") return <div className="space-y-6"><OwnerPageHeadingSkeleton actions />{tab === "Reviews" && <div className="space-y-2 rounded-xl bg-neutral-50 p-5"><Block className="h-4 w-28" /><Block className="h-8 w-20" /></div>}<ActivityListSkeleton label={`Loading ${tab.toLowerCase()}`} /></div>;
  if (tab === "Messages") return <div className="space-y-5"><OwnerPageHeadingSkeleton /><div className="grid min-h-[28rem] overflow-hidden rounded-2xl bg-neutral-50 lg:grid-cols-[320px_1fr]"><div><Block className="m-4 h-11 w-[calc(100%-2rem)]" /><ConversationListSkeleton /></div><InboxDetailSkeleton className="hidden lg:flex" /></div></div>;
  if (tab === "Reports") return <div className="space-y-5"><OwnerPageHeadingSkeleton actions /><div className="flex gap-2 rounded-xl bg-neutral-50 p-2">{[0, 1, 2].map((item) => <Block key={item} className="h-10 w-24" />)}</div><ActivityListSkeleton label="Loading reports" count={2} /></div>;
  if (tab === "Profile") return <div className="space-y-6"><OwnerPageHeadingSkeleton /><div className="flex items-center gap-4 rounded-2xl bg-neutral-50 p-6"><Block className="h-24 w-24 !rounded-full" /><div className="space-y-2"><Block className="h-6 w-40" /><Block className="h-4 w-48" /></div></div>{[0, 1, 2].map((item) => <div key={item} className="space-y-4 rounded-2xl bg-neutral-50 p-5"><Block className="h-6 w-44" /><div className="grid gap-3 sm:grid-cols-2"><Block className="h-11 w-full" /><Block className="h-11 w-full" /></div></div>)}</div>;
  if (tab === "Settings") return <OwnerPageHeadingSkeleton />;
  return <OwnerDashboardSkeleton />;
}

export function RouteSkeleton({ page = "home", label = "Loading page" }) {
  if (["signin", "register", "register-owner", "registerotp", "forgot-email", "forgot-otp", "reset-password", "vehicle-owner-proceed", "vehicle-owner-verification"].includes(page)) {
    return <AuthRouteSkeleton page={page} label={label} />;
  }
  if (page === "help") return <HelpRouteSkeleton label={label} />;
  if (page === "not-found") return (
    <div role="status" aria-label={label} className="flex min-h-screen items-center justify-center bg-neutral-100 px-5 py-16">
      <div aria-hidden="true" className="w-full max-w-xl space-y-5 rounded-3xl border border-neutral-200 bg-neutral-50 p-8 text-center sm:p-12">
        <Block className="mx-auto h-16 w-16 rounded-2xl" /><Block className="mx-auto h-4 w-16" /><Block className="mx-auto h-9 w-3/4" /><Block className="mx-auto h-4 w-full max-w-md" /><Block className="mx-auto h-4 w-5/6 max-w-sm" />
        <div className="flex flex-col justify-center gap-3 pt-3 sm:flex-row"><Block className="h-12 w-full sm:w-36" /><Block className="h-12 w-full sm:w-36" /></div>
      </div>
    </div>
  );
  if (page === "owner-dashboard") return (
    <div role="status" aria-label={label} className="flex min-h-screen bg-neutral-100">
      <div aria-hidden="true" className="hidden w-64 shrink-0 space-y-5 border-r border-neutral-200 bg-neutral-50 p-5 lg:block"><Block className="h-10 w-36" /><Block className="h-20 w-full" />{[0, 1, 2, 3, 4, 5, 6].map((item) => <Block key={item} className="h-11 w-full" />)}</div>
      <div aria-hidden="true" className="min-w-0 flex-1"><div className="flex h-20 items-center justify-between border-b border-neutral-200 bg-neutral-50 px-4 sm:px-6"><div className="flex items-center gap-3"><Block className="h-11 w-11 lg:hidden" /><div className="space-y-2"><Block className="h-6 w-44" /><Block className="hidden h-4 w-64 sm:block" /></div></div><div className="flex gap-2"><Block className="h-11 w-11" /><Block className="h-11 w-11" /></div></div><main className="p-4 sm:p-5 lg:p-6"><OwnerRouteContent /></main></div>
    </div>
  );
  if (page === "admin-dashboard") return (
    <div role="status" aria-label={label} className="min-h-screen bg-neutral-100 lg:pl-64">
      <div aria-hidden="true" className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-neutral-200 bg-neutral-200 lg:flex"><div className="flex items-center gap-3 border-b border-neutral-300 p-5"><Block className="h-11 w-11" /><div className="space-y-2"><Block className="h-5 w-28" /><Block className="h-3 w-32" /></div></div><div className="mx-3 mt-4 flex items-center gap-3 rounded-xl bg-neutral-100 p-3"><Block className="h-10 w-10 !rounded-full" /><div className="space-y-2"><Block className="h-4 w-24" /><Block className="h-3 w-32" /></div></div><div className="flex-1 space-y-4 p-5">{[0, 1, 2, 3].map((group) => <div key={group} className="space-y-2"><Block className="h-3 w-24" /><Block className="h-11 w-full" />{group % 2 === 1 && <Block className="h-11 w-full" />}</div>)}</div><div className="border-t border-neutral-300 p-4"><Block className="h-11 w-full" /></div></div>
      <div aria-hidden="true" className="min-w-0"><header className="border-b border-neutral-200 bg-neutral-50 px-4 py-4 sm:px-5"><div className="mx-auto flex max-w-[1600px] justify-between gap-3"><div className="flex items-start gap-3"><Block className="h-11 w-11 lg:hidden" /><div className="space-y-2"><Block className="h-8 w-44" /><Block className="h-4 w-4/5 max-w-md" /></div></div><Block className="hidden h-11 w-36 sm:block" /></div></header><main className="mx-auto max-w-[1600px] p-4 sm:p-5"><AdminDataSkeleton /></main></div>
    </div>
  );
  return (
    <div role="status" aria-label={label} className="min-h-screen bg-neutral-100">
      <div aria-hidden="true"><RenterHeaderSkeleton /><RouteContent page={page} /></div>
    </div>
  );
}

export function SignOutProgress() {
  return <main role="status" aria-label="Signing out" className="flex min-h-screen items-center justify-center bg-slate-50 px-4"><div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-sm"><div aria-hidden="true" className="mx-auto mb-5 h-10 w-10 animate-spin rounded-full border-4 border-blue-100 border-t-[#017FE6] motion-reduce:animate-none" /><h1 className="text-xl font-bold text-slate-900">Signing out</h1><p className="mt-2 text-sm text-slate-600">Finishing your session securely...</p></div></main>;
}
