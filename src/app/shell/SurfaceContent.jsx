import Button from '../../shared/ui/Button'
import PageSkeleton from '../../shared/ui/PageSkeleton.jsx'

export default function SurfaceContent({ state = 'ready', surface, onRetry, retryDisabled, children }) {
  if (state === 'error') return <section role="alert" className="surface-load-error"><h2>Não foi possível carregar os dados</h2><p>Confira sua conexão e tente novamente.</p><Button type="button" onClick={onRetry} disabled={retryDisabled}>Tentar novamente</Button></section>
  if (state !== 'ready') return <PageSkeleton layout={surface === 'orders' ? 'cards' : surface === 'dashboard' ? 'dashboard' : 'list'} />
  return children
}
