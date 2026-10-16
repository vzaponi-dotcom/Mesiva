import { apiError, assertSameOriginMutation, json, readJson } from './http.js'
import { loadOrderPrintDocument } from './orderPrintDocumentRepository.js'
import { claimNextPrintJob } from './orderPrintingCentralClaim.js'
import {
  acknowledgeSecondCopyPrompt,
  claimPrintJob,
  createManualOrderPrintJob,
  createTestPrintJob,
  discardPrintJob,
  forcePrintJob,
  getPrintQueueSummary,
  heartbeatPrintStation,
  listPrintJobs,
  listPrintStations,
  loadPrintJob,
  markPrintJobFailed,
  markPrintJobPrinted,
  prioritizePrintJob,
  reprintPrintJob,
  retryPrintJob,
  requestSecondCopy,
  setPrintRecoveryState,
  upsertPrintStation,
  skipSecondCopy,
  claimNextRecoveryPrintJob,
  discardPendingPrintJobs,
  discardOperationalPrintJobs,
} from './orderPrintingRepository.js'
import {
  createPrintJobAttempt,
  markPrintAttemptSubmitting,
  recordPrintAttemptEvent,
  resolveUnknownPrintAttempt,
} from './printAttemptRepository.js'
import { getConfiguredQzCertificate, signQzPayload } from './qzSigning.js'
import {
  loadPrintingPolicy,
  loadStationPrimary,
  savePrintingPolicy,
  saveStationConfiguration,
  saveStationPrimary,
} from './printSettingsRepository.js'
import { requireCapability } from './settingsAccess.js'
import { printingActor, projectPrintingPayload, requirePrintJobRead, requireCompanyQzRequest } from './access/printingAuthorization.js'

const requiredText = (value, field, message = `${field} é obrigatório.`) => {
  const text = String(value ?? '').trim()
  if (!text) throw apiError(400, 'VALIDATION_ERROR', message)
  return text
}

const printCopies = (value, field = 'copies') => {
  if (!Number.isInteger(value) || ![1, 2].includes(value)) throw apiError(400, 'INVALID_PRINT_COPIES', `${field} deve ser 1 ou 2.`)
  return value
}

const optionalPrintCopies = (value) => value === undefined ? undefined : printCopies(value)

const stationPlatform = (value) => {
  if (!['windows', 'android', 'other'].includes(value)) {
    throw apiError(400, 'INVALID_PRINT_PLATFORM', 'Plataforma de impressão inválida.')
  }
  return value
}

const stationIdFromBody = (body) => requiredText(body.stationId, 'stationId', 'Identificador da estação é obrigatório.')

