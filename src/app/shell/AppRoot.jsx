import { createPortal } from 'react-dom'
import Button from '../../shared/ui/Button'
import ConnectionBanner from './ConnectionBanner'
import ToastRegion from '../../shared/ui/ToastRegion.jsx'
import LoginScreen from './LoginScreen'
import StartupScreen from './StartupScreen'

const portal = (node) => node && typeof document !== 'undefined' ? createPortal(node, document.body) : node

export default function AppRoot({ contextSurface, isOnline, authState, authMode, operationalAccess = true, loginLoading, loginError, onLogin, bootstrapState, onRetryBootstrap, retryDisabled, toasts = [], onDismissToast, onPauseToast, children }) {
  if (authState === 'checking') return <>{!isOnline && <ConnectionBanner />}<StartupScreen message="Verificando sua sessão…" /></>
  if (authState === 'anonymous') return <>{!isOnline && <ConnectionBanner />}<LoginScreen authMode={authMode} onLogin={onLogin} loading={loginLoading} error={loginError} disabled={!isOnline} /></>
  if (contextSurface) return <>{!isOnline && <ConnectionBanner />}{contextSurface}</>
  if (operationalAccess && bootstrapState !== 'ready') return <>{!isOnline && <ConnectionBanner />}{bootstrapState === 'error' ? <div className="system-state-screen"><div className="system-state-card"><h2>Não foi possível carregar os dados</h2><p>Confira sua conexão e tente novamente.</p><Button type="button" onClick={onRetryBootstrap} disabled={retryDisabled}>Tentar novamente</Button></div></div> : <StartupScreen />}</>
  return <>{!isOnline && <ConnectionBanner />}{portal(<ToastRegion toasts={toasts} onDismiss={onDismissToast} onPause={onPauseToast} />)}{children}</>
}
