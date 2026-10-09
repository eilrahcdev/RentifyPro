export default function PolicyContents({ sections }) {
  return (
    <details className="rp-policy-contents">
      <summary>Jump to a section</summary>
      <nav aria-label="Policy sections">
        {sections.map((title, index) => <a key={title} href={`#policy-section-${index + 1}`}>{title}</a>)}
      </nav>
    </details>
  );
}