export const handlePrintingApi = async (request, env, context, url) => {
  const businessId = context.businessId
  const actor = printingActor(context)
  const printingJson = async (payload, init) => json(await projectPrintingPayload(env.DB, context, payload), init)
  if (url.pathname === '/api/printing/jobs' || url.pathname === '/api/printing/jobs/summary') {
    if (request.method === 'GET') requireCapability(context, 'printing.queue')
  }
  if ((request.method === 'GET' && (url.pathname === '/api/printing/qz/certificate' || /^\/api\/orders\/[^/]+\/print-document$/.test(url.pathname))) ||
    (request.method === 'POST' && (
      ['/api/printing/qz/sign', '/api/printing/test-jobs', '/api/printing/jobs/claim-next', '/api/printing/jobs/claim-recovery-next'].includes(url.pathname) ||
      /^\/api\/orders\/[^/]+\/print-jobs$/.test(url.pathname) ||
      /^\/api\/printing\/stations\/[^/]+\/(heartbeat|recovery)$/.test(url.pathname) ||
      /^\/api\/printing\/jobs\/[^/]+\/(claim|complete|fail|retry|attempts|resolve-outcome|second-copy-prompt|request-second-copy|skip-second-copy|reprint)$/.test(url.pathname) ||
      /^\/api\/printing\/attempts\/[^/]+\/(submitting|events)$/.test(url.pathname)
    ))) requireCapability(context, 'printing.execute')
  if (request.method === 'POST' && (/^\/api\/printing\/jobs\/[^/]+\/discard$/.test(url.pathname) ||
    ['/api/printing/jobs/discard-pending', '/api/printing/jobs/discard-operational'].includes(url.pathname))) requireCapability(context, 'printing.discard')
  if (request.method === 'POST' && /^\/api\/printing\/jobs\/[^/]+\/(prioritize|force-print)$/.test(url.pathname)) requireCapability(context, 'printing.force')

  if (url.pathname === '/api/printing/settings') {
    if (request.method === 'GET') {
      requireCapability(context, 'printing.settings.view')
      const settings = await loadPrintingPolicy(env.DB, businessId)
      return printingJson({ settings: { ...settings, defaultCopies: settings.data.orderDefaultCopies } })
    }
    if (request.method === 'PUT') {
      requireCapability(context, 'printing.settings')
      assertSameOriginMutation(request)
      const body = await readJson(request)
      if (!Object.hasOwn(body, 'expectedRevision') || !Object.hasOwn(body, 'mutationId')) {
        throw apiError(400, 'SETTINGS_CLIENT_UPDATE_REQUIRED', 'Atualize o cliente para salvar configurações com revisão.')
      }
      const saved = await savePrintingPolicy(env.DB, businessId, body)
      return printingJson({ settings: { ...saved.resource, defaultCopies: saved.resource.data.orderDefaultCopies }, receipt: saved.receipt })
    }
  }

  if (url.pathname === '/api/printing/qz/certificate' && request.method === 'GET') {
    return new Response(getConfiguredQzCertificate(env), {
      headers: {
        'content-type': 'text/plain; charset=UTF-8',
        'cache-control': 'no-store',
      },
    })
  }

  if (url.pathname === '/api/printing/qz/sign' && request.method === 'POST') {
    assertSameOriginMutation(request)
    const body = await readJson(request), { toSign } = body
    if (context.accountId) await requireCompanyQzRequest(env.DB, context, body)
    return new Response(await signQzPayload(env, toSign), {
      headers: {
        'content-type': 'text/plain; charset=UTF-8',
        'cache-control': 'no-store',
      },
    })
  }

  if (url.pathname === '/api/printing/stations' && request.method === 'GET') {
    requireCapability(context, 'printing.station.view')
    const [stations, primary] = await Promise.all([
      listPrintStations(env.DB, businessId),
      loadStationPrimary(env.DB, businessId),
    ])
    return printingJson({ stations, primary })
  }

  const heartbeatMatch = url.pathname.match(/^\/api\/printing\/stations\/([^/]+)\/heartbeat$/)
  if (heartbeatMatch && request.method === 'POST') {
    assertSameOriginMutation(request)
    const body = await readJson(request)
    const keys = Object.keys(body).sort()
    if (keys.some((key) => !['physicalState', 'physicalStatusCode', 'physicalStatusText', 'printerReady', 'qzReady'].includes(key))) {
      throw apiError(400, 'INVALID_PRINT_STATION_HEALTH', 'Informe somente os campos aprovados de saúde da impressora.')
    }
    const station = await heartbeatPrintStation(
      env.DB,
      businessId,
      decodeURIComponent(heartbeatMatch[1]),
      {
        qzReady: Boolean(body.qzReady),
        printerReady: Boolean(body.printerReady) && body.physicalState === 'ready',
        ...(Object.hasOwn(body, 'physicalState') ? { physicalState: body.physicalState } : {}),
        ...(Object.hasOwn(body, 'physicalStatusText') ? { physicalStatusText: body.physicalStatusText } : {}),
        ...(Object.hasOwn(body, 'physicalStatusCode') ? { physicalStatusCode: body.physicalStatusCode } : {}),
      },
    )
    return printingJson({ station })
  }

  const stationMatch = url.pathname.match(/^\/api\/printing\/stations\/([^/]+)$/)
  if (stationMatch && request.method === 'PUT') {
    requireCapability(context, 'printing.station.configure')
    assertSameOriginMutation(request)
    const body = await readJson(request)
    const stationId = decodeURIComponent(stationMatch[1])
    if (Object.hasOwn(body, 'expectedRevision') || Object.hasOwn(body, 'mutationId') || Object.hasOwn(body, 'data')) {
      if (!Object.hasOwn(body, 'expectedRevision') || !Object.hasOwn(body, 'mutationId')) {
        throw apiError(400, 'SETTINGS_CLIENT_UPDATE_REQUIRED', 'Atualize o cliente para salvar a estação com revisão.')
      }
      const saved = await saveStationConfiguration(env.DB, businessId, stationId, body)
      return printingJson({ station: saved.resource, receipt: saved.receipt })
    }
    if (Object.keys(body).some((key) => !['name', 'platform', 'autoPrintEnabled', 'defaultCopies'].includes(key))) {
      throw apiError(400, 'INVALID_PRINT_STATION', 'Informe somente os campos de registro da estação.')
    }
    const existing = (await listPrintStations(env.DB, businessId)).find(({ id }) => id === stationId)
    if (existing) {
      throw apiError(400, 'SETTINGS_CLIENT_UPDATE_REQUIRED', 'Atualize o cliente para salvar a estação com revisão.')
    }
    const station = await upsertPrintStation(env.DB, businessId, {
      id: stationId,
      name: requiredText(body.name, 'name', 'Nome da estação é obrigatório.'),
      platform: stationPlatform(body.platform),
      autoPrintEnabled: Boolean(body.autoPrintEnabled),
      defaultCopies: printCopies(body.defaultCopies, 'defaultCopies'),
    })
    return printingJson({ station })
  }

  const primaryMatch = url.pathname.match(/^\/api\/printing\/stations\/([^/]+)\/make-primary$/)
  if (primaryMatch && request.method === 'POST') {
    requireCapability(context, 'printing.station.configure')
    assertSameOriginMutation(request)
    const body = await readJson(request)
    if (!Object.hasOwn(body, 'expectedRevision') || !Object.hasOwn(body, 'mutationId')) {
      throw apiError(400, 'SETTINGS_CLIENT_UPDATE_REQUIRED', 'Atualize o cliente para eleger a estação principal com revisão.')
    }
    if (Object.keys(body).some((key) => !['expectedRevision', 'mutationId', 'data'].includes(key)) ||
        (Object.hasOwn(body, 'data') && (body.data?.primaryStationId !== decodeURIComponent(primaryMatch[1]) || Object.keys(body.data).length !== 1))) {
      throw apiError(400, 'SETTINGS_INVALID', 'A eleição deve usar somente a estação indicada na rota.')
    }
    const saved = await saveStationPrimary(env.DB, businessId, {
      expectedRevision: body.expectedRevision,
      mutationId: body.mutationId,
      data: { primaryStationId: decodeURIComponent(primaryMatch[1]) },
    })
    return printingJson({ station: saved.resource, receipt: saved.receipt })
  }

  if (url.pathname === '/api/printing/state' && request.method === 'GET') {
    requireCapability(context, 'printing.queue')
    requireCapability(context, 'printing.station.view')
    const { jobs } = await listPrintJobs(env.DB, businessId, { scope: 'operational' })
    const [stations, summary] = await Promise.all([
      listPrintStations(env.DB, businessId), getPrintQueueSummary(env.DB, businessId),
    ])
    return printingJson({ stations, jobs, summary })
  }

  if (url.pathname === '/api/printing/jobs' && request.method === 'GET') {
    const orderId = url.searchParams.get('orderId') || ''
    if (orderId) {
      const limit = Number(url.searchParams.get('limit') || 100)
      const jobs = await listPrintJobs(env.DB, businessId, { orderId, limit })
      return printingJson({ jobs, pageInfo: { page: 1, pageSize: jobs.length, totalItems: jobs.length, totalPages: 1 } })
    }
    return printingJson(await listPrintJobs(env.DB, businessId, {
      scope: url.searchParams.get('scope') || 'operational',
      page: url.searchParams.get('page'),
      pageSize: url.searchParams.get('pageSize'),
      sortBy: url.searchParams.get('sortBy') || '',
      sortDir: url.searchParams.get('sortDir') || '',
      status: url.searchParams.get('status') || '',
      trigger: url.searchParams.get('trigger') || '',
      search: url.searchParams.get('search') || '',
    }))
  }

  if (url.pathname === '/api/printing/jobs/summary' && request.method === 'GET') {
    return printingJson({ summary: await getPrintQueueSummary(env.DB, businessId) })
  }

  const manualOrderMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/print-jobs$/)
  if (manualOrderMatch && request.method === 'POST') {
    assertSameOriginMutation(request)
    const body = await readJson(request)
    const orderId = decodeURIComponent(manualOrderMatch[1])
    await requirePrintJobRead(env.DB, context, { type: 'order', orderId })
    const document = await loadOrderPrintDocument(env.DB, businessId, orderId)
    if (!document) throw apiError(404, 'ORDER_NOT_FOUND', 'Pedido não encontrado.')
    const job = await createManualOrderPrintJob(env.DB, businessId, {
      orderId,
      copies: optionalPrintCopies(body.copies),
      document,
      actorLabel: actor.displayName,
    })
    return printingJson({ job }, { status: 201 })
  }

  if (url.pathname === '/api/printing/test-jobs' && request.method === 'POST') {
    assertSameOriginMutation(request)
    const body = await readJson(request)
    const stationId = stationIdFromBody(body)
    const business = await env.DB.prepare('SELECT name FROM businesses WHERE id = ? LIMIT 1').bind(businessId).first()
    const job = await createTestPrintJob(env.DB, businessId, {
      stationId,
      businessName: business?.name || 'Estabelecimento',
      actorLabel: actor.displayName,
    })
    return printingJson({ job }, { status: 201 })
  }

  if (url.pathname === '/api/printing/jobs/claim-next' && request.method === 'POST') {
    assertSameOriginMutation(request)
    const body = await readJson(request)
    const job = await claimNextPrintJob(env.DB, businessId, stationIdFromBody(body), new Date(), context.granted)
    return printingJson({ job })
  }

  if (url.pathname === '/api/printing/jobs/claim-recovery-next' && request.method === 'POST') {
    assertSameOriginMutation(request)
    const body = await readJson(request)
    return printingJson({ job: await claimNextRecoveryPrintJob(env.DB, businessId, stationIdFromBody(body), new Date(), context.granted) })
  }

  if (url.pathname === '/api/printing/jobs/discard-pending' && request.method === 'POST') {
    assertSameOriginMutation(request)
    await readJson(request)
    return printingJson({ jobs: await discardPendingPrintJobs(env.DB, businessId, actor.displayName) })
  }

  if (url.pathname === '/api/printing/jobs/discard-operational' && request.method === 'POST') {
    requireCapability(context, 'printing.discard')
    assertSameOriginMutation(request)
    await readJson(request)
    return printingJson(await discardOperationalPrintJobs(env.DB, businessId, actor.displayName))
  }

  const recoveryMatch = url.pathname.match(/^\/api\/printing\/stations\/([^/]+)\/recovery$/)
  if (recoveryMatch && request.method === 'POST') {
    assertSameOriginMutation(request)
    const body = await readJson(request)
    return printingJson({ station: await setPrintRecoveryState(env.DB, businessId, decodeURIComponent(recoveryMatch[1]), body.state) })
  }

  const createAttemptMatch = url.pathname.match(/^\/api\/printing\/jobs\/([^/]+)\/attempts$/)
  if (createAttemptMatch && request.method === 'POST') {
    assertSameOriginMutation(request)
    const body = await readJson(request)
    const attempt = await createPrintJobAttempt(env.DB, businessId, {
      jobId: decodeURIComponent(createAttemptMatch[1]), stationId: stationIdFromBody(body), copyNumber: Number(body.copyNumber),
    })
    return printingJson({ attempt }, { status: 201 })
  }

  const submittingAttemptMatch = url.pathname.match(/^\/api\/printing\/attempts\/([^/]+)\/submitting$/)
  if (submittingAttemptMatch && request.method === 'POST') {
    assertSameOriginMutation(request)
    const body = await readJson(request)
    return printingJson({ attempt: await markPrintAttemptSubmitting(env.DB, businessId, decodeURIComponent(submittingAttemptMatch[1]), stationIdFromBody(body)) })
  }

  const eventAttemptMatch = url.pathname.match(/^\/api\/printing\/attempts\/([^/]+)\/events$/)
  if (eventAttemptMatch && request.method === 'POST') {
    assertSameOriginMutation(request)
    const body = await readJson(request)
    return printingJson({ attempt: await recordPrintAttemptEvent(env.DB, businessId, decodeURIComponent(eventAttemptMatch[1]), stationIdFromBody(body), body.event) })
  }

  const resolveOutcomeMatch = url.pathname.match(/^\/api\/printing\/jobs\/([^/]+)\/resolve-outcome$/)
  if (resolveOutcomeMatch && request.method === 'POST') {
    assertSameOriginMutation(request)
    const body = await readJson(request)
    const jobId = decodeURIComponent(resolveOutcomeMatch[1])
    const attempt = await resolveUnknownPrintAttempt(
      env.DB, businessId, jobId, body.attemptId ?? null, body.resolution, actor.displayName,
    )
    return printingJson({ attempt, job: await loadPrintJob(env.DB, businessId, jobId) })
  }

  const secondCopyPromptMatch = url.pathname.match(/^\/api\/printing\/jobs\/([^/]+)\/second-copy-prompt$/)
  if (secondCopyPromptMatch && request.method === 'POST') {
    assertSameOriginMutation(request)
    const body = await readJson(request)
    return printingJson(await acknowledgeSecondCopyPrompt(env.DB, businessId, decodeURIComponent(secondCopyPromptMatch[1]), stationIdFromBody(body)))
  }

  const requestSecondCopyMatch = url.pathname.match(/^\/api\/printing\/jobs\/([^/]+)\/request-second-copy$/)
  if (requestSecondCopyMatch && request.method === 'POST') {
    assertSameOriginMutation(request)
    await readJson(request)
    return printingJson({ job: await requestSecondCopy(env.DB, businessId, decodeURIComponent(requestSecondCopyMatch[1]), actor.displayName) })
  }
  const skipSecondCopyMatch = url.pathname.match(/^\/api\/printing\/jobs\/([^/]+)\/skip-second-copy$/)
  if (skipSecondCopyMatch && request.method === 'POST') {
    assertSameOriginMutation(request)
    await readJson(request)
    return printingJson({ job: await skipSecondCopy(env.DB, businessId, decodeURIComponent(skipSecondCopyMatch[1]), actor.displayName) })
  }

  const discardMatch = url.pathname.match(/^\/api\/printing\/jobs\/([^/]+)\/discard$/)
  if (discardMatch && request.method === 'POST') {
    assertSameOriginMutation(request)
    await readJson(request)
    const actorLabel = actor.displayName
    const job = await discardPrintJob(env.DB, businessId, decodeURIComponent(discardMatch[1]), actorLabel)
    return printingJson({ job })
  }

  const prioritizeMatch = url.pathname.match(/^\/api\/printing\/jobs\/([^/]+)\/prioritize$/)
  if (prioritizeMatch && request.method === 'POST') {
    assertSameOriginMutation(request)
    const job = await prioritizePrintJob(env.DB, businessId, decodeURIComponent(prioritizeMatch[1]), new Date(), actor.displayName)
    return printingJson({ job })
  }

  const forcePrintMatch = url.pathname.match(/^\/api\/printing\/jobs\/([^/]+)\/force-print$/)
  if (forcePrintMatch && request.method === 'POST') {
    assertSameOriginMutation(request)
    await readJson(request)
    const actorLabel = actor.displayName
    const job = await forcePrintJob(env.DB, businessId, decodeURIComponent(forcePrintMatch[1]), actorLabel)
    return printingJson({ job })
  }

  const reprintMatch = url.pathname.match(/^\/api\/printing\/jobs\/([^/]+)\/reprint$/)
  if (reprintMatch && request.method === 'POST') {
    assertSameOriginMutation(request)
    const body = await readJson(request)
    const jobId = decodeURIComponent(reprintMatch[1])
    const original = await loadPrintJob(env.DB, businessId, jobId)
    if (!original) throw apiError(404, 'PRINT_JOB_NOT_FOUND', 'Trabalho de impressão não encontrado.')
    await requirePrintJobRead(env.DB, context, original)
    const document = original.orderId
      ? await loadOrderPrintDocument(env.DB, businessId, original.orderId)
      : null
    if (!document) throw apiError(404, 'ORDER_NOT_FOUND', 'Pedido não encontrado.')
    const job = await reprintPrintJob(
      env.DB,
      businessId,
      jobId,
      printCopies(body.copies),
      document,
      new Date(),
      actor.displayName,
    )
    return printingJson({ job }, { status: 201 })
  }

  const jobActionMatch = url.pathname.match(/^\/api\/printing\/jobs\/([^/]+)\/(claim|complete|fail|retry)$/)
  if (jobActionMatch && request.method === 'POST') {
    assertSameOriginMutation(request)
    const body = await readJson(request)
    const jobId = decodeURIComponent(jobActionMatch[1])
    const action = jobActionMatch[2]

    if (action === 'claim') {
      await requirePrintJobRead(env.DB, context, await loadPrintJob(env.DB, businessId, jobId))
      return printingJson({ job: await claimPrintJob(env.DB, businessId, jobId, stationIdFromBody(body), new Date(), context.granted) })
    }
    if (action === 'complete') {
      return printingJson({ job: await markPrintJobPrinted(env.DB, businessId, jobId, stationIdFromBody(body), printCopies(body.copiesPrinted, 'copiesPrinted')) })
    }
    if (action === 'fail') {
      return printingJson({ job: await markPrintJobFailed(env.DB, businessId, jobId, stationIdFromBody(body), {
        code: requiredText(body.code, 'code', 'Código da falha é obrigatório.'),
        message: requiredText(body.message, 'message', 'Mensagem da falha é obrigatória.'),
        uncertain: Boolean(body.uncertain),
      }) })
    }
    if (action === 'retry') {
      return printingJson({ job: await retryPrintJob(env.DB, businessId, jobId, new Date(), actor.displayName) })
    }
  }

  const documentMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/print-document$/)
  if (documentMatch && request.method === 'GET') {
    await requirePrintJobRead(env.DB, context, { type: 'order', orderId: decodeURIComponent(documentMatch[1]) })
    const document = await loadOrderPrintDocument(env.DB, businessId, decodeURIComponent(documentMatch[1]))
    if (!document) throw apiError(404, 'ORDER_NOT_FOUND', 'Pedido não encontrado.')
    await requirePrintJobRead(env.DB, context, { type: 'order', orderId: decodeURIComponent(documentMatch[1]) })
    return printingJson({ document })
  }

  return null
}
