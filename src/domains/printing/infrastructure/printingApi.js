import { apiRequest, apiTextRequest, withJson } from '../../../infrastructure/api/httpClient.js'

export const createPrintingApi = ({ request = apiRequest, text = apiTextRequest } = {}) => {
const getTableTabPrintDocument = (id) => request(`/api/table-tabs/${encodeURIComponent(id)}/print-document`)
const createManualTableTabPrintJob = (id, copies) => request(`/api/table-tabs/${encodeURIComponent(id)}/print-jobs`, withJson('POST', { copies }))


const getPrintSettings = () => request('/api/printing/settings')
const savePrintSettings = (settings) => request('/api/printing/settings', withJson('PUT', settings))
const getPrintStations = () => request('/api/printing/stations')
const getPrintState = () => request('/api/printing/state')
const upsertPrintStation = (id, station) => request(`/api/printing/stations/${encodeURIComponent(id)}`, withJson('PUT', station))
const heartbeatPrintStation = (id, health = {}) => request(
  `/api/printing/stations/${encodeURIComponent(id)}/heartbeat`,
  withJson('POST', {
    qzReady: Boolean(health.qzReady),
    printerReady: Boolean(health.printerReady),
    ...(health.physicalState ? { physicalState: health.physicalState } : {}),
    ...(health.physicalStatusText ? { physicalStatusText: health.physicalStatusText } : {}),
    ...(health.physicalStatusCode != null ? { physicalStatusCode: health.physicalStatusCode } : {}),
  }),
)
const makePrimaryPrintStation = (id) => request(`/api/printing/stations/${encodeURIComponent(id)}/make-primary`, { method: 'POST' })
const getPrintJobs = (options = {}, requestOptions = {}) => {
  const params = new URLSearchParams()
  for (const key of ['orderId', 'limit', 'scope', 'page', 'pageSize', 'sortBy', 'sortDir', 'status', 'trigger', 'search']) {
    if (options[key] != null && String(options[key]).trim() !== '') params.set(key, String(options[key]))
  }
  return request(`/api/printing/jobs${params.size ? `?${params}` : ''}`, requestOptions)
}
const getPrintQueueSummary = (requestOptions = {}) => request('/api/printing/jobs/summary', requestOptions)
const createPrintAttempt = (jobId, stationId, copyNumber) => request(
  `/api/printing/jobs/${encodeURIComponent(jobId)}/attempts`, withJson('POST', { stationId, copyNumber }),
)
const markPrintAttemptSubmitting = (attemptId, stationId) => request(
  `/api/printing/attempts/${encodeURIComponent(attemptId)}/submitting`, withJson('POST', { stationId }),
)
const recordPrintAttemptEvent = (attemptId, stationId, event) => request(
  `/api/printing/attempts/${encodeURIComponent(attemptId)}/events`, withJson('POST', { stationId, event }),
)
const resolvePrintOutcome = (jobId, attemptId, resolution, actorLabel = 'Operador') => request(
  `/api/printing/jobs/${encodeURIComponent(jobId)}/resolve-outcome`,
  withJson('POST', { ...(attemptId ? { attemptId } : {}), resolution, actorLabel }),
)
const setPrintStationRecovery = (stationId, state) => request(
  `/api/printing/stations/${encodeURIComponent(stationId)}/recovery`, withJson('POST', { state }),
)
const claimNextRecoveryPrintJob = (stationId) => request('/api/printing/jobs/claim-recovery-next', withJson('POST', { stationId }))
const discardPendingPrintJobs = (actorLabel = 'Sistema') => request('/api/printing/jobs/discard-pending', withJson('POST', { actorLabel }))
const discardOperationalPrintJobs = (actorLabel = 'Operador') => request('/api/printing/jobs/discard-operational', withJson('POST', { actorLabel }))
const createManualPrintJob = (orderId, copies) => request(`/api/orders/${encodeURIComponent(orderId)}/print-jobs`, withJson('POST', { copies }))
const createTestPrintJob = (stationId) => request('/api/printing/test-jobs', withJson('POST', { stationId }))
const claimNextPrintJob = (stationId) => request('/api/printing/jobs/claim-next', withJson('POST', { stationId }))
const claimPrintJob = (jobId, stationId) => request(`/api/printing/jobs/${encodeURIComponent(jobId)}/claim`, withJson('POST', { stationId }))
const acknowledgeSecondCopyPrompt = (jobId, stationId) => request(`/api/printing/jobs/${encodeURIComponent(jobId)}/second-copy-prompt`, withJson('POST', { stationId }))
const requestSecondCopy = (jobId, actorLabel = 'Sistema') => request(`/api/printing/jobs/${encodeURIComponent(jobId)}/request-second-copy`, withJson('POST', { actorLabel }))
const skipSecondCopy = (jobId, actorLabel = 'Sistema') => request(`/api/printing/jobs/${encodeURIComponent(jobId)}/skip-second-copy`, withJson('POST', { actorLabel }))
const completePrintJob = (jobId, stationId, copiesPrinted) => request(`/api/printing/jobs/${encodeURIComponent(jobId)}/complete`, withJson('POST', { stationId, copiesPrinted }))
const failPrintJob = (jobId, stationId, failure) => request(`/api/printing/jobs/${encodeURIComponent(jobId)}/fail`, withJson('POST', { stationId, ...failure }))
const retryPrintJob = (jobId, stationId) => request(`/api/printing/jobs/${encodeURIComponent(jobId)}/retry`, withJson('POST', { stationId }))
const discardPrintJob = (jobId, actorLabel = 'Sistema') => request(`/api/printing/jobs/${encodeURIComponent(jobId)}/discard`, withJson('POST', { actorLabel }))
const prioritizePrintJob = (jobId) => request(`/api/printing/jobs/${encodeURIComponent(jobId)}/prioritize`, { method: 'POST' })
const forcePrintJob = (jobId, actorLabel = 'Sistema') => request(`/api/printing/jobs/${encodeURIComponent(jobId)}/force-print`, withJson('POST', { actorLabel }))
const reprintPrintJob = (jobId, copies) => request(`/api/printing/jobs/${encodeURIComponent(jobId)}/reprint`, withJson('POST', { copies }))
const getOrderPrintDocument = (orderId) => request(`/api/orders/${encodeURIComponent(orderId)}/print-document`)
const getQzCertificate = () => text('/api/printing/qz/certificate')
const signQzPayload = (toSign, payload) => text('/api/printing/qz/sign', withJson('POST', { toSign, ...(payload === undefined ? {} : { payload }) }))

return Object.freeze({ getTableTabPrintDocument, createManualTableTabPrintJob, getPrintSettings, savePrintSettings, getPrintStations, getPrintState, upsertPrintStation, heartbeatPrintStation, makePrimaryPrintStation, getPrintJobs, getPrintQueueSummary, createPrintAttempt, markPrintAttemptSubmitting, recordPrintAttemptEvent, resolvePrintOutcome, setPrintStationRecovery, claimNextRecoveryPrintJob, discardPendingPrintJobs, discardOperationalPrintJobs, createManualPrintJob, createTestPrintJob, claimNextPrintJob, claimPrintJob, acknowledgeSecondCopyPrompt, requestSecondCopy, skipSecondCopy, completePrintJob, failPrintJob, retryPrintJob, discardPrintJob, prioritizePrintJob, forcePrintJob, reprintPrintJob, getOrderPrintDocument, getQzCertificate, signQzPayload })
}
export const { getTableTabPrintDocument, createManualTableTabPrintJob, getPrintSettings, savePrintSettings, getPrintStations, getPrintState, upsertPrintStation, heartbeatPrintStation, makePrimaryPrintStation, getPrintJobs, getPrintQueueSummary, createPrintAttempt, markPrintAttemptSubmitting, recordPrintAttemptEvent, resolvePrintOutcome, setPrintStationRecovery, claimNextRecoveryPrintJob, discardPendingPrintJobs, discardOperationalPrintJobs, createManualPrintJob, createTestPrintJob, claimNextPrintJob, claimPrintJob, acknowledgeSecondCopyPrompt, requestSecondCopy, skipSecondCopy, completePrintJob, failPrintJob, retryPrintJob, discardPrintJob, prioritizePrintJob, forcePrintJob, reprintPrintJob, getOrderPrintDocument, getQzCertificate, signQzPayload } = createPrintingApi()
