import { useEffect, useState } from "react";
import API, { API_BASE_URL } from "../utils/api";
import AutoResizeTextarea from "./AutoResizeTextarea";

const vehiclePhotoUrl = (id) => `${API_BASE_URL}/vehicle-photos/${id}/file`;

export default function VehiclePhotoReviews({ admin = false, vehicleType, onSelect, onRefresh, refreshSignal = "" }) {
  const [photos, setPhotos] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [signal, setSignal] = useState(0);
  useEffect(() => {
    let active = true;
    API.getVehiclePhotos().then((response) => { if (active) { setPhotos(response.photos || []); setError(""); } }).catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [signal, refreshSignal]);
  const choose = async (photo) => {
    setBusy(true); setError("");
    try {
      const response = await fetch(vehiclePhotoUrl(photo.id), { credentials: "include", cache: "no-store" });
      if (!response.ok) throw new Error("Could not load the reviewed photo.");
      const file = new File([await response.blob()], `${photo.id}.webp`, { type: "image/webp" });
      file.reviewId = photo.id; file.reviewType = photo.vehicleType;
      onSelect(file);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const decide = async (event, photo) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const status = event.nativeEvent.submitter?.value;
    setBusy(true); setError("");
    try {
      await API.reviewVehiclePhoto(photo.id, { status, exterior: data.get("exterior") === "on", reason: data.get("reason") });
      setSignal((value) => value + 1);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const visible = photos.filter((photo) => admin || photo.vehicleType === vehicleType);
  return <section className="rounded-xl border border-slate-200 bg-white p-4" aria-label={admin ? "Vehicle photo review queue" : "Your reviewed vehicle photos"}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="font-semibold text-slate-900">{admin ? "Vehicle photos awaiting review" : "Your photo reviews"}</h3>
      <button type="button" disabled={busy} onClick={() => { onRefresh?.(); setSignal((value) => value + 1); }} className="rounded-lg border px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2">Refresh reviews</button>
    </div>
    <p className="mt-2 text-sm text-slate-600">{admin ? "Approve only relevant vehicle photos. Covers must clearly show the vehicle exterior. People beside a vehicle are allowed; selfies and unrelated images are not." : "Pending photos stay private. After approval, add them to your listing here. Use an exterior photo as the cover."}</p>
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    {!visible.length && <p className="mt-3 text-sm text-slate-600">No photo reviews to show.</p>}
    <div className="mt-3 grid max-h-[32rem] gap-4 overflow-y-auto sm:grid-cols-2">
      {visible.map((photo) => <article key={photo.id} className="rounded-lg border border-slate-200 p-3">
        <img crossOrigin="use-credentials" src={vehiclePhotoUrl(photo.id)} alt={`${photo.vehicleType} photo submitted for review`} className="h-40 w-full object-contain" />
        <p className="mt-2 text-sm font-semibold">{photo.vehicleType} · {photo.status.replaceAll("_", " ")}{photo.exterior ? " · exterior" : ""}</p>
        <p className="mt-1 text-sm text-slate-600">{photo.reason}</p>
        {admin ? <form onSubmit={(event) => decide(event, photo)} className="mt-3 space-y-2">
          <label className="flex gap-2 text-sm"><input type="checkbox" name="exterior" />Clear exterior suitable for a cover</label>
          <label className="block text-sm">Review reason<AutoResizeTextarea name="reason" required minLength={5} maxLength={500} className="mt-1 w-full rounded border p-2" /></label>
          <div className="flex gap-2"><button disabled={busy} type="submit" value="approved" className="rounded bg-blue-700 px-3 py-2 text-sm text-white disabled:opacity-50">Approve</button><button disabled={busy} type="submit" value="rejected" className="rounded border px-3 py-2 text-sm disabled:opacity-50">Reject</button></div>
        </form> : photo.status === "approved" && <button type="button" disabled={busy} onClick={() => choose(photo)} className="mt-3 rounded-lg border px-3 py-2 text-sm">Add approved photo</button>}
      </article>)}
    </div>
  </section>;
}
