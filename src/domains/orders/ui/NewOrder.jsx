import { useEffect, useMemo, useRef, useState } from 'react'
import './new-order.css'
import './new-order-refined.css'
import { ClientDuplicateModal, findClientDuplicates } from '../../customers/index.js'
import { getBusinessDate } from '../../../../shared/finance.js'
import { validateCustomerIdentity } from '../../../../shared/orderCustomerIdentity.js'
import Button from '../../../shared/ui/Button'
import NewOrderCustomerStep from './components/NewOrderCustomerStep'
import NewOrderProductsStep from './components/NewOrderProductsStep'
import NewOrderReviewStep from './components/NewOrderReviewStep'
import NewOrderStepIndicator from './components/NewOrderStepIndicator'
import PageHeader from '../../../shared/ui/PageHeader'
import {
  addCartItem,
  addEditCartItem,
  buildOrderEditPayload,
  buildOrderPayload,
  commitEditCartItemNote,
  decrementEditCartProduct,
  updateEditCartItem,
  calculateOrderPreview,
  commitCartItemNote,
  decrementCartProduct,
  editCartItemNote,
  removeCartItem,
  updateCartItem,
} from '../domain/orderCart.js'
import { formatBRLCurrencyValue, formatPhone, parseBRLCurrencyInput } from '../../../shared/utils/formFormatting.js'
import {
  NEW_ORDER_STEPS,
  canNavigateToNewOrderStep,
  createNewOrderDirtySnapshot,
  getFurthestReachedStep,
  getNewOrderScheduleState,
  getNewOrderStepAccess,
  getOrderItemCount,
  getOrderItemsSubtotal,
  isNewOrderDraftDirty,
} from '../domain/newOrderStepFlow.js'
import { businessDateTimeToIso, getScheduleMaxBusinessDate } from '../../../../shared/orderTiming.js'
import { ORDER_TYPE_OPTIONS } from '../domain/orderTypeOptions.js'

const emptyAdjustment = () => ({ type: 'none', mode: 'fixed', value: formatBRLCurrencyValue(0), reason: '' })
const initialAdjustment = (value) => {
  const source = value || {}
  if (!['discount', 'surcharge'].includes(source.type)) return emptyAdjustment()
  const mode = source.mode === 'percentage' ? 'percentage' : 'fixed'
  return {
    type: source.type,
    mode,
    value: mode === 'fixed'
      ? formatBRLCurrencyValue(Number(source.value) || 0)
      : String(Number(source.value) || 0),
    reason: source.reason || '',
  }
}

