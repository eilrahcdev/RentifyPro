export default function SkeletonBlock({ className = "" }) {
  return <span aria-hidden="true" className={`block rounded-lg bg-neutral-300 motion-safe:animate-pulse ${className}`} />;
}
