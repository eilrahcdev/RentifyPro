export default function OwnerPageHeader({
  title,
  description,
  actions,
  className = "",
}) {
  return (
    <header className={`rp-owner-page-header ${className}`.trim()}>
      <div className="rp-owner-page-header__copy">
        <h1>{title}</h1>
        {description && <p className="rp-owner-page-header__description">{description}</p>}
      </div>
      {actions && <div className="rp-owner-page-header__actions">{actions}</div>}
    </header>
  );
}