function NewOrder({
  submitting = false,
  clients,
  products,
  tables = [],
  mode = 'create',
  reservationContext = null,
  orderContext = null,
  initialDraft = null,
  initialType = 'Entrega',
  initialTableId = '',
  expectedTableTabId = '',
  currency,
  disabled,
  canCreateClients = true,
  canAdjustOrders = true,
  canBackdateOrders = true,
  canReceivePayments = false,
  canRefundPayments = false,
  renderPaymentComposition,
  modalityOptions,
  defaultModality,
  onPolicyChanged,
  onCancel,
  onCreateClient,
  onSubmit,
  onDraftDirtyChange,
}) {
  const editReservationMode = mode === 'edit-reservation'
  const editOrderMode = mode === 'edit-order'
  const activeModalityOptions = editReservationMode
    ? ORDER_TYPE_OPTIONS.filter((option) => option.value === 'Local')
    : (modalityOptions === undefined ? ORDER_TYPE_OPTIONS : modalityOptions)
  const activeModalityValues = new Set(activeModalityOptions.map((option) => option.value))
  const initialCommonType = activeModalityValues.has(defaultModality)
    ? defaultModality
    : activeModalityValues.has(initialType)
      ? initialType
      : activeModalityOptions[0]?.value || (modalityOptions === undefined ? initialType : '')
  const initialStep = editOrderMode ? NEW_ORDER_STEPS.PRODUCTS : editReservationMode ? NEW_ORDER_STEPS.CUSTOMER : (initialTableId ? NEW_ORDER_STEPS.PRODUCTS : NEW_ORDER_STEPS.CUSTOMER)
  const [currentStep, setCurrentStep] = useState(initialStep)
  const [maxReachedStep, setMaxReachedStep] = useState(initialStep)
  const initialClientId = initialDraft?.clientId || ''
  const initialLocalClientId = initialDraft?.localClientId || ''
  const initialClientName = clients.find((client) => client.id === initialClientId)?.name || ''
  const initialLocalClientName = clients.find((client) => client.id === initialLocalClientId)?.name || ''
  const [clientId, setClientId] = useState(initialClientId)
  const [clientSearch, setClientSearch] = useState(initialClientName)
  const [clientPickerOpen, setClientPickerOpen] = useState(false)
  const [type, setType] = useState(initialDraft?.type || (initialTableId ? 'Local' : initialCommonType))
  const [selectedTableId, setSelectedTableId] = useState(initialDraft?.selectedTableId || initialTableId)
  const [localClientId, setLocalClientId] = useState(initialLocalClientId)
  const [localClientSearch, setLocalClientSearch] = useState(initialLocalClientName)
  const [orderDate, setOrderDate] = useState(initialDraft?.orderDate || getBusinessDate())
  const [scheduleMode, setScheduleMode] = useState(initialDraft?.scheduleMode || 'now')
  const [scheduledTime, setScheduledTime] = useState(initialDraft?.scheduledTime || '')
  const [items, setItems] = useState(() => (initialDraft?.items || []).map((item) => ({ ...item })))
  const [deliveryFee, setDeliveryFee] = useState(() => formatBRLCurrencyValue(Number(initialDraft?.deliveryFee) || 0))
  const [adjustment, setAdjustment] = useState(() => initialAdjustment(initialDraft?.adjustment))
  const [quickClient, setQuickClient] = useState({ open: false, name: '', phone: '' })
  const [quickClientError, setQuickClientError] = useState('')
  const [duplicateClient, setDuplicateClient] = useState(null)
  const [checkoutError, setCheckoutError] = useState('')
  const [policyReviewError, setPolicyReviewError] = useState('')
  const [manualPrintWarningOpen, setManualPrintWarningOpen] = useState(false)
  const initialDraftSnapshotRef = useRef(null)
  const stepContentRef = useRef(null)

  if (initialDraftSnapshotRef.current === null) {
    initialDraftSnapshotRef.current = createNewOrderDirtySnapshot({
      clientId,
      type,
      selectedTableId,
      localClientId,
      orderDate,
      scheduleMode,
      scheduledTime,
      items,
      deliveryFee,
      adjustment,
      quickClient,
    })
  }

  const draftDirty = isNewOrderDraftDirty({
    clientId,
    type,
    selectedTableId,
    localClientId,
    orderDate,
    scheduleMode,
    scheduledTime,
    items,
    deliveryFee,
    adjustment,
    quickClient,
  }, initialDraftSnapshotRef.current)

  useEffect(() => {
    onDraftDirtyChange?.(draftDirty)
  }, [draftDirty, onDraftDirtyChange])

  useEffect(() => () => {
    onDraftDirtyChange?.(false)
  }, [onDraftDirtyChange])

  useEffect(() => {
    stepContentRef.current?.focus()
  }, [currentStep])

  const activeClientId = type === 'Local' ? localClientId : clientId
  const activeClientSearch = type === 'Local' ? localClientSearch : clientSearch
  const filteredClients = useMemo(() => {
    const normalized = activeClientSearch.trim().toLowerCase()
    if (!normalized || clients.some((client) => client.id === activeClientId && client.name === activeClientSearch)) return clients
    return clients.filter((client) => client.name.toLowerCase().includes(normalized))
  }, [activeClientId, activeClientSearch, clients])

  const customerIdentity = type === 'Local'
    ? { type: 'table', tableId: selectedTableId, ...(localClientId ? { clientId: localClientId } : {}) }
    : { type: 'registered_client', clientId }
  const identityValidation = validateCustomerIdentity(type, customerIdentity)
  const modalityNeedsReview = !editOrderMode && !activeModalityValues.has(type)
  const selectedModalityOption = ORDER_TYPE_OPTIONS.find((option) => option.value === type)
    || { value: type, label: type }
  const visibleModalityOptions = modalityNeedsReview && type
    ? [...activeModalityOptions, selectedModalityOption]
    : activeModalityOptions
  const selectedTable = tables.find((table) => table.isActive && table.id === selectedTableId) ?? null
  const todayValue = getBusinessDate()
  const orderDateAllowed = canBackdateOrders || orderDate >= todayValue
  const maxDateValue = getScheduleMaxBusinessDate(new Date())
  const scheduledFor = scheduleMode === 'scheduled'
    ? businessDateTimeToIso(orderDate, scheduledTime)
    : null
  const scheduleState = getNewOrderScheduleState({
    type,
    orderDate,
    today: todayValue,
    scheduleMode,
    scheduledFor,
    expectedTableTabId,
    now: new Date(),
  })
  const {
    visible: scheduleVisible,
    valid: scheduleValid,
    reservationMode,
    nowAllowed: scheduleNowAllowed,
    scheduledLabel: scheduleOptionLabel,
    fieldLabel: scheduleFieldLabel,
  } = scheduleState

  const draft = {
    clientId: activeClientId,
    customerIdentity,
    type,
    orderDate,
    items,
    deliveryFee: type === 'Entrega' ? deliveryFee : formatBRLCurrencyValue(0),
    adjustment,
    scheduledFor,
    expectedTableTabId: reservationMode ? '' : expectedTableTabId,
  }
  const numericDraft = {
    ...draft,
    deliveryFee: type === 'Entrega' ? parseBRLCurrencyInput(deliveryFee) : 0,
    adjustment: {
      ...adjustment,
      value: adjustment.mode === 'fixed'
        ? parseBRLCurrencyInput(adjustment.value)
        : Math.max(0, Number(adjustment.value) || 0),
    },
  }
  const preview = calculateOrderPreview(numericDraft)
  const itemCount = getOrderItemCount(items)
  const itemsSubtotal = getOrderItemsSubtotal(items)
  const selectedClient = clients.find((client) => client.id === clientId) ?? null
  const selectedLocalClient = clients.find((client) => client.id === localClientId) ?? null
  const customerSummary = editOrderMode ? (orderContext?.customerLabel || initialDraft?.customerLabel || 'Cliente') : type === 'Local'
    ? `${selectedTable?.name || 'Mesa'}${selectedLocalClient?.name ? ` · ${selectedLocalClient.name}` : ''}`
    : `${selectedClient?.name || 'Cliente'} · ${type}`
  const stepAccess = editOrderMode ? {
    [NEW_ORDER_STEPS.CUSTOMER]: false,
    [NEW_ORDER_STEPS.PRODUCTS]: true,
    [NEW_ORDER_STEPS.REVIEW]: itemCount > 0,
  } : getNewOrderStepAccess({
    identityValid: identityValidation.ok,
    orderDate,
    itemCount,
    scheduleValid: scheduleValid && orderDateAllowed,
  })
  const canSubmit = Boolean(stepAccess.review) && !modalityNeedsReview && !policyReviewError
  const canContinueCustomer = stepAccess.products && !modalityNeedsReview

  const navigateStep = (targetStep) => {
    if (editOrderMode && targetStep === NEW_ORDER_STEPS.CUSTOMER) return
    if (!canNavigateToNewOrderStep({
      targetStep,
      currentStep,
      maxReachedStep,
      access: stepAccess,
    })) return
    setCurrentStep(targetStep)
    setMaxReachedStep((current) => getFurthestReachedStep(current, targetStep))
  }

  const closeQuickClient = () => {
    setQuickClient({ open: false, name: '', phone: '' })
    setQuickClientError('')
    setDuplicateClient(null)
  }

  const changeType = (nextType) => {
    if (editReservationMode && nextType !== 'Local') return false
    setType(nextType)
    setCheckoutError('')
    setPolicyReviewError('')
    closeQuickClient()
    if (expectedTableTabId && nextType === 'Local') {
      setScheduleMode('now')
      setScheduledTime('')
    } else if (orderDate > todayValue) {
      setScheduleMode('scheduled')
    } else if (orderDate < todayValue) {
      setScheduleMode('now')
      setScheduledTime('')
    }
    if (nextType !== 'Entrega') setDeliveryFee(formatBRLCurrencyValue(0))
  }

  const changeOrderDate = (value) => {
    if (!canBackdateOrders && value && value < todayValue) return false
    setOrderDate(value)
    if (expectedTableTabId) {
      setScheduleMode('now')
      setScheduledTime('')
      return
    }
    if (value > todayValue) {
      setScheduleMode('scheduled')
    } else if (value < todayValue) {
      setScheduleMode('now')
      setScheduledTime('')
    }
  }

  const selectTable = (tableId) => {
    setSelectedTableId(tableId)
    setCheckoutError('')
  }

  const handleAdjustmentChange = (patch) => {
    if (!canAdjustOrders) return false
    setAdjustment((current) => {
      if (patch.type === 'none') return emptyAdjustment()
      const next = { ...current, ...patch }
      if (patch.mode === 'fixed' && current.mode !== 'fixed') {
        next.value = formatBRLCurrencyValue(Number(current.value) || 0)
      }
      if (patch.mode === 'percentage' && current.mode !== 'percentage') {
        next.value = String(parseBRLCurrencyInput(current.value))
      }
      return next
    })
    return true
  }

  const handleClientSearchChange = (value) => {
    if (type === 'Local') {
      setLocalClientSearch(value)
      setLocalClientId('')
    } else {
      setClientSearch(value)
      setClientId('')
    }
    setClientPickerOpen(true)
  }

  const selectClient = (client) => {
    if (type === 'Local') {
      setLocalClientId(client.id)
      setLocalClientSearch(client.name)
    } else {
      setClientId(client.id)
      setClientSearch(client.name)
    }
    setClientPickerOpen(false)
  }

  const handleClientPickerBlur = (event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setClientPickerOpen(false)
  }

  const finishQuickClient = (client) => {
    selectClient(client)
    closeQuickClient()
  }

  const createQuickClient = async () => {
    if (!canCreateClients) return false
    const client = await onCreateClient({ name: quickClient.name, phone: quickClient.phone })
    if (!client) return false
    finishQuickClient(client)
    return true
  }

  const handleQuickClientSubmit = async (event) => {
    event.preventDefault()
    if (!canCreateClients || disabled || !quickClient.name.trim()) return false
    setQuickClientError('')

    const duplicate = findClientDuplicates(clients, quickClient)
    if (duplicate.phone) {
      setQuickClientError(`Telefone já cadastrado para ${duplicate.phone.name}. Selecione esse cliente na busca acima.`)
      return
    }
    if (duplicate.name) {
      setDuplicateClient(duplicate.name)
      return
    }

    await createQuickClient()
  }

  const handleUseExistingDuplicate = () => {
    if (!duplicateClient) return
    finishQuickClient(duplicateClient)
  }

  const handleConfirmDuplicate = async () => {
    if (!canCreateClients) return false
    setDuplicateClient(null)
    return createQuickClient()
  }

  const toggleQuickClient = () => {
    if (!canCreateClients) return false
    if (quickClient.open) {
      closeQuickClient()
      return true
    }
    setQuickClientError('')
    setDuplicateClient(null)
    setQuickClient((current) => ({ ...current, open: true }))
    return true
  }

  const updateQuickClient = (patch) => {
    setQuickClientError('')
    setQuickClient((current) => ({ ...current, ...patch }))
  }

  const handleQuickClientChange = (patch) => {
    updateQuickClient(patch.phone === undefined ? patch : { ...patch, phone: formatPhone(patch.phone) })
  }

  const [pendingIntent, setPendingIntent] = useState(null)
  const submitIntentRef = useRef(null)
  const save = async (paymentAllocations, bypassManualPrintWarning = false, intent = 'save', receivedDate) => {
    if (disabled || submitIntentRef.current || !canSubmit) return false
    if (editReservationMode
      && reservationContext?.hasManualPrintHistory
      && !bypassManualPrintWarning) {
      setManualPrintWarningOpen(true)
      return false
    }

    submitIntentRef.current = paymentAllocations ? 'receive' : intent
    setPendingIntent(submitIntentRef.current)
    try {
    setCheckoutError('')
    const result = editOrderMode
      ? await onSubmit(buildOrderEditPayload(numericDraft), { intent })
      : await onSubmit(buildOrderPayload(numericDraft, paymentAllocations, { receivedDate }))
    if (result?.code === 'POLICY_CHANGED') {
      setPolicyReviewError('A política de modalidades foi alterada. Revise o tipo do pedido antes de confirmar novamente.')
      await onPolicyChanged?.()
      return false
    }
    if (result?.ok === false) {
      setCheckoutError(result.message || (editReservationMode
        ? 'Não foi possível salvar as alterações. Seus dados continuam aqui para tentar novamente.'
        : 'Não foi possível salvar a venda. Seus dados continuam aqui para tentar novamente.'))
      return false
    }
    if (!result) {
      setCheckoutError(editReservationMode
        ? 'Não foi possível salvar as alterações. Seus dados continuam aqui para tentar novamente.'
        : 'Não foi possível salvar a venda. Seus dados continuam aqui para tentar novamente.')
      return false
    }
    return true
    } finally { submitIntentRef.current = null; setPendingIntent(null) }
  }

  const cartProps = {
    items, currency, disabled,
    onUpdate: (lineId, patch) => setItems((current) => editOrderMode ? updateEditCartItem(current,lineId,patch) : updateCartItem(current,lineId,patch)),
    onNoteChange: (lineId, note) => setItems((current) => editCartItemNote(current, lineId, note)),
    onNoteCommit: (lineId) => setItems((current) => editOrderMode ? commitEditCartItemNote(current,lineId) : commitCartItemNote(current,lineId)),
    onRemove: (lineId) => setItems((current) => removeCartItem(current, lineId)),
  }
  const contextProps = { displayName: type === 'Local' ? customerSummary : selectedClient?.name || 'A definir', type, orderDate, scheduledFor: scheduleMode === 'scheduled' && scheduleValid ? draft.scheduledFor : null }

  return (
    <div className="new-order-refined">
      <PageHeader
        eyebrow="Do atendimento ao pedido"
        title={editOrderMode ? `Editar pedido #${orderContext?.orderNumber || ''}` : editReservationMode ? 'Editar reserva' : 'Nova venda'}
        description={editOrderMode ? 'Revise os itens sem alterar o atendimento original.' : editReservationMode
          ? `Atualize a reserva${reservationContext?.orderNumber ? ` do pedido #${reservationContext.orderNumber}` : ''} e revise antes de salvar.`
          : 'Um pedido bem organizado começa aqui.'}
        actions={<Button type="button" variant="secondary" onClick={onCancel} disabled={disabled}>
          {editReservationMode || editOrderMode ? 'Cancelar edição' : 'Cancelar venda'}
        </Button>}
      />

      {manualPrintWarningOpen && (
        <div className="new-order-error" role="alert">
          <strong>Esta reserva já foi impressa manualmente.</strong>
          <span> As alterações atualizam o sistema e a impressão automática futura, mas não alteram o papel já impresso.</span>
          <div className="form-actions">
            <Button type="button" variant="secondary" onClick={() => setManualPrintWarningOpen(false)} disabled={disabled}>
              Continuar editando
            </Button>
            <Button
              type="button"
              onClick={() => {
                setManualPrintWarningOpen(false)
                void save(undefined, true)
              }}
              disabled={disabled}
            >
              Salvar mesmo assim
            </Button>
          </div>
        </div>
      )}

      {checkoutError && <div className="new-order-error" role="alert">{checkoutError}</div>}
      {!editOrderMode && !orderDateAllowed && <div className="new-order-error" role="alert">Selecione uma data de hoje ou futura para continuar.</div>}
      {(policyReviewError || modalityNeedsReview) && (
        <div className="new-order-error" role="alert">
          {policyReviewError || (!type
            ? 'As modalidades de pedido estão indisponíveis. Tente novamente antes de continuar.'
            : type === 'Local'
            ? 'Consumo no local não está disponível. Revise a modalidade para continuar.'
            : `${selectedModalityOption.label} não está mais ativa. Revise a modalidade para continuar.`)}
        </div>
      )}

      <NewOrderStepIndicator
        currentStep={currentStep}
        maxReachedStep={maxReachedStep}
        access={stepAccess}
        onNavigate={navigateStep}
      />

      <div ref={stepContentRef} tabIndex="-1" className="new-order-step-content">
        {currentStep === NEW_ORDER_STEPS.CUSTOMER && (
          <NewOrderCustomerStep
            customerSummary={customerSummary}
            contextProps={contextProps}
            clients={clients}
            tables={tables}
            selectedTableId={selectedTableId}
            filteredClients={filteredClients}
            clientId={activeClientId}
            clientSearch={activeClientSearch}
            clientPickerOpen={clientPickerOpen}
            type={type}
            orderTypeOptions={visibleModalityOptions}
            orderDate={orderDate}
            todayValue={todayValue}
            canBackdateOrders={canBackdateOrders}
            maxDateValue={maxDateValue}
            scheduleMode={scheduleMode}
            scheduledTime={scheduledTime}
            scheduleVisible={scheduleVisible}
            scheduleValid={scheduleValid}
            reservationMode={reservationMode}
            scheduleNowAllowed={scheduleNowAllowed}
            scheduleOptionLabel={scheduleOptionLabel}
            scheduleFieldLabel={scheduleFieldLabel}
            quickClient={quickClient}
            quickClientError={quickClientError}
            disabled={disabled}
            canCreateClients={canCreateClients}
            canContinue={canContinueCustomer}
            onTypeChange={changeType}
            onOrderDateChange={changeOrderDate}
            onScheduleModeChange={(mode) => {
              if (mode === 'now' && !scheduleNowAllowed) return
              setScheduleMode(mode)
            }}
            onScheduledTimeChange={setScheduledTime}
            onTableSelect={selectTable}
            onClientSearchChange={handleClientSearchChange}
            onClientFocus={() => setClientPickerOpen(true)}
            onClientBlur={handleClientPickerBlur}
            onClientSelect={selectClient}
            onQuickClientToggle={toggleQuickClient}
            onQuickClientChange={handleQuickClientChange}
            onQuickClientSubmit={handleQuickClientSubmit}
            onQuickClientCancel={closeQuickClient}
            onContinue={() => navigateStep(NEW_ORDER_STEPS.PRODUCTS)}
          />
        )}

        {currentStep === NEW_ORDER_STEPS.PRODUCTS && (
          <NewOrderProductsStep
            products={products}
            items={items}
            currency={currency}
            disabled={disabled}
            customerSummary={customerSummary}
            itemCount={itemCount}
            subtotal={itemsSubtotal}
            cartProps={cartProps}
            contextProps={contextProps}
            editOrderMode={editOrderMode}
            onAdd={(product) => setItems((current) => editOrderMode ? addEditCartItem(current,product) : addCartItem(current,product,''))}
            onDecrease={(productId) => setItems((current) => editOrderMode ? decrementEditCartProduct(current,productId) : decrementCartProduct(current,productId))}
            onBack={editOrderMode ? undefined : () => navigateStep(NEW_ORDER_STEPS.CUSTOMER)}
            onReview={() => navigateStep(NEW_ORDER_STEPS.REVIEW)}
          />
        )}

        {currentStep === NEW_ORDER_STEPS.REVIEW && (
          <NewOrderReviewStep
            contextProps={contextProps}
            onEditCustomer={editOrderMode ? undefined : () => navigateStep(NEW_ORDER_STEPS.CUSTOMER)}
            customerSummary={customerSummary}
            itemCount={itemCount}
            disabled={disabled}
            canAdjustOrders={canAdjustOrders}
            editOrderMode={editOrderMode}
            onBack={() => navigateStep(NEW_ORDER_STEPS.PRODUCTS)}
            cartProps={{
              items,
              currency,
              disabled,
              onUpdate: (lineId, patch) => setItems((current) => editOrderMode ? updateEditCartItem(current,lineId,patch) : updateCartItem(current,lineId,patch)),
              onNoteChange: (lineId, note) => setItems((current) => editCartItemNote(current, lineId, note)),
              onNoteCommit: (lineId) => setItems((current) => editOrderMode ? commitEditCartItemNote(current,lineId) : commitCartItemNote(current,lineId)),
              onRemove: (lineId) => setItems((current) => removeCartItem(current, lineId)),
            }}
            checkoutProps={{
              submitting, pendingIntent,
              draft,
              preview,
              currency,
              disabled,
              canSubmit,
              onDeliveryFeeChange: setDeliveryFee,
              onAdjustmentChange: handleAdjustmentChange,
              editOrderMode,
              orderContext,
              canReceivePayments,
              canRefundPayments,
              onSavePending: () => save(),
              onSavePaid: (paymentAllocations, receivedDate) => editOrderMode ? save(undefined, false, 'receive') : save(paymentAllocations, false, 'save', receivedDate),
              onSaveRefund: () => save(undefined, false, 'refund'),
               allowImmediatePayment: !editOrderMode && type !== 'Local',
               renderPaymentComposition,
             }}
          />
        )}
      </div>

      {canCreateClients && duplicateClient && (
        <ClientDuplicateModal
          client={duplicateClient}
          onCancel={() => setDuplicateClient(null)}
          onUseExisting={handleUseExistingDuplicate}
          onConfirm={handleConfirmDuplicate}
          disabled={disabled}
          cancelLabel="Cancelar"
          useExistingLabel="Usar cliente existente"
          confirmLabel="Cadastrar mesmo assim"
        />
      )}
    </div>
  )
}

export default NewOrder
