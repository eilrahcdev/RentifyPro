import { useEffect, useMemo, useState } from "react";

import API from "../../utils/api";
import { formatDisplayName } from "../../utils/dateUtils";
import { resolveAssetUrl } from "../../utils/media";

const getRenterProfile = (renter) => {
  const name = formatDisplayName(renter?.name || "", "");
  const email = String(renter?.email || "").trim();
  const displayName = name || email || "Renter";
  const initialsSource = name || email || "R";
  const initials = initialsSource
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "R";

  return {
    displayName,
    email,
    avatar: resolveAssetUrl(renter?.avatar),
    initials,
  };
};

export default function Reviews() {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [ratingFilter, setRatingFilter] = useState("all");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await API.getOwnerReviews();
        setReviews(response.reviews || []);
      } catch (err) {
        setError(err.message || "Failed to load reviews.");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const filtered = useMemo(() => {
    if (ratingFilter === "all") return reviews;
    if (ratingFilter === "positive") return reviews.filter((review) => review.rating >= 4);
    return reviews.filter((review) => review.rating <= 3);
  }, [reviews, ratingFilter]);

  const average =
    filtered.length > 0
      ? filtered.reduce((sum, review) => sum + review.rating, 0) / filtered.length
      : 0;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reviews & Ratings</h1>
          <p className="text-sm text-gray-600">Renter feedback from completed bookings.</p>
        </div>
        <div className="flex gap-2">
          {["all", "positive", "negative"].map((item) => (
            <button
              key={item}
              onClick={() => setRatingFilter(item)}
              className={`px-3 py-2 rounded-lg border text-sm ${
                ratingFilter === item
                  ? "bg-[#017FE6] border-[#017FE6] text-white"
                  : "bg-white text-gray-700"
              }`}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border p-5">
        <p className="text-sm text-gray-500">Average Rating</p>
        <p className="text-3xl font-bold">{average.toFixed(1)} / 5</p>
        <p className="text-sm text-gray-500">{filtered.length} review(s)</p>
      </div>

      {loading && <p className="text-sm text-gray-600">Loading reviews...</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {!loading && !error && filtered.length === 0 && (
        <div className="bg-white rounded-xl border p-6 text-sm text-gray-600">
          No reviews found.
        </div>
      )}

      <div className="space-y-3">
        {filtered.map((review) => {
          const renter = getRenterProfile(review.renter);
          return (
            <article key={review._id} className="bg-white rounded-xl border p-4">
              <div className="flex justify-between items-start gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <RenterAvatar profile={renter} />
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{renter.displayName}</p>
                    <p className="text-xs text-gray-500 truncate">{renter.email || "No email provided"}</p>
                    <p className="text-sm text-gray-500 truncate">{review.vehicle?.name || "Vehicle"}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-semibold">{review.rating} / 5</p>
                  <p className="text-xs text-gray-500">
                    {review.createdAt ? new Date(review.createdAt).toLocaleString() : "-"}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-sm text-gray-700">{review.comment || "No comment provided."}</p>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function RenterAvatar({ profile }) {
  const avatar = String(profile?.avatar || "").trim();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [avatar]);

  if (avatar && !failed) {
    return (
      <img
        src={avatar}
        alt={profile?.displayName || "Renter"}
        className="h-10 w-10 rounded-full object-cover border border-slate-200 flex-shrink-0"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div className="h-10 w-10 rounded-full bg-[#017FE6] text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
      {profile?.initials || "R"}
    </div>
  );
}
