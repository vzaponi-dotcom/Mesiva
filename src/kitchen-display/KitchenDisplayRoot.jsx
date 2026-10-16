import { getKitchenDisplayCompatibilityIssues } from './kitchenDisplayLegacyCompat.js'
import { createStoredKitchenDisplayRealtimeApi } from './kitchenDisplaySession.js'
import { Component, StrictMode, useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import { KitchenDisplayApp } from './KitchenDisplayApp.jsx'
import './kitchen-display.css'

const errorDetail = (error) => error instanceof Error ? `${error.name}: ${error.message}` : String(error || 'KDS_RENDER_ERROR')

export class KitchenDisplayErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { detail: '' }
  }

  componentDidCatch(error) {
    this.setState({ detail: errorDetail(error) })
  }

  render() {
    if (this.state.detail) {
      return <main className="kds-shell">
        <section className="kds-pairing-card">
          <p className="kds-pairing-kicker">Compatibilidade da TV</p>
          <h1>O painel encontrou um recurso não suportado</h1>
          <p>Atualize a página e tente novamente. Se continuar, informe o código abaixo ao suporte.</p>
          <small className="kds-compatibility-detail">{this.state.detail}</small>
          <button type="button" onClick={() => window.location.reload()}>Tentar novamente</button>
        </section>
      </main>
    }
    return this.props.children
  }
}

export function KitchenDisplayRoot() {
  const realtimeApi=useMemo(()=>createStoredKitchenDisplayRealtimeApi(),[])
  const issues = getKitchenDisplayCompatibilityIssues()
  if (issues.length) {
    return <main className="kds-shell">
      <section className="kds-pairing-card">
        <p className="kds-pairing-kicker">Compatibilidade da TV</p>
        <h1>Este navegador não oferece todos os recursos necessários</h1>
        <small className="kds-compatibility-detail">{`KDS_COMPAT_MISSING: ${issues.join(', ')}`}</small>
      </section>
    </main>
  }
  return <KitchenDisplayApp realtimeApi={realtimeApi} />
}

export function mount(container) {
  createRoot(container).render(
    <StrictMode>
      <KitchenDisplayErrorBoundary><KitchenDisplayRoot /></KitchenDisplayErrorBoundary>
    </StrictMode>,
  )
}
