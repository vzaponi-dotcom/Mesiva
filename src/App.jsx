import { PlatformRoutes, createProvisioningAttempts, createManagementAttempts } from './domains/platform/index.js'
import { ACCOUNT_CONTEXT_PATHS } from './app/navigation/routes.js'
import { CompanySelection, CompanyInvitationAccept, createCompaniesApi } from './domains/companies/index.js'
import { ContextApi } from './infrastructure/api/ContextApi.js'
import { createContextHttpClient } from './infrastructure/api/contextHttpClient.js'
import { createBootstrapApi } from './infrastructure/api/bootstrapApi.js'
import { createEffectiveConfigApi } from './infrastructure/api/effectiveConfigApi.js'
import { createPaymentApi } from './app/workflows/payments/paymentApi.js'
import { createRefundApi } from './app/workflows/refunds/refundApi.js'
import {
  FinanceWorkspace,
  financeCategoryOptionsFromEffective,
  financeCategoryRevisionFromEffective,
  paymentDefaultFromEffective,
  paymentOptionsFromEffective,
} from './domains/finance/index.js'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import './App.css'
import './central-data.css'
import AppShell from './app/shell/AppShell.jsx'
import AppRoot from './app/shell/AppRoot.jsx'
import { useLocation, useNavigate } from 'react-router'
import { AccessSurface, InvitationAccept, PasswordRecovery } from './domains/access/index.js'
import Button from './shared/ui/Button'
import Modal from './shared/ui/Modal'
import Icon from './shared/ui/Icon.jsx'
import './app/workflows/printing/orderEditPrintPrompt.css'
import RegisterRefundDialog from './app/workflows/refunds/RegisterRefundDialog.jsx'
import CheckoutPaymentComposition from './app/workflows/payments/CheckoutPaymentComposition.jsx'
import OrderEditSettlementDialog from './app/workflows/payments/order/OrderEditSettlementDialog.jsx'
import { useRefundWorkflow } from './app/workflows/refunds/useRefundWorkflow.js'
import {
  cancellationOptionsFromEffective,
  cancellationRevisionFromEffective,
  formatCancellationDate,
  getOrderRefundState,
  NewOrderRoute,
  OrderHistory,
  OrderDetail,
  Orders,
  createOrdersApi,
  toLocalDateValue,
  useKitchenClock,
  useNewOrderDraft,
  useOrderArrivals,
  getOperationalOrderCount,
  useOrderCommands,
} from './domains/orders/index.js'
import {
  Comandas,
  Tables,
  resolveOpenComanda,
  useComandaSelection,
  useTableServiceCommands,
  createTableServiceApi,
  getOpenComandaCount,
  createTableReservationApi,
  useTableReservationCommands,
} from './domains/table-service/index.js'
import DashboardSurface from './app/surfaces/dashboard/DashboardSurface.jsx'
import KitchenTvControlSurface from './app/surfaces/kitchen-tv-control/KitchenTvControlSurface.jsx'
import { ReportingWorkspace } from './domains/reporting/index.js'
import SettingsPolicyBoundary from './app/surfaces/settings/SettingsPolicyBoundary.jsx'
import SettingsSurface from './app/surfaces/settings/SettingsSurface.jsx'
import SettingsHome from './app/surfaces/settings/SettingsHome.jsx'
import TableServiceExternalActions from './app/surfaces/table-service/TableServiceExternalActions.jsx'
import ReceivablesSurface from './app/surfaces/finance/ReceivablesSurface.jsx'
import OrderPaymentDialog from './app/workflows/payments/order/OrderPaymentDialog.jsx'
import { useOrderPaymentWorkflow } from './app/workflows/payments/order/useOrderPaymentWorkflow.js'
import ClientOrdersPaymentDialog from './app/workflows/payments/client-orders/ClientOrdersPaymentDialog.jsx'
import { useClientOrdersPaymentWorkflow } from './app/workflows/payments/client-orders/useClientOrdersPaymentWorkflow.js'
import { useTableTabPaymentWorkflow } from './app/workflows/payments/table-tab/useTableTabPaymentWorkflow.js'
import { hasCapability, legacyCapabilities } from './app/access.js'
import { resolveDestination } from './app/navigation/resolution.js'
import { NavigationProvider } from './app/navigation/NavigationContext.jsx'
import { useNavigationController } from './app/navigation/useNavigationController.js'
import { useRouteGate } from './app/navigation/useRouteGate.js'
import { useNewOrderUnloadGuard } from './app/navigation/useNewOrderUnloadGuard.js'
import { useQueryContext } from './app/navigation/useQueryContext.js'
import { useEffectiveBusinessConfig } from './app/useEffectiveBusinessConfig.js'
import { createPolicyNavigationBridge } from './app/policy-editing/policyNavigationBridge.js'
import { useOperationalDataRuntime } from './app/runtime/data/useOperationalDataRuntime.js'
import { useFeedbackRuntime } from './app/runtime/feedback/useFeedbackRuntime.js'
import { useOnlineStatus } from './app/runtime/network/useOnlineStatus.js'
import { useSessionRuntime } from './app/runtime/session/useSessionRuntime.js'
import { useQuickCreateCustomerCommand, createCustomersApi } from './domains/customers/index.js'
import CustomersWorkspace from './app/surfaces/customers/CustomersSurface.jsx'
import { CatalogWorkspace } from './domains/catalog/index.js'
import { PrintQueue, PrintingOverlays, usePrintingManager, createPrintingApi } from './domains/printing/index.js'
import {
  readKitchenSoundPreference,
  readKitchenSoundProfilePreference,
  readKitchenSoundVolumePreference,
  writeKitchenSoundPreference,
  writeKitchenSoundProfilePreference,
  writeKitchenSoundVolumePreference,
} from './infrastructure/storage/kitchenSoundPreference.js'
import { getSessionStorage } from './infrastructure/storage/sessionStorage.js'

const IMPLEMENTED_DESTINATIONS = new Set(['orders', 'history', 'kitchen-tv-control', 'new-order', 'comandas', 'print-queue', 'dashboard', 'reports', 'receivables', 'finance', 'clients', 'products', 'tables', 'settings-home', 'settings-business-profile', 'settings-operations', 'settings-modalities', 'settings-payments', 'settings-cancellations', 'settings-finance-categories', 'settings-kitchen-tv', 'settings-printing', 'settings-device', 'my-account', 'access-team', 'access-activity'])
const currency = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)

