import { useRef, useState } from 'react'
import Button from '../../../shared/ui/Button'
import ConfirmationDialog from '../../../shared/ui/ConfirmationDialog'
import Icon from '../../../shared/ui/Icon'
import SystemSelect from '../../../shared/ui/SystemSelect'
import './printing.css'
import { hasCapability } from '../../../app/access.js'
import { detectPrintStationUiPlatform } from '../application/printingPlatform.js'
import { derivePrintOperationalStatus } from '../domain/printOperationalStatus.js'
import { buildPrintOperationalView } from './printOperationalView.js'

const PLATFORM_LABELS = {
  windows: 'Windows',
  android: 'Android',
  ios: 'iPhone (iOS)',
  other: 'Outro',
}

const PLATFORM_ICONS = {
  windows: 'windows',
  android: 'android',
  ios: 'apple',
  other: 'system',
}

const copyOptions = [
  { value: '1', label: '1 via' },
  { value: '2', label: '2 vias' },
]

const countLabel = (count, singular, plural) => `${count} ${count === 1 ? singular : plural}`

function PrintingConflictRecovery({ message = 'Há alterações feitas em outro dispositivo para revisar.', onReview, disabled = false }) {
  return <div className="printing-feedback printing-feedback-conflict" role="status">
    <p>{message}</p>
    <Button type="button" variant="secondary" onClick={onReview} disabled={disabled}>Revisar alterações</Button>
  </div>
}

