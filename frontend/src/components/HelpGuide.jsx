export default function HelpGuide({ guide, compact = false, titleRef }) {
  const Title = compact ? "h3" : "h1";
  const SectionTitle = compact ? "h4" : "h2";
  const titleId = `help-title-${guide.slug}-${compact ? "panel" : "page"}`;
  return (
    <article aria-labelledby={titleId}>
      <Title ref={titleRef} id={titleId} tabIndex={-1} className={`${compact ? "text-xl" : "text-2xl sm:text-3xl"} font-bold tracking-tight text-slate-900`}>
        {guide.title}
      </Title>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">{guide.summary}</p>

      <ol className={`${compact ? "mt-6 space-y-5" : "mt-8 space-y-7"} max-w-3xl`}>
        {guide.steps.map((step, index) => (
          <li key={step.title} className="flex items-start gap-4">
            <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-700 text-sm font-bold text-white">
              {index + 1}
            </span>
            <div className="min-w-0 pt-0.5">
              <SectionTitle className="text-base font-bold text-slate-900">{step.title}</SectionTitle>
              <p className="mt-1 text-sm leading-6 text-slate-700">{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-8 max-w-3xl rounded-xl bg-blue-50 px-4 py-4 sm:px-5">
        <SectionTitle className="text-sm font-bold text-blue-950">What happens next?</SectionTitle>
        <p className="mt-1 text-sm leading-6 text-blue-950">{guide.next}</p>
      </div>
    </article>
  );
}
