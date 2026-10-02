import { useEffect, useMemo, useState } from "react";
import { Star } from "lucide-react";

import API from "../../utils/api";
import { formatDisplayName } from "../../utils/dateUtils";
import { resolveAssetUrl } from "../../utils/media";
import { ActivityListSkeleton } from "../../components/LoadingSkeletons";
import OwnerPageHeader from "../components/OwnerPageHeader";

const groups = [
  { id: "positive", label: "Positive", range: "4–5 stars", color: "#16A34A" },
  { id: "mixed", label: "Neutral", range: "3 stars", color: "#EAB308" },
  { id: "attention", label: "Negative", range: "1–2 stars", color: "#DC2626" },
];

const ratingGroup = (rating) => Number(rating) >= 4 ? "positive" : Number(rating) >= 3 ? "mixed" : "attention";
const reviewCountFormatter = new Intl.NumberFormat("en-PH");
const formatReviewCount = (count) => reviewCountFormatter.format(count);

const reviewDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};

export default function Reviews() {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [vehicleFilter, setVehicleFilter] = useState("all");
  const [ratingFilter, setRatingFilter] = useState("all");
  const [sortOrder, setSortOrder] = useState("newest");

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await API.getOwnerReviews();
        if (active) setReviews(response.reviews || []);
      } catch (loadError) {
        if (active) setError(loadError.message || "Could not load reviews.");
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => { active = false; };
  }, [reload]);

  const vehicles = useMemo(() => {
    const byId = new Map();
    reviews.forEach((review) => {
      if (review.vehicle?._id) byId.set(String(review.vehicle._id), review.vehicle.name || "Vehicle");
    });
    return [...byId].sort((a, b) => a[1].localeCompare(b[1]));
  }, [reviews]);
  const scoped = useMemo(() => reviews.filter((review) => vehicleFilter === "all" || String(review.vehicle?._id) === vehicleFilter), [reviews, vehicleFilter]);
  const counts = useMemo(() => scoped.reduce((result, review) => {
    result[ratingGroup(review.rating)] += 1;
    return result;
  }, { positive: 0, mixed: 0, attention: 0 }), [scoped]);
  const average = scoped.length ? scoped.reduce((sum, review) => sum + Number(review.rating || 0), 0) / scoped.length : 0;
  const filtered = useMemo(() => [...scoped]
    .filter((review) => ratingFilter === "all" || ratingGroup(review.rating) === ratingFilter)
    .sort((a, b) => sortOrder === "lowest"
      ? Number(a.rating) - Number(b.rating) || new Date(b.createdAt) - new Date(a.createdAt)
      : new Date(b.createdAt) - new Date(a.createdAt)), [scoped, ratingFilter, sortOrder]);

  return (
    <div className="space-y-5">
      <OwnerPageHeader title="Reviews & Ratings" description="See what renters shared after their completed rentals." />
      {loading && <ActivityListSkeleton label="Loading reviews" />}
      {!loading && error && (
        <div role="alert" className="rounded-2xl border border-rose-200 bg-white p-5">
          <p className="text-sm text-rose-800">{error}</p>
          <button type="button" onClick={() => setReload((value) => value + 1)} className="mt-3 min-h-11 rounded-xl bg-[#017FE6] px-4 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700">Try again</button>
        </div>
      )}
      {!loading && !error && <>
        {vehicles.length > 1 && <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="owner-review-vehicle" className="text-sm font-semibold text-slate-700">Vehicle</label>
          <select id="owner-review-vehicle" value={vehicleFilter} onChange={(event) => { setVehicleFilter(event.target.value); setRatingFilter("all"); }} className="min-h-11 min-w-0 max-w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100">
            <option value="all">All vehicles</option>
            {vehicles.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>}

        {scoped.length ? <section aria-labelledby="owner-review-chart-title" className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between xl:gap-8">
            <div className="flex flex-col items-start gap-3">
              <h2 id="owner-review-chart-title" className="text-lg font-bold text-slate-950">Review Chart</h2>
              <ReviewPieChart counts={counts} total={scoped.length} />
            </div>
            <div className="flex min-w-0 flex-col gap-5 xl:w-64 xl:shrink-0 xl:self-center">
              <div className="px-3">
                <h2 className="text-sm font-semibold text-slate-600">Average rating</h2>
                <div className="mt-1 flex items-center gap-2 text-slate-950">
                  <Star size={27} strokeWidth={1.8} fill="currentColor" className="text-amber-600" aria-hidden="true" />
                  <span className="text-3xl font-bold tabular-nums">{average.toFixed(1)}</span>
                  <span className="text-base text-slate-500">/ 5</span>
                </div>
              </div>
              <div role="group" aria-label="Filter reviews by rating" className="flex flex-wrap gap-1 xl:flex-col">
                {groups.map((group) => <button key={group.id} type="button" aria-pressed={ratingFilter === group.id} aria-label={`${group.label}: ${formatReviewCount(counts[group.id])} ${counts[group.id] === 1 ? "review" : "reviews"}, ${group.range}. Filter reviews`} onClick={() => setRatingFilter((current) => current === group.id ? "all" : group.id)} className={`inline-flex min-h-11 min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${ratingFilter === group.id ? "bg-blue-50 text-blue-900 ring-1 ring-blue-500" : "text-slate-800 hover:bg-slate-50"}`}>
                  <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: group.color }} />
                  <span>{group.label}</span>
                  <span className="ml-auto shrink-0 whitespace-nowrap tabular-nums text-slate-600">{formatReviewCount(counts[group.id])}</span>
                </button>)}
              </div>
              <div data-testid="owner-review-total" className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold text-slate-600">Total reviews</p>
                <p className="mt-1 break-all text-3xl font-bold tabular-nums text-slate-950">{formatReviewCount(scoped.length)}</p>
              </div>
            </div>
          </div>
          {scoped.length <= 5 && <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-600">A few reviews can change the average quickly. Read the comments for context.</p>}
        </section> : <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">{vehicleFilter === "all" ? "No rental reviews yet. Reviews will appear here after renters rate a completed booking." : "No reviews yet for this vehicle."}</div>}

        {scoped.length > 0 && <section aria-labelledby="owner-review-list-title" className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><h2 id="owner-review-list-title" className="text-lg font-bold text-slate-950">Renter feedback</h2><p className="text-sm text-slate-600">Showing {formatReviewCount(filtered.length)} of {formatReviewCount(scoped.length)} {scoped.length === 1 ? "review" : "reviews"}</p></div>
            <div className="flex flex-wrap items-center gap-2">
              {ratingFilter !== "all" && <button type="button" onClick={() => setRatingFilter("all")} className="min-h-11 rounded-xl px-3 text-sm font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700">Show all ratings</button>}
              <label htmlFor="owner-review-sort" className="text-sm font-medium text-slate-700">Sort</label>
              <select id="owner-review-sort" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100"><option value="newest">Newest first</option><option value="lowest">Lowest rating first</option></select>
            </div>
          </div>
          {filtered.length === 0 ? <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">No reviews in this rating group for the selected vehicle.</div> : filtered.map((review) => <ReviewCard key={review._id} review={review} />)}
        </section>}
      </>}
    </div>
  );
}

function ReviewPieChart({ counts, total }) {
  const radius = 92;
  const center = 120;
  const firstGroup = groups.find((group) => counts[group.id] > 0);
  const pointAt = (fraction) => {
    const angle = 2 * Math.PI * fraction - Math.PI / 2;
    return [center + radius * Math.cos(angle), center + radius * Math.sin(angle)];
  };
  const { slices } = groups.reduce(({ preceding, slices: previousSlices }, group) => {
    const count = counts[group.id];
    const end = preceding + count;
    if (!count || group.id === firstGroup?.id) return { preceding: end, slices: previousSlices };
    const [startX, startY] = pointAt(preceding / total);
    const [endX, endY] = pointAt(end / total);
    return { preceding: end, slices: [...previousSlices, {
      id: group.id,
      color: group.color,
      path: `M ${center} ${center} L ${startX} ${startY} A ${radius} ${radius} 0 ${count > total / 2 ? 1 : 0} 1 ${endX} ${endY} Z`,
    }] };
  }, { preceding: 0, slices: [] });

  return <svg
    data-testid="owner-review-donut"
    viewBox="0 0 240 240"
    role="img"
    aria-label={`${formatReviewCount(total)} reviews: ${groups.map((group) => `${formatReviewCount(counts[group.id])} ${group.label.toLowerCase()}`).join(", ")}`}
    className="h-56 w-56 shrink-0 sm:h-72 sm:w-72 xl:h-96 xl:w-96"
  >
    <circle cx={center} cy={center} r={radius} fill={firstGroup?.color || "#E2E8F0"} />
    {slices.map((slice) => <path key={slice.id} d={slice.path} fill={slice.color} />)}
  </svg>;
}

function ReviewCard({ review }) {
  const name = formatDisplayName(review.renter?.name || "", "Renter");
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("") || "R";
  const avatar = resolveAssetUrl(review.renter?.avatar);
  const [imageFailed, setImageFailed] = useState(false);
  return <article className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        {avatar && !imageFailed ? <img src={avatar} alt="" className="h-11 w-11 shrink-0 rounded-full border border-slate-200 object-cover" onError={() => setImageFailed(true)} /> : <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#017FE6] text-xs font-bold text-white">{initials}</span>}
        <div className="min-w-0"><p className="break-words text-sm font-semibold text-slate-950">{name}</p><p className="break-words text-sm text-slate-600">{review.vehicle?.name || "Vehicle"}</p></div>
      </div>
      <div className="text-left sm:text-right"><span role="img" aria-label={`${review.rating} out of 5 stars`} className="inline-flex items-center gap-1.5 text-sm font-bold tabular-nums text-slate-950"><Star size={17} strokeWidth={1.8} fill="currentColor" className="text-amber-600" aria-hidden="true" />{review.rating}/5</span><p className="mt-1 text-xs text-slate-600">{reviewDate(review.createdAt)}</p></div>
    </div>
    <p className={`mt-4 max-w-3xl break-words text-sm leading-6 ${review.comment ? "text-slate-800" : "italic text-slate-500"}`}>{review.comment || "No written comment shared."}</p>
  </article>;
}
