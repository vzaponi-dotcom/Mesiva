import { useRealtimeRuntime } from '../infrastructure/realtime/useRealtimeRuntime.js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { detectOperationalArrivals } from '../domains/orders/index.js'
import {
  KITCHEN_ALERT_PROFILES,
  KITCHEN_ALERT_VOLUME_OPTIONS,
  TV_KITCHEN_ALERT_DEFAULTS,
} from '../shared/utils/kitchenAlertCatalog.js'
import {
  readKitchenSoundProfilePreference,
  readKitchenSoundVolumePreference,
  writeKitchenSoundProfilePreference,
  writeKitchenSoundVolumePreference,
} from '../infrastructure/storage/kitchenSoundPreference.js'
import { filterKitchenTvOrders } from '../../shared/kitchenTvModality.js'
import { KitchenDisplayHttpError } from './kitchenDisplayApi.js'
import { createKitchenDisplayAudio } from './kitchenDisplayAudio.js'
import { buildKitchenDisplayPages } from './kitchenDisplayPresentation.js'
import {
  createKitchenDisplayPagingState,
  reconcileKitchenDisplayPaging,
} from './kitchenDisplayPaging.js'
import { isKitchenDisplayFullscreen, requestKitchenDisplayFullscreen } from './kitchenDisplayFullscreen.js'
import {
  bootstrapKitchenDisplay,
  pollKitchenDisplayPairing,
  readStoredKitchenDisplayState,
  reportStoredKitchenDisplayState,
} from './kitchenDisplaySession.js'
import { KitchenDisplayBoard } from './KitchenDisplayBoard.jsx'

const isDefinitive = (error) => error?.definitive === true
  || error instanceof KitchenDisplayHttpError && (error.status === 401 || error.status === 403)

const formatPairingCode = (value) => {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 6)
  return digits.length > 3 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits
}

const FULLSCREEN_RECOVERY_SAFE_AREA_PX = 56
const TELEMETRY_HEARTBEAT_MS = 5000

const readViewport = () => {
  const width = Math.trunc(Number(globalThis.window?.innerWidth))
  const height = Math.trunc(Number(globalThis.window?.innerHeight))
  return {
    width: Number.isFinite(width) && width > 0 ? width : undefined,
    height: Number.isFinite(height) && height > 0 ? height : undefined,
  }
}

