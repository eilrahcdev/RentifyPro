import { useEffect, useState } from "react";

const BASE_URL = "https://psgc.gitlab.io/api";
const empty = { key: "", data: [], status: "idle", error: "" };

async function loadLocations(path, signal) {
  const response = await fetch(`${BASE_URL}/${path}/`, { signal });
  if (!response.ok) throw new Error("Location options are unavailable. Try loading them again.");
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error("Location options could not be read. Try loading them again.");
  return data;
}

function useLocationList(path, revision) {
  const [state, setState] = useState(empty);
  useEffect(() => {
    if (!path) return undefined;
    const controller = new AbortController();
    let active = true;
    loadLocations(path, controller.signal).then((data) => {
      if (active) setState({ key: `${path}:${revision}`, data, status: "ready", error: "" });
    }).catch((error) => {
      if (active && error.name !== "AbortError") setState({ key: `${path}:${revision}`, data: [], status: "error", error: error.message });
    });
    return () => { active = false; controller.abort(); };
  }, [path, revision]);
  if (!path) return empty;
  return state.key === `${path}:${revision}` ? state : { ...empty, status: "loading" };
}

export default function useOwnerLocations(location) {
  const [revision, setRevision] = useState(0);
  const regions = useLocationList("regions", revision);
  const provinces = useLocationList(location.region ? `regions/${encodeURIComponent(location.region)}/provinces` : "", revision);
  const citiesPath = provinces.status === "ready"
    ? provinces.data.length
      ? location.province ? `provinces/${encodeURIComponent(location.province)}/cities-municipalities` : ""
      : `regions/${encodeURIComponent(location.region)}/cities-municipalities`
    : "";
  const cities = useLocationList(citiesPath, revision);
  const barangays = useLocationList(location.city ? `cities-municipalities/${encodeURIComponent(location.city)}/barangays` : "", revision);
  const lists = { regions, provinces, cities, barangays };
  return {
    ...lists,
    error: Object.values(lists).find((list) => list.error)?.error || "",
    loading: Object.values(lists).some((list) => list.status === "loading"),
    retry: () => setRevision((value) => value + 1),
  };
}
