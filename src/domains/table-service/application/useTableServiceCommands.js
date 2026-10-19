import { useContextApi } from '../../../infrastructure/api/ContextApi.js'
import { useMutationOwner } from '../../../app/runtime/session/useMutationOwner.js'
import { useCallback } from 'react'
import { validateTransferIntent } from '../domain/tableTransfer.js'
import { tableServiceApi, createTableServiceApi } from '../infrastructure/tableServiceApi.js'

const successMessages = Object.freeze({
  create: 'Mesa adicionada com sucesso',
  rename: 'Mesa renomeada com sucesso',
  activate: 'Mesa ativada com sucesso',
  deactivate: 'Mesa desativada com sucesso',
  transfer: 'Comanda transferida com sucesso',
})

export function useTableServiceCommands({
  api: suppliedApi = tableServiceApi,
  getOfficialTables = () => [],
  applyOfficialEffects = () => {},
  refreshOfficialData = async () => false,
  writesBlocked = false,
  canManageTables = false,
  canTransfer = false,
  setRequestKey = () => {},
  onSuccess = () => {},
  onError = () => {},
  onStaleTarget = () => {},
} = {}) {
  const api = useContextApi(createTableServiceApi, suppliedApi, tableServiceApi)
  const ownsMutation = useMutationOwner(applyOfficialEffects)
  const createTable = useCallback(async (name) => {
    if (!canManageTables || writesBlocked) return false
    setRequestKey('table:create')
    try {
      const result = await api.createTable({ name })
      if (!ownsMutation()) return false

      if (applyOfficialEffects({ tables: result.tables }) === false) return false
      onSuccess(successMessages.create)
      return true
    } catch (error) {
      if (!ownsMutation()) return false
      onError(error)
      return false
    } finally {
      if (ownsMutation()) setRequestKey(null)
    }
  }, [ownsMutation, api, applyOfficialEffects, canManageTables, onError, onSuccess, setRequestKey, writesBlocked])

  const renameTable = useCallback(async (tableId, name) => {
    if (!canManageTables || writesBlocked) return false
    setRequestKey(`table:rename:${tableId}`)
    try {
      const result = await api.updateTable(tableId, { name })
      if (!ownsMutation()) return false

      if (applyOfficialEffects({ tables: result.tables }) === false) return false
      onSuccess(successMessages.rename)
      return true
    } catch (error) {
      if (!ownsMutation()) return false
      onError(error)
      return false
    } finally {
      if (ownsMutation()) setRequestKey(null)
    }
  }, [ownsMutation, api, applyOfficialEffects, canManageTables, onError, onSuccess, setRequestKey, writesBlocked])

  const setTableActive = useCallback(async (tableId, isActive) => {
    if (!canManageTables || writesBlocked) return false
    setRequestKey(`table:active:${tableId}`)
    try {
      const result = await api.updateTable(tableId, { isActive })
      if (!ownsMutation()) return false

      if (applyOfficialEffects({ tables: result.tables }) === false) return false
      onSuccess(isActive ? successMessages.activate : successMessages.deactivate)
      return true
    } catch (error) {
      if (!ownsMutation()) return false
      onError(error)
      return false
    } finally {
      if (ownsMutation()) setRequestKey(null)
    }
  }, [ownsMutation, api, applyOfficialEffects, canManageTables, onError, onSuccess, setRequestKey, writesBlocked])

  const reorderTables = useCallback(async (tableIds) => {
    if (!canManageTables || writesBlocked) return false
    setRequestKey('table:reorder')
    try {
      const result = await api.reorderTables(tableIds)
      if (!ownsMutation()) return false

      if (applyOfficialEffects({ tables: result.tables }) === false) return false
      return true
    } catch (error) {
      if (!ownsMutation()) return false
      onError(error)
      return false
    } finally {
      if (ownsMutation()) setRequestKey(null)
    }
  }, [ownsMutation, api, applyOfficialEffects, canManageTables, onError, setRequestKey, writesBlocked])

  const transferTableTab = useCallback(async (sourceTableId, destinationTableId, expectedTableTabId) => {
    if (writesBlocked || !canTransfer) return false

    const validated = validateTransferIntent(getOfficialTables(), {
      sourceTableId,
      destinationTableId,
      expectedTableTabId,
    })
    if (!validated) {
      onStaleTarget('A comanda ou a mesa de destino mudou. Atualizamos a consulta.')
      void refreshOfficialData()
      return false
    }

    setRequestKey(`table:transfer:${sourceTableId}`)
    try {
      const result = await api.transferTableTab(sourceTableId, destinationTableId, expectedTableTabId)
      if (!ownsMutation()) return false

      if (applyOfficialEffects({ tables: result.tables, tableTab: result.tableTab }) === false) return false
      onSuccess(`Comanda transferida: ${validated.source.name} → ${validated.destination.name}`)
      return true
    } catch (error) {
      if (!ownsMutation()) return false
      if (error?.status === 409) await refreshOfficialData()
      if (!ownsMutation()) return false
      onError(error)
      return false
    } finally {
      if (ownsMutation()) setRequestKey(null)
    }
  }, [
    ownsMutation,
    api,
    applyOfficialEffects,
    canTransfer,
    getOfficialTables,
    onError,
    onStaleTarget,
    onSuccess,
    refreshOfficialData,
    setRequestKey,
    writesBlocked,
  ])

  return {
    createTable,
    renameTable,
    setTableActive,
    reorderTables,
    transferTableTab,
  }
}
