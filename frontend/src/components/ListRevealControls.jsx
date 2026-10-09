export default function ListRevealControls({ list, label = "vehicles" }) {
  if (!list.compact || list.total === 0) return null;
  return (
    <div className="rp-list-reveal">
      <p role="status" aria-live="polite">Showing {list.count} of {list.total} loaded {label}</p>
      {list.count < list.total && (
        <button type="button" onClick={list.loadMore} className="rp-btn-secondary">Load more</button>
      )}
    </div>
  );
}
