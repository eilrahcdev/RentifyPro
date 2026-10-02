import { RouteSkeleton } from "./LoadingSkeletons";

export default function SessionSkeleton({ page = "home", label = "Loading your account" }) {
  return <RouteSkeleton page={page} label={label} />;
}
