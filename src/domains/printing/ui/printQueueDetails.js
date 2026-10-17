import { formatOrderCustomerIdentity } from '../../../../shared/orderPrintDocument.js'
import { formatOrderDisplayNumber } from '../../../../shared/orderDisplayNumber.js'
import { getPrintQueueLabel, resolvePrintQueueState } from '../../../../shared/printQueue.js'
import { getPrintJobActions } from '../../../../shared/printQueueActions.js'

const presentText = (value) => {
  const text = String(value ?? '').trim()
  return text || null
}

const presentNumber = (value) => {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const formatDateTime = (value) => {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return presentText(value)
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

const getIdentity = (document) => formatOrderCustomerIdentity({
  tableIdentifier: document?.tableTab?.tableName || document?.tableIdentifier || document?.order?.tableIdentifier || document?.table?.identifier,
  customerName: document?.customer?.name,
})

export const getPrintJobDetails = (job, { order, stations = [], stationReady = true } = {}) => {
  const state = resolvePrintQueueState(job?.queueState || job?.status, { stationReady })
  const station = stations.find((candidate) => String(candidate?.id) === String(job?.stationId))
  const times = Object.fromEntries([
    ['created', ['Criado', job?.createdAt]],
    ['available', ['Disponível', job?.availableAt]],
    ['processingStarted', ['Início da impressão', job?.processingStartedAt]],
    ['processed', ['Concluído', job?.processedAt]],
    ['discarded', ['Descartado', job?.discardedAt]],
  ].filter(([, [, value]]) => value).map(([key, [label, value]]) => [key, { label, value: formatDateTime(value) }]))

  const error = job?.lastError && (presentText(job.lastError.code) || presentText(job.lastError.message))
    ? { code: presentText(job.lastError.code), message: presentText(job.lastError.message) }
    : null
  const unknownOutcome = error?.code === 'PRINT_OUTCOME_UNKNOWN'
    ? {
        title: 'Não foi possível confirmar esta impressão',
        message: 'Esta via pode ter sido impressa antes de a conexão ser interrompida.',
        duplicateRisk: 'Reenviar pode gerar uma impressão duplicada.',
      }
    : null

  return {
    title: job?.type === 'table-tab' && job?.document?.tableTab?.number
      ? `Comanda #${job.document.tableTab.number}`
      : formatOrderDisplayNumber(order || {orderNumber:job?.document?.order?.number}),
    identity: getIdentity(job?.document),
    status: getPrintQueueLabel(state),
    origin: job?.trigger === 'automatic' ? 'Automático' : ['manual', 'reprint'].includes(job?.trigger) ? 'Manual/Reimpressão' : null,
    copies: presentNumber(job?.copiesRequested) !== null ? `${presentNumber(job?.copiesPrinted) || 0}/${presentNumber(job.copiesRequested)}` : null,
    priority: presentNumber(job?.priority) === 1 ? 'Imprimir agora' : presentNumber(job?.priority) !== null ? 'Normal' : null,
    station: presentText(station?.name),
    times,
    attentionReason: state === 'attention' ? presentText(job?.attentionReason) : null,
    error,
    unknownOutcome,
    secondCopySkipped: job?.secondCopySkippedAt ? {
      label: '2ª via',
      message: 'Não impressa por decisão do operador',
      at: formatDateTime(job.secondCopySkippedAt),
    } : null,
    reprintOf: presentText(job?.parentJobId) ? 'Reimpressão de trabalho anterior' : null,
    requestedBy: actorLabel(job?.attribution?.requestedBy),
    audit: {
      action: 'Última ação registrada',
      at: formatDateTime(job?.actionAt),
      actor: actorLabel(job?.attribution?.lastActionBy),
    },
    actions: getPrintJobActions(job, { order }),
  }
}
import { actorLabel } from '../../../shared/actorLabel.js'
