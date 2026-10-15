import './page-skeleton.css'

export default function PageSkeleton({ layout = 'list', label = 'Carregando conteúdo da tela', heading = true }) {
  return <section className={`page-skeleton page-skeleton-${layout}`} role="status" aria-label={label}>
    <span className="page-skeleton-announcement">{label}…</span>
    <div aria-hidden="true">
      {heading && <div className="page-skeleton-heading"><span className="skeleton-block skeleton-title" /><span className="skeleton-block skeleton-subtitle" /></div>}
      {(layout === 'dashboard' || layout === 'cards') && <div className="page-skeleton-stats">{[0, 1, 2].map(index => <div className="skeleton-panel" key={index}><span className="skeleton-block skeleton-subtitle" /><span className="skeleton-block skeleton-value" /></div>)}</div>}
      <div className="page-skeleton-toolbar"><span className="skeleton-block skeleton-search" /><span className="skeleton-block skeleton-control" /></div>
      <div className={layout === 'cards' ? 'page-skeleton-cards' : 'skeleton-panel'}>
        {Array.from({ length: layout === 'cards' ? 3 : 5 }, (_, index) => <div className={layout === 'cards' ? 'skeleton-panel skeleton-ticket' : 'page-skeleton-row'} key={index}>
          <span className="skeleton-block skeleton-row-primary" /><span className="skeleton-block skeleton-row-secondary" /><span className="skeleton-block skeleton-row-value" />
        </div>)}
      </div>
    </div>
  </section>
}