function PrintingSettingsContent({ printing, settings, granted, onReviewConflict }) {
  const policyState = settings?.policyState?.()
  const stationState = settings?.stationState?.()
  const primaryState = settings?.primaryState?.()
  const confirmedStation = stationState?.confirmed?.data || {}
  const station = { ...(printing?.localStation || {}), ...confirmedStation }
  const primaryStationId = primaryState?.draft?.primaryStationId || primaryState?.confirmed?.data?.primaryStationId
  const stationIsPrimary = primaryStationId ? primaryStationId === station.id : Boolean(station.isPrimary)
  const policyDraft = policyState?.draft || policyState?.confirmed?.data || null
  const stationDraft = stationState?.draft || {
    name: station.name || '', platform: station.platform || 'other', autoPrintEnabled: Boolean(station.autoPrintEnabled),
  }
  const [printerSelection, setPrinterSelection] = useState(null)
  const [printerEditing, setPrinterEditing] = useState(() => !printing?.configuredPrinterName)
  const [confirmPrimary, setConfirmPrimary] = useState(false)
  const busyRef = useRef(new Set())
  const [busyKeys, setBusyKeys] = useState(() => new Set())
  const [feedback, setFeedback] = useState('')
  const canEditPolicy = hasCapability(granted, 'printing.settings')
  const canConfigureStation = hasCapability(granted, 'printing.station.configure')
  const canExecutePrinting = hasCapability(granted, 'printing.execute')
  const canViewPolicy = canEditPolicy || hasCapability(granted, 'printing.settings.view')
  const canViewStation = canConfigureStation || hasCapability(granted, 'printing.station.view')
  const isQz = printing?.transportKind === 'qz'

  const run = async (key, action, success) => {
    if (busyRef.current.has(key)) return false
    busyRef.current.add(key)
    setBusyKeys(new Set(busyRef.current))
    setFeedback('')
    try {
      const result = await action()
      if (result && success) setFeedback(success)
      return Boolean(result)
    } catch (error) {
      setFeedback(error?.message || 'Não foi possível concluir esta ação de impressão.')
      return false
    } finally {
      busyRef.current.delete(key)
      setBusyKeys(new Set(busyRef.current))
    }
  }

  const reopenConflict = async (reviewAction) => {
    if (typeof reviewAction !== 'function') return false
    const review = await reviewAction()
    if (!review) return false
    onReviewConflict?.(review)
    return true
  }

  const updatePolicy = (field, value) => {
    const next = { ...(policyDraft || {}), [field]: Number(value) }
    settings?.editPolicy?.(next)
  }

  const updateStation = (patch) => {
    const next = { ...stationDraft, ...patch }
    settings?.editStation?.(next)
  }

  const runtimePlatform = detectPrintStationUiPlatform()
  const uiPlatform = runtimePlatform === 'other' && ['windows', 'android'].includes(station.platform)
    ? station.platform
    : runtimePlatform
  const platformIcon = PLATFORM_ICONS[uiPlatform] || PLATFORM_ICONS.other
  const platformLabel = PLATFORM_LABELS[uiPlatform] || PLATFORM_LABELS.other
  const printerOptions = (printing?.availablePrinters || []).map((name) => ({ value: name, label: name }))
  const selectedPrinter = printerSelection ?? printing?.configuredPrinterName ?? ''
  const jobs = Array.isArray(printing?.jobs) ? printing.jobs : []
  const pendingCount = jobs.filter((job) => job?.status === 'pending').length
  const awaitingConfirmationCount = jobs.filter((job) => job?.status === 'awaiting_confirmation').length
  const waitingCount = pendingCount + awaitingConfirmationCount
  const operationalStatus = derivePrintOperationalStatus({
    stations: printing?.stations,
    localStation: printing?.localStation,
    transportKind: printing?.transportKind,
    printerState: printing?.printerState,
    qzConnected: printing?.qzConnected,
    configuredPrinterName: printing?.configuredPrinterName,
    printerQueueFound: printing?.printerQueueFound,
    printerHealth: printing?.printerHealth,
  })
  const operationalView = buildPrintOperationalView(operationalStatus, {
    pendingCount,
    localPrinterName: printing?.configuredPrinterName,
  })
  const operationalHealthClass = `printing-health is-${operationalView.tone}`
  const localBusy = ['discover', 'printer', 'test'].some((key) => busyKeys.has(key))
  const blockedStatuses = ['loading', 'saving', 'unconfirmed', 'conflict']
  const policyBlocked = !policyDraft || blockedStatuses.includes(policyState?.status)
  const stationBlocked = !station.id || !stationState || blockedStatuses.includes(stationState.status)
  const primaryBlocked = !station.id || !primaryState || blockedStatuses.includes(primaryState.status)
  const printerReady = isQz && printing?.transportReady && printing?.printerHealth?.state === 'ready'

  return <>
    <div className="printing-settings">
      {canViewPolicy && <section className="printing-settings-card" aria-labelledby="printing-policy-title">
        <header className="printing-settings-card-header">
          <span className="printing-settings-card-icon"><Icon name="clipboard" size={21} /></span>
          <div>
            <h2 id="printing-policy-title">Política de impressão do negócio</h2>
            <p>Defina quantas vias devem ser impressas para cada tipo de pedido.</p>
          </div>
        </header>

        {policyDraft ? <div className="printing-settings-card-grid printing-policy-grid">
          <label className="printing-field">
            <span>Pedidos</span>
            <SystemSelect
              value={String(policyDraft.orderDefaultCopies)}
              options={copyOptions}
              onChange={(value) => updatePolicy('orderDefaultCopies', value)}
              label="Vias de pedidos"
              disabled={!canEditPolicy || policyBlocked}
            />
          </label>
          <label className="printing-field">
            <span>Mesas / Comandas</span>
            <SystemSelect
              value={String(policyDraft.tableTabDefaultCopies)}
              options={copyOptions}
              onChange={(value) => updatePolicy('tableTabDefaultCopies', value)}
              label="Vias de mesas e comandas"
              disabled={!canEditPolicy || policyBlocked}
            />
          </label>
        </div> : <p role="status">Carregando política de impressão…</p>}

        <div className="printing-card-notice"><Icon name="details" size={17} /><span>Apenas novas solicitações de impressão. A fila existente mantém suas vias.</span></div>
        {policyState?.status === 'conflict'
          ? <PrintingConflictRecovery onReview={() => reopenConflict(settings?.reviewPolicy)} />
          : policyState?.error && <div className="printing-feedback printing-feedback-error" role="alert"><p>{policyState.error}</p><Button type="button" variant="secondary" onClick={() => policyState.status === 'unconfirmed' ? settings.reconcilePolicy() : settings.reloadPolicy()}>{policyState.status === 'unconfirmed' ? 'Reconsultar' : 'Tentar novamente'}</Button></div>}
        {canEditPolicy && policyState?.dirty && <footer className="printing-settings-footer">
          <Button type="button" variant="secondary" onClick={() => settings?.discardPolicy?.()} disabled={policyBlocked}>Cancelar</Button>
          <Button type="button" state={busyKeys.has('policy') ? 'loading' : 'idle'} loadingLabel="Salvando…" onClick={() => run('policy', () => settings.savePolicy(), 'Política de impressão salva.')} disabled={policyBlocked || busyKeys.has('policy')}>Salvar política</Button>
        </footer>}
      </section>}

      {canViewStation && <section className="printing-settings-card" aria-labelledby="printing-station-title">
        <header className="printing-settings-card-header">
          <span className="printing-settings-card-icon"><Icon name="system" size={22} /></span>
          <div>
            <h2 id="printing-station-title">Estação</h2>
            <p>Informações e comportamento desta estação de trabalho.</p>
          </div>
          {stationIsPrimary && <span className="printing-state printing-state-ready">Principal</span>}
        </header>

        <div className="printing-settings-card-grid">
          <label className="printing-field">
            <span>Nome da estação</span>
            <input
              type="text"
              value={stationDraft.name || ''}
              onChange={(event) => updateStation({ name: event.target.value })}
              disabled={!canConfigureStation || stationBlocked}
              aria-label="Nome da estação"
            />
          </label>
          <div className="printing-field">
            <span>Plataforma</span>
            <div className="printing-platform-value" aria-label={`Plataforma: ${platformLabel}`}>
              <Icon name={platformIcon} size={19} />
              <strong>{platformLabel}</strong>
            </div>
          </div>
        </div>

        <div className="printing-station-controls">
          <label className="printing-switch-row">
            <span><strong>Estação principal</strong><small>{stationIsPrimary ? 'Esta estação recebe e processa a fila automática.' : 'Defina esta estação como responsável pela impressão automática.'}</small></span>
            <input
              type="checkbox"
              role="switch"
              checked={stationIsPrimary}
              disabled={!canConfigureStation || stationIsPrimary || primaryBlocked}
              onChange={(event) => { if (event.target.checked) setConfirmPrimary(true) }}
            />
          </label>
          {isQz && <label className="printing-switch-row">
            <span><strong>Impressão automática</strong><small>{stationIsPrimary ? 'Imprime novos pedidos automaticamente ao receber.' : 'Disponível somente na estação principal.'}</small></span>
            <input
              type="checkbox"
              role="switch"
              checked={Boolean(stationDraft.autoPrintEnabled)}
              onChange={(event) => updateStation({ autoPrintEnabled: event.target.checked })}
              disabled={!canConfigureStation || stationBlocked || !stationIsPrimary}
            />
          </label>}
        </div>

        {stationState?.status === 'conflict'
          ? <PrintingConflictRecovery onReview={() => reopenConflict(settings?.reviewStation)} />
          : stationState?.error && <div className="printing-feedback printing-feedback-error" role="alert"><p>{stationState.error}</p><Button type="button" variant="secondary" onClick={() => stationState.status === 'unconfirmed' ? settings.reconcileStation() : settings.reloadStation()}>{stationState.status === 'unconfirmed' ? 'Reconsultar' : 'Tentar novamente'}</Button></div>}
        {primaryState?.status === 'conflict' && <PrintingConflictRecovery
          message="A definição de estação principal foi alterada em outro dispositivo e precisa ser revisada."
          onReview={() => reopenConflict(settings?.reviewPrimary)}
        />}
        {canConfigureStation && stationState?.dirty && <footer className="printing-settings-footer">
          <Button type="button" variant="secondary" onClick={() => settings?.discardStation?.()} disabled={stationBlocked}>Cancelar</Button>
          <Button type="button" state={busyKeys.has('station') ? 'loading' : 'idle'} loadingLabel="Salvando…" onClick={() => run('station', () => settings.saveStation(), 'Estação salva.')} disabled={stationBlocked || busyKeys.has('station')}>Salvar estação</Button>
        </footer>}
      </section>}

      {canViewStation && <section className="printing-settings-card printing-local-card" aria-labelledby="printing-local-title">
        <header className="printing-settings-card-header">
          <span className="printing-settings-card-icon"><Icon name="printer" size={22} /></span>
          <div>
            <h2 id="printing-local-title">{isQz ? 'Impressão nesta estação' : 'Impressão do negócio'}</h2>
            <p>{isQz ? 'Configure e acompanhe a impressão física deste computador via QZ Tray.' : 'Acompanhe a estação responsável pela impressão do negócio.'}</p>
          </div>
          {waitingCount > 0 && <span className="printing-queue-pill"><Icon name="clipboard" size={15} />{countLabel(waitingCount, 'trabalho aguardando', 'trabalhos aguardando')}</span>}
        </header>

        <div className="printing-local-layout">
          <div className="printing-local-summary">
            <div className="printing-local-row">
              <span>Status da impressão</span>
              <strong className={operationalHealthClass}><span aria-hidden="true">●</span>{operationalView.title}</strong>
            </div>
            {operationalView.description && <p className="printing-operational-description">{operationalView.description}</p>}
            {isQz ? <div className="printing-local-row">
              <span>Impressora configurada</span>
              <strong>{printing?.configuredPrinterName || 'Nenhuma impressora configurada'}</strong>
            </div> : <div className="printing-local-row">
              <span>Estação responsável</span>
              <strong>{operationalView.primaryStationName || 'Nenhuma estação principal configurada'}</strong>
            </div>}
            {!isQz && <p className="printing-central-note">Esta estação acompanha a fila central e não realiza impressão física.</p>}
            {pendingCount > 0 && <p className="printing-queue-detail">{countLabel(pendingCount, 'trabalho aguardando impressão', 'trabalhos aguardando impressão')}.</p>}
            {awaitingConfirmationCount > 0 && <p className="printing-queue-detail">{countLabel(awaitingConfirmationCount, 'via enviada aguardando confirmação', 'vias enviadas aguardando confirmação')}.</p>}
          </div>

          {isQz && (canConfigureStation || canExecutePrinting) && <div className="printing-local-actions">
            {canExecutePrinting && <Button type="button" variant="secondary" icon="printer" state={busyKeys.has('test') ? 'loading' : 'idle'} loadingLabel="Enviando…" onClick={() => run('test', () => settings.testPrint(), 'Teste enviado com 1 via.')} disabled={localBusy || !printerReady}>Testar impressão</Button>}
            {canConfigureStation && <Button type="button" variant="secondary" onClick={() => setPrinterEditing((current) => !current)} disabled={localBusy}>{printerEditing ? 'Fechar seleção' : 'Trocar impressora'}</Button>}
          </div>}
        </div>

        {isQz && canConfigureStation && printerEditing && <div className="printing-printer-editor">
          <SystemSelect value={selectedPrinter} onChange={setPrinterSelection} options={printerOptions} placeholder="Selecione a impressora" label="Impressora QZ" disabled={localBusy} />
          <div className="printing-actions-row">
            <Button type="button" variant="secondary" state={busyKeys.has('discover') ? 'loading' : 'idle'} loadingLabel="Atualizando…" onClick={() => run('discover', () => settings.refreshPrinters())} disabled={localBusy}>Atualizar lista</Button>
            <Button type="button" state={busyKeys.has('printer') ? 'loading' : 'idle'} loadingLabel="Salvando…" onClick={async () => { const saved = await run('printer', () => settings.savePrinter(selectedPrinter), 'Impressora local salva.'); if (saved) setPrinterEditing(false) }} disabled={localBusy || !selectedPrinter}>Salvar impressora</Button>
          </div>
        </div>}

        {printing?.lastError?.message && <p className="printing-feedback printing-feedback-error" role="alert">{printing.lastError.message}</p>}
      </section>}

      {feedback && <p className="printing-feedback printing-global-feedback" role="status">{feedback}</p>}
    </div>

    {confirmPrimary && <ConfirmationDialog submitting={busyKeys.has('primary')} loadingLabel="Confirmando…" title="Tornar estação principal" message="Esta estação passará a ser a única responsável pela impressão automática. Confirme para continuar." confirmLabel="Tornar principal" confirmVariant="primary" onClose={() => setConfirmPrimary(false)} onConfirm={async () => { const saved = await run('primary', () => settings.makePrimary(), 'Esta estação agora é a principal.'); if (saved) setConfirmPrimary(false) }} disabled={primaryBlocked || busyKeys.has('primary')} />}
  </>
}

export default PrintingSettingsContent