export function KitchenDisplayApp({
  bootstrap = bootstrapKitchenDisplay,
  pollPairing = pollKitchenDisplayPairing,
  readState = readStoredKitchenDisplayState,
  reportState = reportStoredKitchenDisplayState,
  audio: suppliedAudio,
  realtimeApi=null,
  realtimeTransport,
  schedule = globalThis.setTimeout,
  cancelSchedule = globalThis.clearTimeout,
  requestFullscreen = requestKitchenDisplayFullscreen,
}) {
  const audio = useMemo(() => suppliedAudio || createKitchenDisplayAudio(), [suppliedAudio])
  const [phase, setPhase] = useState('loading')
  const [pairing, setPairing] = useState(null)
  const [snapshot, setSnapshot] = useState(null)
  const [now, setNow] = useState(() => new Date())
  const [viewport, setViewport] = useState(() => readViewport())
  const [stale, setStale] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null)
  const [highlightedIds, setHighlightedIds] = useState(() => new Set())
  const [soundProfile, setSoundProfile] = useState(() => readKitchenSoundProfilePreference(undefined, TV_KITCHEN_ALERT_DEFAULTS.profile))
  const [soundVolume, setSoundVolume] = useState(() => readKitchenSoundVolumePreference(undefined, TV_KITCHEN_ALERT_DEFAULTS.volume))
  const [soundBlocked, setSoundBlocked] = useState(false)
  const [soundPreferenceError, setSoundPreferenceError] = useState('')
  const [compatibilityError, setCompatibilityError] = useState('')
  const [fullscreenRecoveryNeeded, setFullscreenRecoveryNeeded] = useState(false)
  const [paging, setPaging] = useState(() => createKitchenDisplayPagingState(null))
  const pagingRef = useRef(paging)
  const previousIds = useRef(undefined)
  const alertedIds = useRef(new Set())
  const highlightTimers = useRef(new Map())
  const telemetryFingerprint = useRef(null)
  const telemetryPayloadRef = useRef(null)
  const snapshotRef=useRef(snapshot),clockRef=useRef(now),readGeneration=useRef(0),refreshInFlight=useRef(null)
  snapshotRef.current=snapshot
  const [realtimeGeneration,setRealtimeGeneration]=useState(0)

  const commitPaging = useCallback((nextPaging) => {
    pagingRef.current = nextPaging
    setPaging(nextPaging)
  }, [])

  const sendTelemetry = useCallback((payload, { force = false } = {}) => {
    if (!payload) return
    const fingerprint = JSON.stringify(payload)
    if (!force && telemetryFingerprint.current === fingerprint) return
    telemetryFingerprint.current = fingerprint
    void Promise.resolve(reportState(payload)).catch(() => {
      if (telemetryFingerprint.current === fingerprint) telemetryFingerprint.current = null
    })
  }, [reportState])

  const applySnapshot = useCallback(async (next, {clockNow=null,clockOnly=false}={}) => {
    const currentNow = clockNow || new Date(next.serverNow || Date.now())
    clockRef.current=currentNow
    setNow(currentNow)
    const arrival = detectOperationalArrivals(previousIds.current, next.orders || [], currentNow, alertedIds.current, next.timing)
    previousIds.current = arrival.currentIds
    const filteredOrders = filterKitchenTvOrders(next.orders || [], next.control?.requestedModality)
    const builtPages = buildKitchenDisplayPages(
      filteredOrders,
      next.timing,
      currentNow,
      new Set(),
      { viewportWidth: viewport.width, viewportHeight: viewport.height },
    )
    commitPaging(reconcileKitchenDisplayPaging(pagingRef.current, {
      control: next.control,
      pageCount: Math.max(1, builtPages.pages.length),
      hasArrivals: arrival.newIds.length > 0,
    }))
    if (arrival.newIds.length) {
      for (const id of arrival.newIds) {
        alertedIds.current.add(id)
        const priorTimer = highlightTimers.current.get(id)
        if (priorTimer) cancelSchedule(priorTimer)
        const timer = schedule(() => {
          highlightTimers.current.delete(id)
          setHighlightedIds((current) => {
            const changed = new Set(current)
            changed.delete(id)
            return changed
          })
        }, 2600)
        highlightTimers.current.set(id, timer)
      }
      setHighlightedIds((current) => new Set([...current, ...arrival.newIds]))
      if (!await audio.playArrival({ profile: soundProfile, volume: soundVolume })) setSoundBlocked(true)
    }
    if(!clockOnly){setSnapshot(next);setStale(false);setLastUpdatedAt(new Date())}
  }, [audio, cancelSchedule, commitPaging, schedule, soundProfile, soundVolume, viewport.height, viewport.width])

  const prepareStartPanel = useCallback((next) => {
    commitPaging(createKitchenDisplayPagingState(next?.control))
    setSnapshot(next)
    setStale(false)
    setLastUpdatedAt(new Date())
    setCompatibilityError('')
    setPhase('start-required')
  }, [commitPaging])

  useEffect(() => {
    let active = true
    const start = async () => {
      try {
        const initial = await bootstrap()
        if (!active) return
        if (initial?.kind === 'pairing') {
          setPairing(initial.pairing)
          setPhase('pairing')
          return
        }
        await prepareStartPanel(initial.state)
      } catch {
        if (!active) return
        setSnapshot(null)
        setPhase('pairing-error')
      }
    }
    void start()
    return () => { active = false }
  }, [bootstrap, prepareStartPanel])

  useEffect(() => {
    if (phase !== 'pairing') return undefined
    let checking = false
    const check = async () => {
      if (checking) return
      checking = true
      try {
        const next = await pollPairing()
        if (next?.kind === 'paired') {
          await prepareStartPanel(next.state)
          setPairing(null)
        } else if (next?.kind === 'pairing') {
          setPairing(next.pairing)
        }
      } catch (error) {
        if (error?.activationFailure) {
          const suffix = error.status ? `_${error.status}` : ''
          setCompatibilityError(`KDS_SESSION_ACTIVATION${suffix}: ${error.message}`)
          setPairing(null)
          setPhase('compatibility-error')
        }
        // Other transient failures keep the current code visible and retry it.
      } finally {
        checking = false
      }
    }
    const poll = globalThis.setInterval(() => void check(), 2000)
    return () => globalThis.clearInterval(poll)
  }, [phase, pollPairing, prepareStartPanel])

  const revokeDisplay=useCallback(()=>{
    readGeneration.current++;previousIds.current=undefined
    commitPaging(createKitchenDisplayPagingState(null));setSnapshot(null);setStale(false);setPhase('unauthorized')
  },[commitPaging])
  const refresh = useCallback(() => {
    if(refreshInFlight.current)return refreshInFlight.current
    const generation=readGeneration.current
    const pending=Promise.resolve().then(async()=>{
      try {
        const next=await readState()
        if(generation!==readGeneration.current)return false
        await applySnapshot(next);return true
      } catch(error){
        if(generation!==readGeneration.current)return false
        if(isDefinitive(error))revokeDisplay();else setStale(true)
        return false
      } finally {if(refreshInFlight.current===pending)refreshInFlight.current=null}
    })
    refreshInFlight.current=pending;return pending
  },[applySnapshot,readState,revokeDisplay])
  const onRealtimeUnauthorized=useCallback(async error=>{
    if(error?.status===401 || error?.status===403){revokeDisplay();return}
    // A company-wide access hint may leave this paired TV valid. Revalidate it.
    const generation=readGeneration.current
    await refresh()
    if(readGeneration.current===generation)setRealtimeGeneration(current=>current+1)
  },[refresh,revokeDisplay])
  const realtime=useRealtimeRuntime({api:realtimeApi,accessContextId:'kitchen-tv:'+realtimeGeneration,
    enabled:Boolean(realtimeApi) && phase==='live',onUnauthorized:onRealtimeUnauthorized,transport:realtimeTransport})
  const subscribeRealtime=realtime.subscribeInvalidations
  useEffect(()=>{
    if(!realtimeApi || phase!=='live')return undefined
    return subscribeRealtime(event=>{if(event.topics.some(topic=>topic==='orders' || topic==='kitchen-tv'))return refresh()})
  },[phase,realtimeApi,subscribeRealtime,refresh])

  useEffect(() => {
    if (phase !== 'live') return undefined
    const onResize = () => setViewport(readViewport())
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [phase])

  useEffect(() => {
    if (phase !== 'live') return undefined
    const tick = globalThis.setInterval(() => {
      const nextNow=new Date(clockRef.current.getTime()+1000);clockRef.current=nextNow
      if(snapshotRef.current && document.visibilityState==='visible')void applySnapshot(snapshotRef.current,{clockNow:nextNow,clockOnly:true});else setNow(nextNow)
    },1000)
    const poll = realtimeApi ? null : globalThis.setInterval(() => {
      if (!realtimeApi && document.visibilityState === 'visible') void refresh()
    }, 2000)
    const onOnline = () => realtimeApi ? setRealtimeGeneration(current=>current+1) : void refresh()
    const onFocus = () => {if(!realtimeApi)void refresh()}
    const onVisibility = () => {
      if (!realtimeApi && document.visibilityState === 'visible') void refresh()
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      globalThis.clearInterval(tick)
      globalThis.clearInterval(poll)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [applySnapshot,phase,refresh,realtimeApi,subscribeRealtime])

  useEffect(() => () => {
    for (const timer of highlightTimers.current.values()) cancelSchedule(timer)
    highlightTimers.current.clear()
  }, [cancelSchedule])

  useEffect(() => {
    if (phase !== 'live') return undefined
    const onFullscreenChange = () => setFullscreenRecoveryNeeded(!isKitchenDisplayFullscreen())
    document.addEventListener('fullscreenchange', onFullscreenChange)
    document.addEventListener('webkitfullscreenchange', onFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      document.removeEventListener('webkitfullscreenchange', onFullscreenChange)
    }
  }, [phase])


  const startPanel = async () => {
    let fullscreenAttempt
    try {
      fullscreenAttempt = requestFullscreen()
    } catch {
      setFullscreenRecoveryNeeded(true)
    }

    let unlockAttempt
    try {
      unlockAttempt = audio.unlock()
    } catch {
      setSoundBlocked(true)
    }

    setPhase('starting')
    try {
      await applySnapshot(snapshot || { orders: [], timing: undefined, serverNow: new Date().toISOString() })
      setPhase('live')
    } catch (error) {
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error || 'KDS_COMPAT_RUNTIME')
      setCompatibilityError(detail)
      setPhase('compatibility-error')
    }

    if (fullscreenAttempt) {
      void Promise.resolve(fullscreenAttempt)
        .then((entered) => setFullscreenRecoveryNeeded(!entered))
        .catch(() => setFullscreenRecoveryNeeded(true))
    } else {
      setFullscreenRecoveryNeeded(true)
    }

    if (unlockAttempt) {
      void Promise.resolve(unlockAttempt)
        .then((ready) => setSoundBlocked(!ready))
        .catch(() => setSoundBlocked(true))
    }
  }

  const enterFullscreen = async () => {
    try {
      setFullscreenRecoveryNeeded(!await requestFullscreen())
    } catch {
      setFullscreenRecoveryNeeded(true)
    }
  }

  const changeSoundProfile = (value) => {
    setSoundProfile(value)
    try {
      writeKitchenSoundProfilePreference(value)
      setSoundPreferenceError('')
    } catch {
      setSoundPreferenceError('A escolha vale nesta sessão, mas não pôde ser salva nesta TV.')
    }
  }

  const changeSoundVolume = (value) => {
    setSoundVolume(value)
    try {
      writeKitchenSoundVolumePreference(value)
      setSoundPreferenceError('')
    } catch {
      setSoundPreferenceError('A escolha vale nesta sessão, mas não pôde ser salva nesta TV.')
    }
  }

  const previewSound = async () => {
    try {
      const play = audio.preview || audio.playArrival
      const played = await play({ profile: soundProfile, volume: soundVolume })
      setSoundBlocked(!played)
      return played
    } catch {
      setSoundBlocked(true)
      return false
    }
  }

  const enableSound = async () => setSoundBlocked(!await audio.unlock())
  const boardViewportHeight = fullscreenRecoveryNeeded && viewport.height
    ? Math.max(1, viewport.height - FULLSCREEN_RECOVERY_SAFE_AREA_PX)
    : viewport.height
  const filteredOrders = useMemo(
    () => filterKitchenTvOrders(snapshot?.orders || [], snapshot?.control?.requestedModality),
    [snapshot?.control?.requestedModality, snapshot?.orders],
  )
  const pageSet = useMemo(() => phase === 'live'
    ? buildKitchenDisplayPages(
        filteredOrders,
        snapshot?.timing,
        now,
        highlightedIds,
        { viewportWidth: viewport.width, viewportHeight: boardViewportHeight },
      )
    : { pages: [], totalVisible: 0, unrenderableOrderIds: [] },
  [boardViewportHeight, filteredOrders, highlightedIds, now, phase, snapshot?.timing, viewport.width])
  const pageCount = Math.max(1, pageSet.pages.length)
  const selectedPage = pageSet.pages[Math.min(paging.currentPage, pageCount) - 1] || null
  const nextPageCount = pageSet.pages[paging.currentPage]?.cards?.length || 0

  useEffect(() => {
    if (phase !== 'live') return
    const nextPaging = reconcileKitchenDisplayPaging(pagingRef.current, {
      control: snapshot?.control,
      pageCount,
      hasArrivals: false,
    })
    if (
      nextPaging.currentPage !== pagingRef.current.currentPage
      || nextPaging.appliedRevision !== pagingRef.current.appliedRevision
    ) commitPaging(nextPaging)
  }, [commitPaging, pageCount, phase, snapshot?.control])

  useEffect(() => {
    if (phase !== 'live') {
      telemetryPayloadRef.current = null
      return undefined
    }
    const pageNumber = Math.min(paging.currentPage, pageCount)
    const payload = {
      appliedRevision: paging.appliedRevision,
      currentPage: pageNumber,
      pageCount,
      viewportWidth: Number(viewport.width || 0),
      viewportHeight: Number(boardViewportHeight || 0),
      visibleOrderIds: (selectedPage?.cards || []).map(({ order }) => String(order.id)),
    }
    if (payload.viewportWidth < 1 || payload.viewportHeight < 1) {
      telemetryPayloadRef.current = null
      return undefined
    }
    telemetryPayloadRef.current = payload
    sendTelemetry(payload)
    return undefined
  }, [
    boardViewportHeight,
    pageCount,
    paging.appliedRevision,
    paging.currentPage,
    phase,
    selectedPage,
    sendTelemetry,
    viewport.width,
  ])

  useEffect(() => {
    if (phase !== 'live') return undefined
    const heartbeat = globalThis.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      sendTelemetry(telemetryPayloadRef.current, { force: true })
    }, TELEMETRY_HEARTBEAT_MS)
    return () => globalThis.clearInterval(heartbeat)
  }, [phase, sendTelemetry])

  if (phase === 'loading') return <main className="kds-shell"><p>Preparando esta TV…</p></main>
  if (phase === 'pairing-error') return <main className="kds-shell"><section className="kds-pairing-card"><h1>Não foi possível preparar o pareamento</h1><p>Atualize esta página para gerar um novo código.</p></section></main>
  if (phase === 'pairing') return <main className="kds-shell">
    <section className="kds-pairing-card" aria-label="Pareamento da TV da cozinha">
      <p className="kds-pairing-kicker">Mesiva</p>
      <h1>Conectar esta TV</h1>
      <p>Abra <strong>Configurações → TV da Cozinha</strong> no celular e digite o código abaixo.</p>
      <strong className="kds-pairing-code" aria-label={`Código de pareamento ${pairing?.code || ''}`}>{formatPairingCode(pairing?.code)}</strong>
      <p className="kds-pairing-help">O código é temporário e válido por até 30 minutos. Esta tela continuará automaticamente quando a conexão for autorizada.</p>
    </section>
  </main>
  if (phase === 'unauthorized') return <main className="kds-shell"><section className="kds-pairing-card"><h1>Painel não autorizado</h1><p>Atualize a página para conectar esta TV novamente.</p></section></main>
  if (phase === 'start-required') return <main className="kds-shell">
    <section className="kds-pairing-card kds-start-card">
      <p className="kds-pairing-kicker">Mesiva</p>
      <h1>Painel da cozinha pronto</h1>
      <p>Escolha um alerta audível para esta TV e depois inicie o painel.</p>

      <div className="kds-sound-setup">
        <div className="kds-sound-profile">
          <span>Toque do alerta</span>
          <div className="kds-sound-profile-options" role="radiogroup" aria-label="Toque do alerta da TV">
            {KITCHEN_ALERT_PROFILES.map((profile) => (
              <button
                key={profile.id}
                type="button"
                role="radio"
                aria-checked={soundProfile === profile.id}
                onClick={() => changeSoundProfile(profile.id)}
              >
                {profile.label}
              </button>
            ))}
          </div>
        </div>

        <div className="kds-sound-volume">
          <span>Volume</span>
          <div className="kds-sound-volume-options" role="group" aria-label="Volume do alerta da TV">
            {KITCHEN_ALERT_VOLUME_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={soundVolume === option.id}
                onClick={() => changeSoundVolume(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <button className="kds-sound-preview-button" type="button" onClick={previewSound}>Ouvir alerta</button>
        {soundPreferenceError && <small className="kds-sound-preference-error">{soundPreferenceError}</small>}
        {soundBlocked && <small className="kds-sound-preference-error">A TV bloqueou o áudio. Tente novamente pelo botão Ouvir alerta.</small>}
      </div>

      <button type="button" onClick={startPanel}>Iniciar painel da cozinha</button>
    </section>
  </main>
  if (phase === 'starting') return <main className="kds-shell">
    <section className="kds-pairing-card"><p className="kds-pairing-kicker">Mesiva</p><h1>Preparando o painel…</h1></section>
  </main>
  if (phase === 'compatibility-error') return <main className="kds-shell">
    <section className="kds-pairing-card">
      <p className="kds-pairing-kicker">Compatibilidade da TV</p>
      <h1>Não foi possível preparar os pedidos nesta TV</h1>
      <p>Atualize esta página e tente novamente. Se continuar, informe o código abaixo ao suporte.</p>
      <small className="kds-compatibility-detail">{compatibilityError || 'KDS_COMPAT_RUNTIME'}</small>
      <button type="button" onClick={() => window.location.reload()}>Tentar novamente</button>
    </section>
  </main>

  return <main className={`kds-shell kds-shell--live${fullscreenRecoveryNeeded ? ' kds-shell--fullscreen-recovery' : ''}`} data-stale={stale}>
    <span className="kds-visually-hidden">Painel da cozinha ativo</span>
    {stale && <p className="kds-last-updated">Dados temporariamente desatualizados{lastUpdatedAt ? ` · última atualização ${lastUpdatedAt.toLocaleTimeString('pt-BR')}` : ''}</p>}
    {fullscreenRecoveryNeeded && <div className="kds-live-toolbar" role="region" aria-label="Controles do painel">
      <button className="kds-fullscreen-action" type="button" onClick={enterFullscreen}>Entrar em tela cheia</button>
    </div>}
    {soundBlocked && <button className="kds-sound-action" type="button" onClick={enableSound}>Ativar alertas sonoros</button>}
    <KitchenDisplayBoard
      orders={filteredOrders}
      timing={snapshot?.timing}
      now={now}
      highlightedIds={highlightedIds}
      stale={stale}
      viewportWidth={viewport.width}
      viewportHeight={boardViewportHeight}
      presentation={selectedPage || undefined}
      pageNumber={Math.min(paging.currentPage, pageCount)}
      pageCount={pageCount}
      nextPageCount={nextPageCount}
    />
  </main>
}