function ApplicationRuntime({ capabilities, renderAccessSurface = (props) => <AccessSurface {...props} /> } = {}) {
  const routeLocation = useLocation()
  const navigateContext = useNavigate()
  const platformEntry = routeLocation.pathname === '/mesiva' || routeLocation.pathname.startsWith('/mesiva/')
  const platformEntryRef = useRef(platformEntry); platformEntryRef.current = platformEntry
  const [platformActionPending, setPlatformPending] = useState(false)
  const [provisioningAttempts] = useState(createProvisioningAttempts)
  const [managementAttempts] = useState(createManagementAttempts)
  const platformPendingRef = useRef(false)
  const changePlatformPending = useCallback(value => { platformPendingRef.current = value; setPlatformPending(value) }, [])
  const platformSelectionRef = useRef(null)
  const [companySelectionOpen, setCompanySelectionOpen] = useState(false)
  const [companyList, setCompanyList] = useState({ owner: null, items: [], loading: false, error: '' })
  const [requestKey, setRequestKey] = useState(null)
  const [activityDetail, setActivityDetail] = useState(null)
  const [printQueueReviewJobId, setPrintQueueReviewJobId] = useState(null)
  const [editedPrintPrompt, setEditedPrintPrompt] = useState(null)
  const [editedPrintBusy, setEditedPrintBusy] = useState(false)
  const [editSettlement,setEditSettlement]=useState(null)
  const [editSettlementBusy,setEditSettlementBusy]=useState(false)
  const [editSettlementError,setEditSettlementError]=useState('')
  const editSettlementAttemptRef=useRef(null)
  const [kitchenSoundEnabled, setKitchenSoundEnabled] = useState(readKitchenSoundPreference)
  const [kitchenSoundProfile, setKitchenSoundProfile] = useState(readKitchenSoundProfilePreference)
  const [kitchenSoundVolume, setKitchenSoundVolume] = useState(readKitchenSoundVolumePreference)
  const isOnline = useOnlineStatus()
  const {
    toastMessage,
    successMessage,
    setToastMessage,
    setSuccessMessage,
    showSuccessMessage,
  } = useFeedbackRuntime()
  const effectiveConfigVersionRef = useRef(null)
  const operationalRuntimeTargetsRef = useRef({ onUnauthorized: null })
  const sessionRuntimeTargetsRef = useRef({
    refreshBootstrap: async () => {},
    resetOperationalData: () => {},
    resetSyncState: () => {},
    clearApplicationState: () => {},
  })

  const sessionOwnerRef = useRef(null)
  const newOrderDraftTargetsRef = useRef({
    canSubmit: () => false,
    commitOfficialEffects: () => {},
    onCommitted: async () => {},
    onSuccess: () => {},
    onError: () => {},
    onConflict: async () => {},
  })
  const orderCommandTargetsRef = useRef({ onError: () => {} })


  const refreshBootstrapForSession = useCallback(
    (...args) => platformEntryRef.current ? Promise.resolve() : sessionRuntimeTargetsRef.current.refreshBootstrap(...args),
    [],
  )
  const resetOperationalDataForSession = useCallback(
    (...args) => sessionRuntimeTargetsRef.current.resetOperationalData(...args),
    [],
  )
  const clearApplicationStateForSession = useCallback(
    (scope) => scope === 'sync'
      ? sessionRuntimeTargetsRef.current.resetSyncState()
      : sessionRuntimeTargetsRef.current.clearApplicationState(),
    [],
  )
  const {
    authState,
    sessionContext,
    sessionGeneration,
    authMode,
    operationalAccess: sessionOperationalAccess,
    selectBusiness, selectPlatform, listBusinesses, contextChangePending,
    refreshSession,
    runCredentialChange,
    isCredentialChangePending,
    loginError,
    handleLogin,
    handleLogout: handleSessionLogout,
    expireSession,
  } = useSessionRuntime({
    isOnline,
    requestKey,
    canChangeContext: target => sessionRuntimeTargetsRef.current.canChangeContext?.(target) !== false,
    setRequestKey,
    resetOperationalData: resetOperationalDataForSession,
    refreshBootstrap: refreshBootstrapForSession,
    onClearApplicationState: clearApplicationStateForSession,
  })

  const provisioningAttempt = useSyncExternalStore(provisioningAttempts.subscribe, () => provisioningAttempts.getSnapshot(sessionContext?.account?.id))
  const managementAttempt = useSyncExternalStore(managementAttempts.subscribe, () => managementAttempts.getSnapshot(sessionContext?.account?.id))
  const canReconcileManagement = sessionContext?.platformCapabilities?.includes('platform.businesses.view')
  const canReconcileProvisioning = ['platform.businesses.view', 'platform.businesses.create'].every(capability => sessionContext?.platformCapabilities?.includes(capability))
  const platformPending = platformActionPending || (canReconcileProvisioning && ['pending', 'uncertain'].includes(provisioningAttempt?.status)) || (canReconcileManagement && ['pending','uncertain'].includes(managementAttempt?.status))
  const isPlatformPending = () => platformPendingRef.current || (canReconcileProvisioning && provisioningAttempts.isBlocking(sessionContext?.account?.id)) || (canReconcileManagement && managementAttempts.isBlocking(sessionContext?.account?.id))
  const operationalAccess = sessionOperationalAccess && !platformEntry
  const contextOwnerRef = useRef(null)
  contextOwnerRef.current = sessionContext?.contextId
  const contextClient = useMemo(() => createContextHttpClient({ context: sessionContext, onContextChanged: () => {
    if (contextOwnerRef.current === sessionContext?.contextId) void refreshSession({ requireContext: true })
  } }), [sessionContext, refreshSession])
  const clientsForContext = useMemo(() => ({
    orders: createOrdersApi(contextClient), reservations: createTableReservationApi(contextClient),
    tables: createTableServiceApi(contextClient), customers: createCustomersApi(contextClient),
    companies: createCompaniesApi(contextClient), printing: createPrintingApi(contextClient), bootstrap: createBootstrapApi(contextClient),
    effective: createEffectiveConfigApi(contextClient), payments: createPaymentApi(contextClient), refunds: createRefundApi(contextClient),
  }), [contextClient])
  const newOrderDraft = useNewOrderDraft({
    getAccessOwner: () => sessionOwnerRef.current,
    submitOrder: clientsForContext.orders.createOrder,
    submitOrderEdit: clientsForContext.orders.updateOrder,
    submitReservationEdit: clientsForContext.reservations.updateReservation,
    refreshReservation: clientsForContext.reservations.getReservation,
    canSubmit: (payload, context) => newOrderDraftTargetsRef.current.canSubmit(payload, context),
    commitOfficialEffects: (result) => newOrderDraftTargetsRef.current.commitOfficialEffects(result),
    onCommitted: (result, context, intent) => newOrderDraftTargetsRef.current.onCommitted(result, context, intent),
    onSuccess: (order, context) => newOrderDraftTargetsRef.current.onSuccess(order, context),
    onError: (error) => newOrderDraftTargetsRef.current.onError(error),
    onConflict: (context, error) => newOrderDraftTargetsRef.current.onConflict(context, error),
  })

  const globalSession = sessionContext?.authMode === 'multi_company'
  const choosingCompany = globalSession && !platformEntry && (sessionContext.scope === 'identity' || companySelectionOpen || routeLocation.pathname === ACCOUNT_CONTEXT_PATHS.companies)
  useEffect(() => {
    if (!platformEntry || !globalSession || sessionContext.scope === 'platform' || !sessionContext.platformCapabilities?.includes('platform.businesses.view') || platformSelectionRef.current === sessionContext.contextId) return
    platformSelectionRef.current = sessionContext.contextId
    void selectPlatform()
  }, [platformEntry, globalSession, sessionContext, selectPlatform])
  const loadCompanies = useCallback(async () => {
    if (!globalSession || !sessionContext?.contextId) return
    const owner = sessionContext.contextId
    setCompanyList({ owner, items: [], loading: true, error: '' })
    try {
      const result = await clientsForContext.companies.listBusinesses()
      if (contextOwnerRef.current === owner) setCompanyList({ owner, items: result?.businesses || [], loading: false, error: '' })
    } catch (error) { if (contextOwnerRef.current === owner) setCompanyList({ owner, items: [], loading: false, error: error?.message || 'Não foi possível carregar suas empresas.' }) }
  }, [clientsForContext, globalSession, sessionContext])
  useEffect(() => { if (choosingCompany) void loadCompanies() }, [choosingCompany, loadCompanies])

  const trustedGrants = useMemo(
    () => capabilities === undefined
      ? (Array.isArray(sessionContext?.capabilities)
          ? new Set(sessionContext.capabilities)
          : legacyCapabilities(authState === 'authenticated' && ['legacy', 'enrollment'].includes(sessionContext?.authMode) && !sessionContext?.user?.id))
      : capabilities,
    [authState, capabilities, sessionContext],
  )
  const granted = useMemo(() => !operationalAccess && sessionContext?.user?.id
    ? new Set([...trustedGrants].filter(capability => capability.startsWith('access.')))
    : trustedGrants, [operationalAccess, sessionContext, trustedGrants])
  const accessContextId = useMemo(() => authState === 'authenticated' ? JSON.stringify([sessionContext?.contextId, sessionContext?.scope, sessionContext?.account?.id, sessionContext?.businessId, sessionContext?.user?.id || 'legacy', sessionContext?.settingsContextId, [...granted].sort(), sessionGeneration]) : null, [authState, sessionContext, granted, sessionGeneration])
  sessionOwnerRef.current = accessContextId
  const { query, patchQuery, resetQueries } = useQueryContext()
  const policyNavigationBridge = useMemo(() => createPolicyNavigationBridge(), [])
  const {
    activeTab,
    moreOpen,
    pendingDestination,
    pendingDiscardKind,
    requestNavigation,
    openMore,
    closeMore,
    confirmDiscard,
    cancelDiscard,
    resetNavigation,
    completeNavigation,
    completeContextNavigation,
    requestSessionExit,
  } = useNavigationController({
    granted,
    authenticated: authState === 'authenticated' && Boolean(sessionContext?.user?.id),
    implemented: IMPLEMENTED_DESTINATIONS,
    navigationPending: platformPending,
    getNavigationPending: isPlatformPending,
    getPendingReconciliationPath: () => sessionRuntimeTargetsRef.current.getProvisioningResumePath?.(),
    contextPaths: globalSession ? [ACCOUNT_CONTEXT_PATHS.companies, '/minha-conta', ...(sessionContext.platformCapabilities?.includes('platform.businesses.view') ? [ACCOUNT_CONTEXT_PATHS.platform] : [])] : [],
    checkoutPending: newOrderDraft.checkoutPending,
    dirtyOrder: newOrderDraft.dirty,
    onDiscardOrder: newOrderDraft.discard,
    getNavigationDraft: policyNavigationBridge.getNavigationDraft,
    discardNavigationDraft: policyNavigationBridge.discardNavigationDraft,
    onFeedback: setToastMessage,
  })
  useNewOrderUnloadGuard({
    active: activeTab === 'new-order' || platformPending || provisioningAttempts.hasUnresolved() || managementAttempts.hasUnresolved(),
    dirty: newOrderDraft.dirty,
    checkoutPending: newOrderDraft.checkoutPending || platformPending || provisioningAttempts.hasUnresolved() || managementAttempts.hasUnresolved(),
  })
  const handleOperationalUnauthorized = useCallback((error) => operationalRuntimeTargetsRef.current.onUnauthorized?.(error), [])
  const getEffectiveConfigVersion = useCallback(() => effectiveConfigVersionRef.current, [])
  const {
    business,
    bootstrapState,
    bootstrapEffectiveConfig,
    clients,
    products,
    orders,
    tables,
    tableTabs,
    movements,
    financeSettings,
    refreshBootstrap,
    refreshBootstrapSilently,
    applyOfficialEffects,
    resetOperationalData,
    getSyncGuard,
    getOfficialRevision,
    getOfficialTables,
  } = useOperationalDataRuntime({
    api: { ...clientsForContext.bootstrap, getOrders: clientsForContext.orders.getOrders },
    onUnauthorized: handleOperationalUnauthorized,
    globalSyncEnabled: operationalAccess && isOnline && authState === 'authenticated',
    ordersSyncEnabled: operationalAccess && (activeTab === 'orders' || activeTab === 'kitchen-tv-control') && isOnline && authState === 'authenticated',
    effectiveConfigVersion: getEffectiveConfigVersion,
    accessContextId,
  })
  useRouteGate({
    ready: authState === 'authenticated' && !choosingCompany && !platformEntry && sessionContext?.scope !== 'platform' && (!operationalAccess || bootstrapState === 'ready'),
    authenticated: authState === 'authenticated' && Boolean(sessionContext?.user?.id),
    granted,
    implemented: IMPLEMENTED_DESTINATIONS,
    onFeedback: setToastMessage,
  })
  const {
    selection: selectedComanda,
    selectionGeneration: selectedComandaGeneration,
    selectComanda,
    clearComandaSelection,
    resetComandaSelection,
    ownsComandaSelection,
    getComandaSelectionOwner,
  } = useComandaSelection({ tables })
  // Session bootstrap/cleanup needs operational actions, while operational polling
  // needs auth state. Stable render-time targets break that hook-order cycle without
  // moving either responsibility back into App.
  sessionRuntimeTargetsRef.current.refreshBootstrap = refreshBootstrap
  sessionRuntimeTargetsRef.current.resetOperationalData = resetOperationalData
  useEffect(() => {
    if (operationalAccess && accessContextId && bootstrapState === 'idle') void refreshBootstrap()
  }, [accessContextId, bootstrapState, operationalAccess, refreshBootstrap])

  const effectiveConfigOwner = useMemo(() => operationalAccess && authState === 'authenticated'
    && sessionContext?.businessId
    && sessionContext?.settingsContextId
    && Array.isArray(sessionContext.capabilities)
    ? {
        businessId: sessionContext.businessId,
        userId: sessionContext.user?.id || 'legacy',
        generation: sessionGeneration,
        settingsContextId: sessionContext.settingsContextId,
        capabilities: [...granted],
      }
    : null, [authState, granted, operationalAccess, sessionContext, sessionGeneration])
  const effectiveConfig = useEffectiveBusinessConfig({ owner: effectiveConfigOwner, bootstrapConfig: bootstrapEffectiveConfig, load: clientsForContext.effective.getEffectiveConfig })
  // Mount operational consumers only after the supplied config initializes their confirmed defaults.
  const operationalBootstrapState = bootstrapState === 'ready' && bootstrapEffectiveConfig && effectiveConfig.status === 'loading'
    ? 'loading' : bootstrapState
  const businessConfig = effectiveConfig.config
  const paymentOptions = useMemo(() => businessConfig ? paymentOptionsFromEffective(businessConfig) : [], [businessConfig])
  const defaultPaymentMethod = useMemo(() => businessConfig ? paymentDefaultFromEffective(businessConfig) : '', [businessConfig])
  const cancellationOptions = useMemo(() => businessConfig ? cancellationOptionsFromEffective(businessConfig) : [], [businessConfig])
  const cancellationRevision = useMemo(() => cancellationRevisionFromEffective(businessConfig), [businessConfig])
  const financeCategoryOptions = useMemo(() => businessConfig ? financeCategoryOptionsFromEffective(businessConfig) : [], [businessConfig])
  const financeCategoryRevision = useMemo(() => financeCategoryRevisionFromEffective(businessConfig), [businessConfig])
  const modalityOptions = useMemo(() => businessConfig?.operations?.enabledModalities?.map((value) => ({
    value,
    label: value === 'Local' ? 'Consumo no local' : value,
  })) ?? [], [businessConfig])
  const defaultModality = businessConfig?.operations?.defaultModality
  const currentTiming = businessConfig?.operations?.timing
  useEffect(() => {
    effectiveConfigVersionRef.current = effectiveConfig.config?.version || null
  }, [effectiveConfig.config])
  const canViewOperationalAnalysis = hasCapability(granted, 'orders.history')
    && hasCapability(granted, 'orders.analysis')
  const canCreateOrders = hasCapability(granted, 'orders.create')
  const canEditOrders = hasCapability(granted, 'orders.edit')
  const { context: newOrderContext, open: openNewOrderDraft } = newOrderDraft
  // Direct URLs need the same owned draft as the normal Novo pedido action.
  useEffect(() => {
    if (activeTab === 'new-order' && operationalBootstrapState === 'ready' && canCreateOrders && !newOrderContext) {
      openNewOrderDraft({ returnDestination: 'orders' })
    }
  }, [activeTab, canCreateOrders, newOrderContext, openNewOrderDraft, operationalBootstrapState])
  const canFinalizeOrders = hasCapability(granted, 'orders.finalize')
  const canCancelOrders = hasCapability(granted, 'orders.cancel')
  const canAdjustOrders = hasCapability(granted, 'orders.discount')
  const canBackdateOrders = hasCapability(granted, 'orders.backdate')
  const canReceivePayments = hasCapability(granted, 'payments.receive')
  const canRefundPayments = hasCapability(granted, 'payments.refund')
  const canTransferComanda = hasCapability(granted, 'comandas.transfer')
  const canCreateClients = hasCapability(granted, 'clients.create')
  const canUpdateClients = hasCapability(granted, 'clients.update')
  const canDeleteClients = hasCapability(granted, 'clients.delete')
  const canManageProducts = hasCapability(granted, 'products.manage')
  const canManageTables = hasCapability(granted, 'tables.manage')
  const canManageMovements = hasCapability(granted, 'finance.movements.manage')
  const canManagePaymentPromises = hasCapability(granted, 'finance.promises.manage')
  const canExecutePrinting = hasCapability(granted, 'printing.execute')
  const canDiscardPrinting = hasCapability(granted, 'printing.discard')
  const canForcePrinting = hasCapability(granted, 'printing.force')
  const canUseLocalPreferences = hasCapability(granted, 'preferences.local')
  const canViewPrintQueue = hasCapability(granted, 'printing.queue')
  const canOpenPrintingSettings = resolveDestination('settings-printing', granted, IMPLEMENTED_DESTINATIONS).status === 'allowed'
  const canViewClients = resolveDestination('clients', granted, IMPLEMENTED_DESTINATIONS).status === 'allowed'
  const canOpenComanda = resolveDestination('comandas', granted, IMPLEMENTED_DESTINATIONS).status === 'allowed'

  const todayValue = toLocalDateValue()
  const writesBlockedWithoutOrderCommands = !isOnline || requestKey !== null || newOrderDraft.checkoutPending
  const orderCommands = useOrderCommands({
    orders,
    api: clientsForContext.orders,
    canFinalizeOrders,
    canCancelOrders,
    canRefundPayments,
    writesBlocked: writesBlockedWithoutOrderCommands,
    applyOfficialEffects,
    onSuccess: showSuccessMessage,
    onError: (error) => orderCommandTargetsRef.current.onError(error),
  })
  const writesBlocked = writesBlockedWithoutOrderCommands || orderCommands.pending
  const reservationCommands = useTableReservationCommands({
    api: clientsForContext.reservations,
    writesBlocked,
    canCreateOrders,
    canCancelOrders,
    canDiscountOrders: canAdjustOrders,
    applyOfficialEffects,
    refreshReservation: clientsForContext.reservations.getReservation,
    setRequestKey,
    onSuccess: showSuccessMessage,
    onError: showApiError,
    onResult: (result, action) => {
      if (action !== 'arrival' || !result?.tableTab?.id || !Array.isArray(result.tables)) return
      const table = result.tables.find((item) => item.isActive
        && item.occupancy === 'occupied'
        && item.openTableTab?.id === result.tableTab.id)
      const identity = table
        ? resolveOpenComanda(result.tables, { tableId: table.id, tableTabId: result.tableTab.id })
        : null
      if (identity) selectComanda(identity, result.tables)
    },
  })
  const quickCreateCustomer = useQuickCreateCustomerCommand({
    api: clientsForContext.customers,
    writesBlocked,
    canCreateClients,
    applyOfficialEffects,
    setRequestKey,
    onError: showApiError,
  })
  const orderPayment = useOrderPaymentWorkflow({
    api: clientsForContext.payments,
    orders,
    granted,
    canReceivePayments,
    writesBlocked,
    paymentOptions,
    defaultPaymentMethod,
    getSyncGuard,
    applyOfficialEffects,
    refreshOfficialData: refreshBootstrapSilently,
    setRequestKey,
    onSuccess: showSuccessMessage,
    onError: showApiError,
  })
  const clientOrdersPayment = useClientOrdersPaymentWorkflow({
    api: clientsForContext.payments,
    orders,
    canReceivePayments,
    writesBlocked,
    paymentOptions,
    defaultPaymentMethod,
    getSyncGuard,
    applyOfficialEffects,
    refreshOfficialData: refreshBootstrapSilently,
    setRequestKey,
    onSuccess: showSuccessMessage,
    onError: showApiError,
  })
  const tableTabPayment = useTableTabPaymentWorkflow({
    api: clientsForContext.payments,
    writesBlocked,
    selectionGeneration: selectedComandaGeneration,
    resetKey: sessionGeneration,
    getOfficialTables,
    ownsSelection: ownsComandaSelection,
    clearSelection: clearComandaSelection,
    getSyncGuard,
    getOfficialRevision,
    applyOfficialEffects,
    refreshOfficialData: refreshBootstrapSilently,
    setRequestKey,
    onSuccess: showSuccessMessage,
    onError: showApiError,
  })
  const refund = useRefundWorkflow({
    api: clientsForContext.refunds,
    canRefundPayments,
    writesBlocked,
    applyOfficialEffects,
    setRequestKey,
    onSuccess: showSuccessMessage,
    onError: showApiError,
  })
  const handlePhysicalJobFailure = useCallback(() => {
    setToastMessage('Impressão requer atenção na fila')
  }, [setToastMessage])
  const handleCancelDiscard = useCallback(() => {
    cancelDiscard()
    window.requestAnimationFrame(() => document.querySelector?.('.app-content')?.focus?.())
  }, [cancelDiscard])
  const printing = usePrintingManager({ api: clientsForContext.printing, businessId: sessionContext?.authMode === 'multi_company' ? sessionContext.businessId : undefined, authenticated: operationalAccess && authState === 'authenticated' && bootstrapState === 'ready', accessContextId, isOnline, onPhysicalJobFailure: handlePhysicalJobFailure })
  const kitchenNow = useKitchenClock(orders, { active: activeTab === 'orders' || activeTab === 'kitchen-tv-control', currentTiming })
  const operationalNow = activeTab === 'orders' ? kitchenNow : new Date()
  const operationalOrderCount = getOperationalOrderCount(orders, operationalNow, currentTiming)
  const openComandaCount = getOpenComandaCount(tables, tableTabs)
  const {
    newOrderIds,
    previewSound: previewKitchenOrderSound,
    reset: resetOrderArrivals,
  } = useOrderArrivals({ active: activeTab === 'orders', orders, now: kitchenNow, currentTiming, soundEnabled: kitchenSoundEnabled, soundProfile: kitchenSoundProfile, soundVolume: kitchenSoundVolume })
  const resetSyncState = () => {
    orderPayment.close()
    clientOrdersPayment.close()
    effectiveConfigVersionRef.current = null
  }
  sessionRuntimeTargetsRef.current.resetSyncState = resetSyncState

  const clearBusinessData = () => {
    setCompanySelectionOpen(false)
    resetNavigation({ preservePath: platformEntryRef.current || provisioningAttempts.hasUnresolved() || managementAttempts.hasUnresolved() })
    resetQueries()
    resetComandaSelection()
    resetSyncState()
    resetOrderArrivals()
    newOrderDraft.reset(); refund.reset()
    setEditSettlement(null); setEditSettlementBusy(false); setEditSettlementError('')
    editSettlementAttemptRef.current=null
    setEditedPrintPrompt(null)
    setToastMessage(''); setSuccessMessage('')
  }
  sessionRuntimeTargetsRef.current.clearApplicationState = clearBusinessData

  const selectCurrentComanda = (target) => {
    const currentTables = getOfficialTables()
    const identity = resolveOpenComanda(currentTables, target)
    if (!identity) {
      setToastMessage('A comanda mudou ou não está mais disponível. A consulta foi atualizada.')
      void refreshBootstrapSilently()
      return false
    }
    return selectComanda(identity, currentTables)
  }

  newOrderDraftTargetsRef.current = {
    canSubmit: (payload, context) => (context?.mode === 'edit-order' ? canEditOrders : canCreateOrders)
      && (context?.mode === 'edit-order' || canAdjustOrders || !payload?.adjustment || payload.adjustment.type === 'none')
      && !writesBlocked,
    commitOfficialEffects: applyOfficialEffects,
    onCommitted: (result, context, intent = 'save') => {
      const { order, tableTab, tables: nextTables } = result || {}
      if (context.returnDestination === 'comandas' && tableTab?.id) {
        const table = nextTables?.find((item) => item.isActive && item.occupancy === 'occupied' && item.openTableTab?.id === tableTab.id)
        const identity = table
          ? resolveOpenComanda(nextTables, { tableId: table.id, tableTabId: tableTab.id })
          : null
        if (identity) selectComanda(identity, nextTables)
      }
      if (context.mode === 'create' && order?.id) printing.rememberOriginOrder(order.id)
      if (context.mode === 'edit-order' && order?.id) {
        const print=canExecutePrinting &&
          Number(order.contentRevision || 0) > Number(context.orderContext?.expectedContentRevision || 0)
          ? {orderId:order.id,orderNumber:order.orderNumber,owner:accessContextId} : null
        const changedTotal = Number(order.totalCents) !== Math.round(Number(context.orderContext?.originalTotal || 0)*100)
        const canOfferMoney = changedTotal && ((order.dueCents || 0)>0 || (order.refundDueCents || 0)>0)
        if ((intent!=='save' || canOfferMoney) && order.totalCents != null) {
          setEditSettlement({
            owner:accessContextId,guard:getSyncGuard(),order,print,
            stage:intent==='receive' && (order.dueCents || 0)>0 && canReceivePayments ? 'receive'
              :intent==='refund' && (order.refundDueCents || 0)>0 && canRefundPayments ? 'refund' : 'offer',
          })
          setEditSettlementError('')
          editSettlementAttemptRef.current=null
        } else if(print) {
          setEditedPrintPrompt(print)
        }
      }
      completeNavigation(context.returnDestination)
    },
    onSuccess: (order, context) => {
      if (context?.mode === 'edit-order') {
        showSuccessMessage('Pedido atualizado com sucesso')
        return
      }
      if (context?.mode === 'edit-reservation') {
        showSuccessMessage('Reserva atualizada com sucesso')
        return
      }
      showSuccessMessage(order.paymentStatus === 'Pago'
        ? 'Pedido salvo e pagamento recebido'
        : (order.status === 'Finalizado' ? 'Pedido anterior salvo no histórico' : 'Pedido enviado para a fila da cozinha'))
    },
    onConflict: async () => { await refreshBootstrapSilently() },
  }

  const finishEditSettlement=()=>{
    if(!editSettlement || editSettlementBusy)return false
    const pendingPrint=editSettlement.print
    setEditSettlement(null)
    setEditSettlementError('')
    editSettlementAttemptRef.current=null
    if(pendingPrint && pendingPrint.owner===accessContextId)setEditedPrintPrompt(pendingPrint)
    return true
  }
  const submitEditSettlement=async(type,values)=>{
    const target=editSettlement
    if(!target || target.owner!==accessContextId || target.guard!==getSyncGuard()
      || editSettlementBusy || writesBlocked)return false
    const order=target.order
    const serialized=JSON.stringify({type,orderId:order.id,
      contentRevision:order.contentRevision,totalCents:order.totalCents,
      netReceivedCents:order.netReceivedCents,values})
    const attempt=editSettlementAttemptRef.current?.serialized===serialized
      ? editSettlementAttemptRef.current : {serialized,mutationId:crypto.randomUUID()}
    editSettlementAttemptRef.current=attempt
    setEditSettlementBusy(true)
    setEditSettlementError('')
    const key='order:edit-settlement:'+order.id
    setRequestKey(key)
    try{
      const result=type==='receive'
        ? order.paymentId
          ? await clientsForContext.payments.registerSupplementalPayment(order.id,{
              mutationId:attempt.mutationId,
              expectedContentRevision:order.contentRevision,
              expectedTotalCents:order.totalCents,
              expectedNetReceivedCents:order.netReceivedCents,
              allocations:values,
            })
          : await clientsForContext.payments.registerOrderPayment(order.id,values)
        : await clientsForContext.refunds.registerPartialRefund(order.id,{
            mutationId:attempt.mutationId,
            expectedContentRevision:order.contentRevision,
            expectedTotalCents:order.totalCents,
            expectedNetReceivedCents:order.netReceivedCents,
            amountCents:values.amountCents,
            refundMethod:values.refundMethod,
          })
      if(target.owner!==sessionOwnerRef.current || target.guard!==getSyncGuard())return false
      if(applyOfficialEffects(result)===false){
        setEditSettlementError('O retorno não pôde ser sincronizado. Atualize o pedido para conferir a situação.')
        await refreshBootstrapSilently()
        return false
      }
      editSettlementAttemptRef.current=null
      if(type==='receive'){
        showSuccessMessage('Saldo complementar recebido com sucesso')
        setEditSettlement(null)
        if(target.print)setEditedPrintPrompt(target.print)
      }else{
        showSuccessMessage('Devolução registrada no Financeiro')
        setEditSettlement(prev=>prev?.owner===target.owner
          ? {...prev,order:result.order,stage:'offer'} : prev)
      }
      return true
    }catch(error){
      if(target.owner!==sessionOwnerRef.current || target.guard!==getSyncGuard())return false
      setEditSettlementError(error?.message || 'Não foi possível registrar esta operação.')
      if(error?.status===409 || !Number.isInteger(error?.status) || error.status>=500)
        await refreshBootstrapSilently()
      return false
    }finally{
      if(target.owner===sessionOwnerRef.current){
        setEditSettlementBusy(false)
        setRequestKey(current=>current===key?null:current)
      }
    }
  }

  operationalRuntimeTargetsRef.current.onUnauthorized = showApiError

  const errorOwnerGuard = getSyncGuard()
  function showApiError(error) {
    if (sessionOwnerRef.current !== accessContextId || errorOwnerGuard !== getSyncGuard()) return
    if (error?.status === 401) return expireSession()
    if (error?.code === 'SESSION_CONTEXT_CHANGED' || (error?.status === 403 && error?.code === 'ACCESS_CHANGED')) return void refreshSession()
    setToastMessage(error?.message || 'Não foi possível concluir a operação.')
  }
  newOrderDraftTargetsRef.current.onError = showApiError
  orderCommandTargetsRef.current.onError = showApiError
  const tableServiceCommands = useTableServiceCommands({
    api: clientsForContext.tables,
    getOfficialTables,
    applyOfficialEffects,
    refreshOfficialData: refreshBootstrapSilently,
    writesBlocked,
    canManageTables,
    canTransfer: canTransferComanda,
    setRequestKey,
    onSuccess: showSuccessMessage,
    onError: showApiError,
    onStaleTarget: setToastMessage,
  })
  const pendingSessionEffectsRef = useRef(null)
  pendingSessionEffectsRef.current = {
    paymentPending: Boolean(tableTabPayment.busy || tableTabPayment.syncState || orderPayment.dialog?.submitting || clientOrdersPayment.dialog?.submitting),
    printPending: Boolean(printing.busyJobId || printing.jobs.some((job) => ['unknown', 'awaiting_confirmation', 'waiting_confirmation', 'printing'].includes(job.status) || job.physicalOutcome === 'unknown')),
  }
  const getPendingSessionEffects = () => ({ ...pendingSessionEffectsRef.current, contextChangePending: contextChangePending || isPlatformPending(), checkoutPending: newOrderDraft.checkoutPending, credentialChangePending: isCredentialChangePending() })
  sessionRuntimeTargetsRef.current.getProvisioningResumePath = () => {
    const effects = getPendingSessionEffects()
    const managementResume = managementAttempts.getSnapshot(sessionContext?.account?.id)
    if (canReconcileManagement && managementResume?.status==='uncertain' && !platformPendingRef.current && !effects.credentialChangePending && !effects.checkoutPending && !effects.paymentPending && !effects.printPending && !newOrderDraft.dirty && !policyNavigationBridge.getNavigationDraft()?.dirty) return `/mesiva/empresas/${encodeURIComponent(managementResume.target.businessId)}`
    return canReconcileProvisioning && provisioningAttempts.getSnapshot(sessionContext?.account?.id)?.status === 'uncertain'
      && !platformPendingRef.current && !effects.credentialChangePending && !effects.checkoutPending && !effects.paymentPending && !effects.printPending && !newOrderDraft.dirty && !policyNavigationBridge.getNavigationDraft()?.dirty
      ? '/mesiva/empresas/nova' : null
  }
  useEffect(() => {
    const path = sessionRuntimeTargetsRef.current.getProvisioningResumePath?.()
    if (authState === 'authenticated' && path && routeLocation.pathname !== path) navigateContext(path, { replace: true })
  }, [authState, sessionContext, provisioningAttempt?.status, managementAttempt?.status, routeLocation.pathname, navigateContext])
  sessionRuntimeTargetsRef.current.canChangeContext = target => {
    const effects = getPendingSessionEffects()
    const resumeAuthor = target?.scope === 'platform' && platformEntryRef.current && !platformPendingRef.current && (provisioningAttempts.getSnapshot(sessionContext?.account?.id)?.status === 'uncertain' || managementAttempts.getSnapshot(sessionContext?.account?.id)?.status === 'uncertain')
    return (!isPlatformPending() || resumeAuthor) && !effects.credentialChangePending && !effects.checkoutPending && !effects.paymentPending && !effects.printPending && !newOrderDraft.dirty && !policyNavigationBridge.getNavigationDraft()?.dirty
  }
  const handleLogout = () => requestSessionExit(handleSessionLogout, getPendingSessionEffects)
  const handleSwitchUser = () => requestSessionExit(handleSessionLogout, getPendingSessionEffects)
  const handleSwitchCompany = () => requestSessionExit(() => { setCompanySelectionOpen(true); return completeContextNavigation(ACCOUNT_CONTEXT_PATHS.companies) }, getPendingSessionEffects)
  const handlePlatform = () => requestSessionExit(async () => { if (await selectPlatform()) navigateContext(ACCOUNT_CONTEXT_PATHS.platform); return true }, getPendingSessionEffects)

  const handleKitchenSoundEnabledChange = (enabled) => {
    if (!canUseLocalPreferences) return false
    const nextEnabled = Boolean(enabled)
    try { writeKitchenSoundPreference(nextEnabled) } catch {
      setToastMessage('Não foi possível salvar esta preferência neste dispositivo.')
      return false
    }
    setKitchenSoundEnabled(nextEnabled)
    if (nextEnabled) void previewKitchenOrderSound(kitchenSoundProfile, kitchenSoundVolume)
    return true
  }
  const handleKitchenSoundProfileChange = (profile) => {
    if (!canUseLocalPreferences) return false
    try { writeKitchenSoundProfilePreference(profile) } catch {
      setToastMessage('Não foi possível salvar esta preferência neste dispositivo.')
      return false
    }
    setKitchenSoundProfile(profile)
    return true
  }
  const handleKitchenSoundVolumeChange = (volume) => {
    if (!canUseLocalPreferences) return false
    try { writeKitchenSoundVolumePreference(volume) } catch {
      setToastMessage('Não foi possível salvar esta preferência neste dispositivo.')
      return false
    }
    setKitchenSoundVolume(volume)
    return true
  }
  const handleKitchenSoundPreview = (profile = kitchenSoundProfile, volume = kitchenSoundVolume) => {
    if (!canUseLocalPreferences) return false
    void previewKitchenOrderSound(profile, volume)
    return true
  }

  const pendingRefundOrders = useMemo(() => orders.filter((order) =>
    getOrderRefundState(order) === 'pending' || (
      ['Em preparo','Finalizado'].includes(order.status)
      && Boolean(order.paymentId)
      && Number.isSafeInteger(order.refundDueCents) && order.refundDueCents > 0
    )), [orders])
  const handleNewOrder = ({ tableId = '', expectedTableTabId = '', returnTab = 'orders', clientId = '' } = {}) => {
    if (!canCreateOrders || writesBlocked) return false
    let currentTableId = tableId
    if (expectedTableTabId) {
      const currentTables = getOfficialTables()
      const selectionOwner = getComandaSelectionOwner()
      const candidate = selectionOwner?.tableTabId === expectedTableTabId
        ? { tableId: selectionOwner.tableId, tableTabId: expectedTableTabId }
        : { tableId, tableTabId: expectedTableTabId }
      const identity = resolveOpenComanda(currentTables, candidate)
      if (!identity) {
        clearComandaSelection()
        setToastMessage('A comanda mudou ou não está mais disponível. A consulta foi atualizada.')
        void refreshBootstrapSilently()
        completeNavigation(returnTab)
        return
      }
      currentTableId = identity.tableId
      const alreadySelected = selectionOwner?.tableId === identity.tableId
        && selectionOwner?.tableTabId === identity.tableTabId
      if (!alreadySelected) selectComanda(identity, currentTables)
    }
    const selectedCustomerId = clients.some(client => client.id === clientId) ? clientId : ''
    newOrderDraft.open({ tableId: currentTableId, expectedTableTabId, returnDestination: returnTab, initialDraft: selectedCustomerId ? { clientId: selectedCustomerId, localClientId: selectedCustomerId } : null })
    return completeNavigation('new-order')
  }
  const handleEditOrder = (order) => {
    if (!canEditOrders || writesBlocked) return false
    const current = orders.find(item => item.id === order?.id)
    const opened = newOrderDraft.openOrderEdit(current, { returnDestination: 'orders' })
    return opened ? completeNavigation('new-order') : false
  }
  const handleEditReservation = (detail) => {
    if (!canCreateOrders || writesBlocked) return false
    const opened = newOrderDraft.openReservationEdit(detail, { returnDestination: 'comandas' })
    if (!opened) return false
    return completeNavigation('new-order')
  }
  const handleEditFutureReservation = async (order) => {
    if (!canCreateOrders || writesBlocked || !order?.tableReservationId) return false
    try {
      const owner = sessionOwnerRef.current
      const detail = await clientsForContext.reservations.getReservation(order.tableReservationId)
      if (owner !== sessionOwnerRef.current) return false
      const opened = newOrderDraft.openReservationEdit(detail, { returnDestination: 'orders' })
      if (!opened) return false
      return completeNavigation('new-order')
    } catch (error) {
      showApiError(error)
      return false
    }
  }

  const handleOpenComanda = (target) => {
    if (!canOpenComanda) return false
    const currentTables = getOfficialTables()
    const identity = resolveOpenComanda(currentTables, target)
    if (!identity) {
      setToastMessage('A comanda mudou ou não está mais disponível. A consulta foi atualizada.')
      void refreshBootstrapSilently()
      return false
    }
    if (!requestNavigation('comandas')) return false
    return selectComanda(identity, currentTables)
  }
  const activeMobileEntry = activeTab === 'new-order' ? newOrderDraft.context?.returnDestination : undefined
  const resolveActivityOrder = (item) => {
    if (!operationalAccess || item.resourceType !== 'order') return null
    const order = orders.find(candidate => String(candidate.id) === String(item.resourceId))
    if (!order) return null
    return hasCapability(granted, ['Finalizado', 'Cancelado'].includes(order.status) ? 'orders.history' : 'orders.view') ? order : null
  }
  const accessProps = { section: activeTab, sessionContext, refreshSession, runCredentialChange, onApiError: showApiError, writesBlocked,
    canOpenResource: (item) => Boolean(resolveActivityOrder(item)),
    onOpenResource: (item) => { const order = resolveActivityOrder(item); if (order) setActivityDetail({ owner: accessContextId, orderId: order.id }) },
  }
  const activityOrder = activityDetail?.owner === accessContextId && activeTab === 'access-activity'
    ? resolveActivityOrder({ resourceType: 'order', resourceId: activityDetail.orderId }) : null

  const listedCompanies = companyList.owner === sessionContext?.contextId ? companyList : { items: [], loading: true, error: '' }
  const inPlatform = globalSession && sessionContext.scope === 'platform'
  const contextSurface = (choosingCompany || inPlatform) && routeLocation.pathname === '/minha-conta'
    ? <main className="company-entry company-account-entry"><Button variant="secondary" disabled={writesBlocked || contextChangePending} onClick={() => completeContextNavigation(inPlatform ? ACCOUNT_CONTEXT_PATHS.platform : ACCOUNT_CONTEXT_PATHS.companies, { replace: true })}>Voltar</Button>{renderAccessSurface({ ...accessProps, section: 'my-account' })}</main>
    : choosingCompany
      ? <CompanySelection account={sessionContext.account} items={listedCompanies.items} currentBusinessId={sessionContext.businessId} loading={listedCompanies.loading} pending={contextChangePending} error={listedCompanies.error || loginError} onRetry={loadCompanies} onLogout={handleLogout} onAccount={() => { setCompanySelectionOpen(true); completeContextNavigation('/minha-conta') }} onSelect={async id => { if (await selectBusiness(id)) { setCompanySelectionOpen(false); if (routeLocation.pathname === ACCOUNT_CONTEXT_PATHS.companies) navigateContext('/', { replace: true }) } }} onCancel={sessionContext.scope === 'business' ? () => { setCompanySelectionOpen(false); navigateContext('/', { replace: true }) } : undefined} onPlatform={sessionContext.platformCapabilities?.includes('platform.businesses.view') ? handlePlatform : undefined} />
      : inPlatform
        ? <PlatformRoutes attempts={provisioningAttempts} managementAttempts={managementAttempts} isOnline={isOnline} session={sessionContext} path={routeLocation.pathname} pending={platformPending || contextChangePending} onPendingChange={changePlatformPending} onNavigate={path => { if (!isPlatformPending()) navigateContext(path) }} onLogout={handleLogout} onAccount={() => { if (!isPlatformPending()) navigateContext('/minha-conta') }} onSelectBusiness={() => { if (!isPlatformPending()) { setCompanySelectionOpen(true); navigateContext(ACCOUNT_CONTEXT_PATHS.companies) } }} />
        : platformEntry ? <main className="company-entry"><p role="alert">{globalSession && sessionContext.platformCapabilities?.includes('platform.businesses.view') ? loginError || 'Confirmando acesso ao painel Mesiva…' : 'Você não tem acesso ao painel Mesiva.'}</p></main> : null
  return (
    <ContextApi.Provider value={contextClient}><AppRoot
      contextSurface={contextSurface}
      isOnline={isOnline}
      authState={authState}
      authMode={authMode}
      operationalAccess={operationalAccess}
      loginLoading={requestKey === 'auth:login'}
      loginError={loginError}
      onLogin={credentials => handleLogin(platformEntry && typeof credentials === 'object' ? { ...credentials, destination: 'platform' } : credentials)}
      bootstrapState={operationalBootstrapState}
      onRetryBootstrap={() => void refreshBootstrap()}
      retryDisabled={!isOnline || requestKey !== null}
      toastMessage={toastMessage}
      successMessage={successMessage}
    >
      {!operationalAccess ? (
        <NavigationProvider activeTab={activeTab} granted={granted} authenticated={authState === 'authenticated' && Boolean(sessionContext?.user?.id)} implemented={IMPLEMENTED_DESTINATIONS} moreOpen={moreOpen} requestNavigation={requestNavigation} openMore={openMore} closeMore={closeMore}>
          <AppShell user={sessionContext?.user} onSwitchUser={handleSwitchUser} onLogout={handleLogout} logoutDisabled={writesBlocked}>
            <p>Sua conta está ativa; o acesso operacional aguarda liberação.</p>
            {activeTab === 'settings-home' ? <SettingsHome granted={granted} implemented={IMPLEMENTED_DESTINATIONS} onNavigate={requestNavigation} businessName={business?.name} user={sessionContext?.user} /> : renderAccessSurface
              ? renderAccessSurface(accessProps)
              : <section><h1>{activeTab === 'access-team' ? 'Equipe e acessos' : 'Minha conta'}</h1><p>Sua conta está ativa; o acesso operacional aguarda liberação.</p></section>}
          </AppShell>
        </NavigationProvider>
      ) : <SettingsPolicyBoundary key={accessContextId}
        client={contextClient}
        effectiveConfigOwner={effectiveConfigOwner}
        storage={getSessionStorage()}
        navigationBridge={policyNavigationBridge}
        onFeedback={(feedback) => {
          if (feedback?.status === 'confirmed') return
          if (feedback?.status) showApiError(feedback)
          else if (feedback?.message) setToastMessage(feedback.message)
        }}
        onSessionExpired={expireSession}
        onPolicyCommitted={({ policyId }) => {
          effectiveConfig.refresh()
          if (policyId === 'businessProfile') void refreshBootstrapSilently()
        }}
      >
      <NavigationProvider authenticated={authState === 'authenticated' && Boolean(sessionContext?.user?.id)} activeTab={activeTab} activeMobileEntry={activeMobileEntry} granted={granted} implemented={IMPLEMENTED_DESTINATIONS} moreOpen={moreOpen} requestNavigation={requestNavigation} openMore={openMore} closeMore={closeMore}>
      <AppShell user={sessionContext?.user} onSwitchUser={handleSwitchUser} onSwitchCompany={globalSession && sessionContext?.eligibleBusinessCount > 1 ? handleSwitchCompany : undefined} onPlatform={globalSession && sessionContext.platformCapabilities?.includes('platform.businesses.view') ? handlePlatform : undefined} businessId={sessionContext?.businessId} businessName={business?.name} businessHasLogo={business?.hasLogo} businessLogoVersion={business?.logoVersion} navigationBadges={{ orders: operationalOrderCount, comandas: openComandaCount, 'print-queue': printing.activeJobCount }} onLogout={handleLogout} logoutDisabled={writesBlocked}>
        {['my-account', 'access-team', 'access-activity'].includes(activeTab) && renderAccessSurface(accessProps)}
        {activityOrder && <OrderDetail order={activityOrder} currency={currency} onClose={() => setActivityDetail(null)} canExecutePrinting={false} canCancelOrders={false} />}
        {activeTab === 'dashboard' && <DashboardSurface orders={orders} movements={movements} currency={currency} queryState={query.dashboard} onQueryChange={(patch) => patchQuery('dashboard', patch)} />}
        {activeTab === 'reports' && <ReportingWorkspace granted={granted} onOpenClient={canViewClients ? (client) => { patchQuery('clients', { search: client?.name || '' }); requestNavigation('clients') } : null} />}
        {activeTab === 'orders' && <Orders orders={orders} officialOrders={orders} now={kitchenNow} currentTiming={currentTiming} search={query.orders.search} onSearchChange={(search) => patchQuery('orders', { search })} currency={currency} onNewOrder={handleNewOrder} onFinalizeOrder={orderCommands.finalizeOrder} onCancelOrder={orderCommands.cancelOrder} onRegisterPayment={orderPayment.open} paymentDisabled={writesBlocked} paymentOptions={paymentOptions} cancellationOptions={cancellationOptions} cancellationRevision={cancellationRevision} onNavigatePrintQueue={() => requestNavigation('print-queue')} printQueueActiveCount={printing.activeJobCount} granted={granted} newOrderIds={newOrderIds} soundEnabled={kitchenSoundEnabled} onSoundEnabledChange={handleKitchenSoundEnabledChange} printing={printing} onToast={setToastMessage} canCreateOrders={canCreateOrders} canFinalizeOrders={canFinalizeOrders} canCancelOrders={canCancelOrders} canRefundPayments={canRefundPayments} canUseLocalPreferences={canUseLocalPreferences} canViewPrintQueue={canViewPrintQueue} canForcePrinting={canForcePrinting} canExecutePrinting={canExecutePrinting} onEditReservation={handleEditFutureReservation} onEditOrder={handleEditOrder} canEditOrders={canEditOrders} />}
        {activeTab === 'history' && <OrderHistory orders={orders} currentTiming={currentTiming} currency={currency} onCancelOrder={orderCommands.cancelOrder} onRegisterPayment={orderPayment.open} paymentDisabled={writesBlocked} paymentOptions={paymentOptions} cancellationOptions={cancellationOptions} cancellationRevision={cancellationRevision} actionKey={orderCommands.actionKey} printing={printing} onToast={setToastMessage} queryState={query.history} onQueryChange={(patch) => patchQuery('history', patch)} granted={granted} canViewAnalysis={canViewOperationalAnalysis} canCancelOrders={canCancelOrders} canRefundPayments={canRefundPayments} canForcePrinting={canForcePrinting} canExecutePrinting={canExecutePrinting} />}
        {activeTab === 'kitchen-tv-control' && <KitchenTvControlSurface orders={orders} now={kitchenNow} currentTiming={currentTiming} granted={granted} isOnline={isOnline} onNavigate={requestNavigation} onFeedback={setToastMessage} />}
        {activeTab === 'new-order' && newOrderDraft.context && <NewOrderRoute key={newOrderDraft.renderKey ?? 'new-order'} clients={clients} products={products} tables={tables} mode={newOrderDraft.context?.mode || 'create'} orderContext={newOrderDraft.context?.orderContext || null} reservationContext={newOrderDraft.context?.reservationContext || null} initialDraft={newOrderDraft.context?.initialDraft || null} initialTableId={newOrderDraft.context?.tableId || ''} expectedTableTabId={newOrderDraft.context?.expectedTableTabId || ''} currency={currency} disabled={writesBlocked} renderPaymentComposition={(props) => <CheckoutPaymentComposition {...props} paymentOptions={paymentOptions} defaultPaymentMethod={defaultPaymentMethod} />} modalityOptions={modalityOptions} defaultModality={defaultModality} onPolicyChanged={effectiveConfig.refresh} onCancel={() => requestNavigation(newOrderDraft.context?.returnDestination || 'orders')} onCreateClient={quickCreateCustomer} onSubmit={newOrderDraft.submit} onDraftDirtyChange={newOrderDraft.setDirty} canCreateClients={canCreateClients} canAdjustOrders={canAdjustOrders} canBackdateOrders={canBackdateOrders} canReceivePayments={canReceivePayments} canRefundPayments={canRefundPayments} />}
        {activeTab === 'clients' && <CustomersWorkspace clients={clients} orders={orders} granted={granted} currency={currency} onRegisterPayment={orderPayment.open} onRegisterClientOrdersPayment={clientOrdersPayment.open} onNewOrder={client => handleNewOrder({ clientId: client.id, returnTab: 'clients' })} printing={printing} onToast={setToastMessage} search={query.clients.search} sort={query.clients.sort} onSearchChange={(search) => patchQuery('clients', { search })} onSortChange={(sort) => patchQuery('clients', { sort })} writesBlocked={writesBlocked} canCreateClients={canCreateClients} canUpdateClients={canUpdateClients} canDeleteClients={canDeleteClients} applyOfficialEffects={applyOfficialEffects} setRequestKey={setRequestKey} onSuccess={showSuccessMessage} onError={showApiError} onDuplicatePhone={setToastMessage} />}
        <CatalogWorkspace visible={activeTab === 'products'} products={products} search={query.products.search} queryState={query.products} onSearchChange={(search) => patchQuery('products', { search })} onQueryChange={(patch) => patchQuery('products', patch)} currency={currency} writesBlocked={writesBlocked} canManageProducts={canManageProducts} applyOfficialEffects={applyOfficialEffects} setRequestKey={setRequestKey} onSuccess={showSuccessMessage} onError={showApiError} />
        {activeTab === 'print-queue' && <PrintQueue orders={orders} printing={printing} reviewJobId={printQueueReviewJobId} onReviewJobConsumed={() => setPrintQueueReviewJobId(null)} onOpenPrintingSettings={canOpenPrintingSettings ? () => requestNavigation('settings-printing') : undefined} onToast={setToastMessage} queryState={query.printQueue} onQueryChange={(patch) => patchQuery('printQueue', patch)} canExecutePrinting={canExecutePrinting} canForcePrinting={canForcePrinting} canDiscardPrinting={canDiscardPrinting} isOnline={isOnline} />}
        {activeTab === 'receivables' && <ReceivablesSurface orders={orders} movements={movements} currency={currency} disabled={writesBlocked} onRegisterPayment={orderPayment.open} onRegisterClientOrdersPayment={clientOrdersPayment.open} onOpenClient={canViewClients ? (client) => { patchQuery('clients', { search: client?.name || '' }); requestNavigation('clients') } : null} queryState={query.receivables} onQueryChange={(patch) => patchQuery('receivables', patch)} canReceivePayments={canReceivePayments} canManagePaymentPromises={canManagePaymentPromises} canExecutePrinting={canExecutePrinting} applyOfficialEffects={applyOfficialEffects} setRequestKey={setRequestKey} onSuccess={showSuccessMessage} onError={showApiError} />}
        {activeTab === 'finance' && <FinanceWorkspace movements={movements} financeSettings={financeSettings} today={todayValue} currency={currency} pendingRefundOrders={pendingRefundOrders} paymentOptions={paymentOptions} categoryOptions={financeCategoryOptions} categoryRevision={financeCategoryRevision} writesBlocked={writesBlocked} canManageMovements={canManageMovements} canRefundPayments={canRefundPayments} applyOfficialEffects={applyOfficialEffects} setRequestKey={setRequestKey} onSuccess={showSuccessMessage} onError={showApiError} formatCancellationDate={formatCancellationDate} onRequestRefund={order => {
            if (order?.status !== 'Cancelado' && Number(order?.refundDueCents) > 0) {
              if (!canRefundPayments || writesBlocked) return false
              setEditSettlement({owner:accessContextId,guard:getSyncGuard(),
                order,stage:'refund',source:'finance',print:null})
              setEditSettlementError('')
              editSettlementAttemptRef.current=null
              return true
            }
            return refund.request(order)
          }} />}
        {activeTab === 'tables' && <Tables tables={tables} disabled={writesBlocked} canOpenComanda={canOpenComanda} onCreate={tableServiceCommands.createTable} onRename={tableServiceCommands.renameTable} onSetActive={tableServiceCommands.setTableActive} onReorder={tableServiceCommands.reorderTables} onOpenComanda={handleOpenComanda} canManageTables={canManageTables} />}
        {activeTab === 'comandas' && (
          <TableServiceExternalActions
            selection={selectedComanda}
            selectionGeneration={selectedComandaGeneration}
            disabled={writesBlocked || tableTabPayment.busy}
            paymentOptions={paymentOptions}
            defaultPaymentMethod={defaultPaymentMethod}
            currency={currency}
            onPay={tableTabPayment.pay}
            onApiError={showApiError}
            onToast={setToastMessage}
            printing={printing}
          >
            {({ requestPayment, requestPreview, requestPrint, printingBusy, printingFeedback, printingAvailable }) => (
              <Comandas
                tables={tables}
                selection={selectedComanda}
                selectionGeneration={selectedComandaGeneration}
                onSelectComanda={selectCurrentComanda}
                onAddOrder={(owner) => handleNewOrder({ tableId: owner.tableId, expectedTableTabId: owner.tableTabId, returnTab: 'comandas' })}
                canTransfer={canTransferComanda}
                onTransfer={tableServiceCommands.transferTableTab}
                onApiError={showApiError}
                onEditReservation={handleEditReservation}
                onConfirmReservationArrival={reservationCommands.confirmArrival}
                onCancelReservation={reservationCommands.cancelReservation}
                onMarkReservationNoShow={reservationCommands.markNoShow}
                reservationActionKey={reservationCommands.actionKey}
                canCancelOrders={canCancelOrders}
                cancellationOptions={cancellationOptions}
                cancellationRevision={cancellationRevision}
                currentTiming={currentTiming}
                now={operationalNow}
                onRequestPayment={requestPayment}
                onRequestPreview={requestPreview}
                onRequestPrint={requestPrint}
                printingBusy={printingBusy}
                printingFeedback={printingFeedback}
                printingAvailable={printingAvailable}
                paymentSync={tableTabPayment.syncState}
                onRetryPaymentSync={tableTabPayment.retrySync}
                currency={currency}
                disabled={writesBlocked}
                canCreateOrders={canCreateOrders}
                canExecutePrinting={canExecutePrinting}
              />
            )}
          </TableServiceExternalActions>
        )}
        {(activeTab === 'settings-home' || activeTab === 'settings-business-profile' || activeTab === 'settings-operations' || activeTab === 'settings-modalities' || activeTab === 'settings-payments' || activeTab === 'settings-cancellations' || activeTab === 'settings-finance-categories' || activeTab === 'settings-kitchen-tv' || activeTab === 'settings-printing' || activeTab === 'settings-device') && <SettingsSurface section={activeTab} businessName={business?.name} user={sessionContext?.user} printing={printing} granted={granted} implemented={IMPLEMENTED_DESTINATIONS} onNavigate={requestNavigation} soundEnabled={kitchenSoundEnabled} soundProfile={kitchenSoundProfile} soundVolume={kitchenSoundVolume} onSoundEnabledChange={handleKitchenSoundEnabledChange} onSoundProfileChange={handleKitchenSoundProfileChange} onSoundVolumeChange={handleKitchenSoundVolumeChange} onPreviewSound={handleKitchenSoundPreview} onSuccessMessage={showSuccessMessage} writesBlocked={writesBlocked} />}

        {pendingDestination && (
          <Modal title={pendingDiscardKind === 'policy' ? 'Descartar alterações?' : 'Descartar venda em andamento?'} onClose={handleCancelDiscard}>
            <div className="form-stack">
              <p>{pendingDiscardKind === 'policy'
                ? 'As alterações ainda não salvas serão descartadas.'
                : 'As informações preenchidas e os produtos adicionados serão descartados.'}</p>
              <div className="form-actions">
                <Button type="button" variant="secondary" onClick={handleCancelDiscard}>{pendingDiscardKind === 'policy' ? 'Continuar editando' : 'Continuar na venda'}</Button>
                <Button type="button" onClick={confirmDiscard}>{pendingDiscardKind === 'policy' ? 'Descartar alterações' : 'Descartar venda'}</Button>
              </div>
            </div>
          </Modal>
        )}


        {editSettlement && editSettlement.owner === accessContextId && <OrderEditSettlementDialog
          order={editSettlement.order} stage={editSettlement.stage} source={editSettlement.source}
          canReceivePayments={canReceivePayments} canRefundPayments={canRefundPayments}
          paymentOptions={paymentOptions} defaultPaymentMethod={defaultPaymentMethod}
          submitting={editSettlementBusy} writesBlocked={writesBlocked}
          error={editSettlementError}
          onStageChange={stage=>{setEditSettlement(s=>s&&({...s,stage}));setEditSettlementError('')}}
          onClose={finishEditSettlement}
          onReceive={allocations=>void submitEditSettlement('receive',allocations)}
          onRefund={refund=>void submitEditSettlement('refund',refund)}
        />}
        {editedPrintPrompt && editedPrintPrompt.owner === accessContextId && <Modal
          title="Pedido atualizado com sucesso"
          className="order-edit-print-modal"
          initialFocusSelector=".order-edit-print-decline"
          onClose={() => { if (!editedPrintBusy) setEditedPrintPrompt(null) }}>
          <div className="order-edit-print-layout">
            <div className="order-edit-print-message">
              <span className="order-edit-print-check" aria-hidden="true"><Icon name="check" size={22} /></span>
              <div>
                <strong>Alterações salvas!</strong>
                <p>Deseja reimprimir o pedido com todos os itens atualizados?</p>
              </div>
            </div>
            <div className="order-edit-print-hint">
              <Icon name="printer" size={19} />
              <span>A reimpressão é opcional. O pedido já está salvo e não será alterado.</span>
            </div>
            <div className="order-edit-print-actions">
              <Button type="button" variant="secondary" className="order-edit-print-decline" disabled={editedPrintBusy}
                onClick={() => setEditedPrintPrompt(null)}>Não, obrigado</Button>
              <Button type="button" icon="printer" disabled={editedPrintBusy || !canExecutePrinting || writesBlocked}
                onClick={async () => {
                  if (!editedPrintPrompt || editedPrintBusy || !canExecutePrinting || writesBlocked) return
                  setEditedPrintBusy(true)
                  try {
                    await printing.printOrder(editedPrintPrompt.orderId)
                    setEditedPrintPrompt(null)
                    showSuccessMessage('Reimpressão enviada para a fila')
                  } catch(error) {
                    setEditedPrintPrompt(null)
                    showApiError(error)
                  } finally {setEditedPrintBusy(false)}
                }}>{editedPrintBusy ? 'Enviando…' : 'Reimprimir pedido completo'}</Button>
            </div>
          </div>
        </Modal>}
        {orderPayment.dialog && <OrderPaymentDialog dialog={orderPayment.dialog} currency={currency} />}
        {clientOrdersPayment.dialog && <ClientOrdersPaymentDialog dialog={clientOrdersPayment.dialog} currency={currency} />}

        <RegisterRefundDialog open={canRefundPayments && Boolean(refund.refundOrder)} order={refund.refundOrder} paymentOptions={paymentOptions} onClose={refund.close} onConfirm={refund.confirm} submitting={refund.submitting} />
      </AppShell>
      </NavigationProvider>
      </SettingsPolicyBoundary>}

      <PrintingOverlays
        printing={printing}
        orders={orders}
        authenticated={operationalAccess && authState === 'authenticated'}
        canExecutePrinting={canExecutePrinting}
        canDiscardPrinting={canDiscardPrinting}
        onReviewPrintJob={canViewPrintQueue ? (jobId) => {
          setPrintQueueReviewJobId(jobId)
          requestNavigation('print-queue')
        } : undefined}
        onError={showApiError}
        onSuccess={showSuccessMessage}
      />
    </AppRoot></ContextApi.Provider>
  )
}

function CompanyInvitationRoute({ location, navigate }) {
  const runtime = useSessionRuntime()
  return <CompanyInvitationAccept location={location} session={runtime.sessionContext} sessionChecking={runtime.authState === 'checking'} loginError={runtime.loginError} onLogin={runtime.handleLogin} onLogout={runtime.handleLogout} onAccepted={() => navigate('/', { replace: true })} />
}

export default function App(props) {
  const location = useLocation()
  const navigate = useNavigate()
  if (location.pathname === ACCOUNT_CONTEXT_PATHS.invitation) return <CompanyInvitationRoute location={location} navigate={navigate} />
  if (location.pathname === '/recuperar-senha') return <PasswordRecovery onLogin={() => navigate('/', { replace: true })} />
  if (['/ativar-conta','/redefinir-senha'].includes(location.pathname)) return <InvitationAccept key={location.key} location={location} expectedPurpose={location.pathname==='/redefinir-senha'?'password_reset':'activation'} onLogin={() => navigate('/', { replace: true })} />
  return <ApplicationRuntime {...props} />
}
