import { registerCommittedEffect } from './realtime/committedEffects.js'
import { businessEvent, auditedMutation } from './access/audit.js'
import { mapTableReservationRow, prepareNextTableReservations, loadNextTableReservationForTable } from './tableReservationRepository.js'

const TABLE_NAME_MAX_LENGTH = 60

const domainError = (status, code, message, field) => Object.assign(new Error(message), {
  status,
  code,
  ...(field ? { field } : {}),
})

const tableNameExistsError = () => domainError(
  409,
  'TABLE_NAME_EXISTS',
  'Já existe uma mesa com esse nome.',
)

const tableOccupiedError = () => domainError(
  409,
  'TABLE_OCCUPIED',
  'A mesa está ocupada e não pode ser alterada.',
)

const tableHasActiveReservationError = () => domainError(
  409,
  'TABLE_HAS_ACTIVE_RESERVATION',
  'Esta mesa possui uma reserva ativa. Mova ou cancele a reserva antes de alterar a mesa.',
)

const tableDestinationOccupiedError = () => domainError(
  409,
  'TABLE_DESTINATION_OCCUPIED',
  'A mesa de destino está ocupada.',
)

const isTableNameCollision = (error) => {
  const message = String(error?.message || '')
  return /idx_tables_business_name_key|UNIQUE constraint failed:\s*tables\.business_id,\s*tables\.name_key/i.test(message)
}

const isOpenTableTabCollision = (error) => {
  const message = String(error?.message || '')
  return /idx_table_tabs_one_open_per_table_id|UNIQUE constraint failed:\s*table_tabs\.business_id,\s*table_tabs\.table_id/i.test(message)
}

const runWithTableNameCollision = async (operation) => {
  try {
    return await operation()
  } catch (error) {
    if (isTableNameCollision(error)) throw tableNameExistsError()
    throw error
  }
}

export const normalizeTableName = (value) => {
  if (typeof value !== 'string') {
    throw domainError(400, 'VALIDATION_ERROR', 'Informe o nome da mesa.', 'name')
  }

  const name = value.trim().replace(/\s+/g, ' ')
  if (!name) throw domainError(400, 'VALIDATION_ERROR', 'Informe o nome da mesa.', 'name')
  if (name.length > TABLE_NAME_MAX_LENGTH) {
    throw domainError(
      400,
      'VALIDATION_ERROR',
      `O nome da mesa aceita no máximo ${TABLE_NAME_MAX_LENGTH} caracteres.`,
      'name',
    )
  }

  return { name, nameKey: name.toLocaleUpperCase('pt-BR') }
}

export const mapTableRow = (row) => row ? ({
  id: row.id,
  name: row.name,
  sortOrder: Number(row.sort_order),
  isActive: Boolean(row.is_active),
  occupancy: row.open_table_tab_id ? 'occupied' : 'free',
  openTableTabId: row.open_table_tab_id ?? null,
  nextReservation: null,
  openTableTab: row.open_table_tab_id ? {
    id: row.open_table_tab_id,
    number: Number(row.open_table_tab_number),
    openedAt: row.open_table_tab_opened_at,
    orderCount: Number(row.open_table_tab_order_count || 0),
    itemCount: Number(row.open_table_tab_item_count || 0),
    totalCents: Number(row.open_table_tab_total_cents || 0),
  } : null,
}) : null

const tableSelect = `SELECT
  tables.id,
  tables.name,
  tables.sort_order,
  tables.is_active,
  open_tabs.id AS open_table_tab_id,
  open_tabs.tab_number AS open_table_tab_number,
  open_tabs.opened_at AS open_table_tab_opened_at,
  COALESCE(tab_summary.order_count, 0) AS open_table_tab_order_count,
  COALESCE(tab_summary.item_count, 0) AS open_table_tab_item_count,
  COALESCE(tab_summary.total_cents, 0) AS open_table_tab_total_cents
FROM tables
LEFT JOIN table_tabs open_tabs
  ON open_tabs.business_id = tables.business_id
 AND open_tabs.table_id = tables.id
 AND open_tabs.status = 'open'
LEFT JOIN (
  SELECT
    orders.business_id,
    orders.table_tab_id,
    COUNT(*) AS order_count,
    COALESCE(SUM((SELECT SUM(quantity) FROM order_items
      WHERE order_items.business_id = orders.business_id AND order_items.order_id = orders.id)), 0) AS item_count,
    COALESCE(SUM(orders.total_cents), 0) AS total_cents
  FROM table_tabs candidate_tabs
  CROSS JOIN orders
    ON orders.business_id = candidate_tabs.business_id AND orders.table_tab_id = candidate_tabs.id
  LEFT JOIN payments
    ON payments.order_id = orders.id AND payments.business_id = orders.business_id
  WHERE candidate_tabs.business_id = ? AND candidate_tabs.status = 'open'
    AND orders.status <> 'Cancelado' AND payments.id IS NULL
  GROUP BY orders.business_id, orders.table_tab_id
) tab_summary
  ON tab_summary.business_id = open_tabs.business_id
 AND tab_summary.table_tab_id = open_tabs.id`

export const prepareTableReads = (db, businessId) => [
  db.prepare(`${tableSelect}
    WHERE tables.business_id = ?
    ORDER BY tables.sort_order, tables.name, tables.id`).bind(businessId, businessId),
  prepareNextTableReservations(db, businessId),
]
export const projectTableReads = ([result, reservations]) => {
  const tables = (result.results || []).map(mapTableRow)
  const reservationByTableId = new Map((reservations.results || []).map(mapTableReservationRow).map(reservation => [reservation.tableId, reservation]))
  return tables.map(table => ({ ...table, nextReservation: reservationByTableId.get(table.id) ?? null }))
}
export const listTables = async (db, businessId) => projectTableReads(await db.batch(prepareTableReads(db, businessId)))

export const loadTableById = async (db, businessId, tableId) => {
  const row = await db.prepare(`${tableSelect}
    WHERE tables.business_id = ? AND tables.id = ?
    LIMIT 1`).bind(businessId, businessId, tableId).first()
  const table = mapTableRow(row)
  if (!table) return null
  return {
    ...table,
    nextReservation: await loadNextTableReservationForTable(db, businessId, tableId),
  }
}

const mapOpenTableTabRow = (row) => ({
  id: row.id,
  tableId: row.table_id,
  tableIdentifier: row.table_identifier,
  tabNumber: Number(row.tab_number),
  status: row.status,
  openedAt: row.opened_at,
  closedAt: row.closed_at ?? null,
})

export const reserveNextTableTabNumber = async (db, businessId, now = new Date()) => {
  const timestamp = now.toISOString()
  await db.prepare(`INSERT OR IGNORE INTO table_tab_counters (
    business_id, last_number, updated_at
  ) VALUES (?, 0, ?)`).bind(businessId, timestamp).run()
  const row = await db.prepare(`UPDATE table_tab_counters
    SET last_number = last_number + 1, updated_at = ?
    WHERE business_id = ?
    RETURNING last_number`).bind(timestamp, businessId).first()
  if (!Number.isInteger(Number(row?.last_number))) {
    throw domainError(500, 'TABLE_TAB_NUMBER_FAILED', 'N\u00e3o foi poss\u00edvel numerar a comanda.')
  }
  return Number(row.last_number)
}

export const getOrCreateOpenTableTabByTableId = async (db, businessId, tableId, now = new Date()) => {
  const table = await db.prepare(`SELECT id, name, is_active
    FROM tables
    WHERE id = ? AND business_id = ?
    LIMIT 1`).bind(tableId, businessId).first()
  if (!table) throw domainError(404, 'TABLE_NOT_FOUND', 'Mesa não encontrada.')
  if (!table.is_active) throw domainError(409, 'TABLE_INACTIVE', 'A mesa está inativa.')

  const selectOpen = () => db.prepare(`SELECT id, table_id, table_identifier, tab_number, status, opened_at, closed_at
    FROM table_tabs
    WHERE business_id = ? AND table_id = ? AND status = 'open'
    LIMIT 1`).bind(businessId, table.id).first()

  let row = await selectOpen()
  if (row) return mapOpenTableTabRow(row)

  const id = crypto.randomUUID()
  const timestamp = now.toISOString()
  const tabNumber = await reserveNextTableTabNumber(db, businessId, now)
  await registerCommittedEffect(db.prepare(`INSERT OR IGNORE INTO table_tabs (
    id, business_id, table_id, table_identifier, tab_number, status, opened_at, closed_at, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, 'open', ?, NULL, ?, ?)`).bind(
    id,
    businessId,
    table.id,
    table.name,
    tabNumber,
    timestamp,
    timestamp,
    timestamp,
  ),{businessId,topics:['tables'],orderIds:[]}).run()

  row = await selectOpen()
  if (!row) throw domainError(500, 'TABLE_TAB_CREATE_FAILED', 'Não foi possível abrir a comanda da mesa.')
  return mapOpenTableTabRow(row)
}

export const requireExpectedOpenTableTab = async (db, businessId, tableId, expectedTableTabId) => {
  const row = await db.prepare(`SELECT
      table_tabs.id,
      table_tabs.table_id,
      table_tabs.table_identifier,
      table_tabs.tab_number,
      table_tabs.status,
      table_tabs.opened_at,
      table_tabs.closed_at
    FROM table_tabs
    JOIN tables ON tables.id = table_tabs.table_id AND tables.business_id = table_tabs.business_id
    WHERE table_tabs.id = ?
      AND table_tabs.business_id = ?
      AND table_tabs.table_id = ?
      AND table_tabs.status = 'open'
      AND tables.is_active = 1
    LIMIT 1`).bind(expectedTableTabId, businessId, tableId).first()
  if (!row) {
    throw domainError(409, 'TABLE_TAB_CHANGED', 'A comanda mudou ou foi encerrada. Atualize os dados e tente novamente.')
  }
  return mapOpenTableTabRow(row)
}

export const transferOpenTableTab = async (
  db,
  businessId,
  sourceTableId,
  destinationTableId,
  now = new Date(),
  expectedTableTabId,
) => {
  if (typeof expectedTableTabId !== 'string' || !expectedTableTabId.trim()) {
    throw domainError(400, 'EXPECTED_TABLE_TAB_REQUIRED', 'A comanda confirmada não foi informada. Recarregue a página e selecione novamente.')
  }
  if (sourceTableId === destinationTableId) {
    throw domainError(409, 'TABLE_TRANSFER_SAME_TABLE', 'A mesa de destino deve ser diferente da origem.')
  }

  const sourceTab = await db.prepare(`SELECT id
    FROM table_tabs
    WHERE business_id = ? AND table_id = ? AND id = ? AND status = 'open'
    LIMIT 1`).bind(businessId, sourceTableId, expectedTableTabId.trim()).first()
  if (!sourceTab) {
    throw domainError(409, 'TABLE_TAB_CHANGED', 'A comanda mudou ou foi encerrada. Atualize os dados e tente novamente.')
  }

  const destination = await db.prepare(`SELECT
      tables.id,
      tables.name,
      tables.is_active,
      open_tabs.id AS open_table_tab_id
    FROM tables
    LEFT JOIN table_tabs open_tabs
      ON open_tabs.business_id = tables.business_id
     AND open_tabs.table_id = tables.id
     AND open_tabs.status = 'open'
    WHERE tables.business_id = ? AND tables.id = ?
    LIMIT 1`).bind(businessId, destinationTableId).first()
  if (!destination) {
    throw domainError(404, 'TABLE_DESTINATION_NOT_FOUND', 'Mesa de destino não encontrada.')
  }
  if (!destination.is_active) {
    throw domainError(409, 'TABLE_DESTINATION_INACTIVE', 'A mesa de destino está inativa.')
  }
  if (destination.open_table_tab_id) throw tableDestinationOccupiedError()

  let result
  try {
    result = await auditedMutation(db, businessId, db.prepare(`UPDATE table_tabs
      SET table_id = ?,
        table_identifier = (
          SELECT name FROM tables
          WHERE business_id = ? AND id = ? AND is_active = 1
        ),
        updated_at = ?
      WHERE business_id = ?
        AND table_id = ?
        AND id = ?
        AND status = 'open'
        AND EXISTS (
          SELECT 1 FROM tables
          WHERE business_id = ? AND id = ? AND is_active = 1
        )
        AND NOT EXISTS (
          SELECT 1 FROM table_tabs
          WHERE business_id = ? AND table_id = ? AND status = 'open'
        )`).bind(
      destination.id,
      businessId,
      destination.id,
      now.toISOString(),
      businessId,
      sourceTableId,
      expectedTableTabId.trim(),
      businessId,
      destination.id,
      businessId,
      destination.id,
    ), {action:'table-tab.transferred',resourceType:'table-tab',resourceId:sourceTab.id,now}).run()
  } catch (error) {
    if (isOpenTableTabCollision(error)) throw tableDestinationOccupiedError()
    throw error
  }

  if (result?.meta?.changes !== 1) {
    const currentDestination = await db.prepare(`SELECT
        tables.is_active,
        open_tabs.id AS open_table_tab_id
      FROM tables
      LEFT JOIN table_tabs open_tabs
        ON open_tabs.business_id = tables.business_id
       AND open_tabs.table_id = tables.id
       AND open_tabs.status = 'open'
      WHERE tables.business_id = ? AND tables.id = ?
      LIMIT 1`).bind(businessId, destination.id).first()
    if (!currentDestination) {
      throw domainError(404, 'TABLE_DESTINATION_NOT_FOUND', 'Mesa de destino não encontrada.')
    }
    if (!currentDestination.is_active) {
      throw domainError(409, 'TABLE_DESTINATION_INACTIVE', 'A mesa de destino está inativa.')
    }
    const occupiedDestination = currentDestination.open_table_tab_id
    if (occupiedDestination) throw tableDestinationOccupiedError()

    const expectedSource = await db.prepare(`SELECT id
      FROM table_tabs
      WHERE business_id = ? AND table_id = ? AND id = ? AND status = 'open'
      LIMIT 1`).bind(businessId, sourceTableId, expectedTableTabId.trim()).first()
    if (!expectedSource) {
      throw domainError(409, 'TABLE_TAB_CHANGED', 'A comanda mudou ou foi encerrada. Atualize os dados e tente novamente.')
    }
    throw domainError(409, 'TABLE_TRANSFER_CONFLICT', 'Não foi possível transferir a comanda.')
  }

  const transferred = await db.prepare(`SELECT id, table_id, table_identifier, tab_number, status, opened_at, closed_at
    FROM table_tabs
    WHERE id = ? AND business_id = ?
    LIMIT 1`).bind(sourceTab.id, businessId).first()
  return mapOpenTableTabRow(transferred)
}

export const createTable = async (db, businessId, input, now = new Date()) => {
  const { name, nameKey } = normalizeTableName(input?.name)
  const orderRow = await db.prepare(`SELECT COALESCE(MAX(sort_order), 0) AS max_sort_order
    FROM tables
    WHERE business_id = ?`).bind(businessId).first()
  const id = crypto.randomUUID()
  const timestamp = now.toISOString()
  const sortOrder = Number(orderRow?.max_sort_order || 0) + 1

  await runWithTableNameCollision(() => auditedMutation(db, businessId, db.prepare(`INSERT INTO tables (
    id, business_id, name, name_key, sort_order, is_active, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`).bind(
    id,
    businessId,
    name,
    nameKey,
    sortOrder,
    timestamp,
    timestamp,
  ), {action:'table.created',resourceType:'table',resourceId:id,now}).run())

  return loadTableById(db, businessId, id)
}

export const renameTable = async (db, businessId, tableId, value, now = new Date()) => {
  const current = await loadTableById(db, businessId, tableId)
  if (!current) return null
  if (current.occupancy === 'occupied') throw tableOccupiedError()
  if (current.nextReservation) throw tableHasActiveReservationError()

  const { name, nameKey } = normalizeTableName(value)
  await runWithTableNameCollision(() => auditedMutation(db, businessId, db.prepare(`UPDATE tables
    SET name = ?, name_key = ?, updated_at = ?
    WHERE id = ? AND business_id = ?`).bind(
    name,
    nameKey,
    now.toISOString(),
    tableId,
    businessId,
  ), {action:'table.updated',resourceType:'table',resourceId:tableId,now}).run())

  return loadTableById(db, businessId, tableId)
}

export const setTableActive = async (db, businessId, tableId, isActive, now = new Date()) => {
  if (typeof isActive !== 'boolean') {
    throw domainError(400, 'VALIDATION_ERROR', 'O estado da mesa é inválido.', 'isActive')
  }

  const current = await loadTableById(db, businessId, tableId)
  if (!current) return null
  if (!isActive && current.occupancy === 'occupied') throw tableOccupiedError()
  if (!isActive && current.nextReservation) throw tableHasActiveReservationError()

  await auditedMutation(db, businessId, db.prepare(`UPDATE tables
    SET is_active = ?, updated_at = ?
    WHERE id = ? AND business_id = ?`).bind(
    isActive ? 1 : 0,
    now.toISOString(),
    tableId,
    businessId,
  ), {action:'table.updated',resourceType:'table',resourceId:tableId,now}).run()

  return loadTableById(db, businessId, tableId)
}

export const reorderTables = async (db, businessId, orderedIds, now = new Date()) => {
  if (!Array.isArray(orderedIds) || new Set(orderedIds).size !== orderedIds.length) {
    throw domainError(400, 'INVALID_TABLE_ORDER', 'A ordem das mesas é inválida.')
  }

  const current = await db.prepare(`SELECT id
    FROM tables
    WHERE business_id = ?`).bind(businessId).all()
  const currentIds = new Set((current.results || []).map((row) => row.id))
  if (orderedIds.length !== currentIds.size || orderedIds.some((id) => !currentIds.has(id))) {
    throw domainError(400, 'INVALID_TABLE_ORDER', 'A ordem deve conter todas as mesas do estabelecimento uma única vez.')
  }

  const timestamp = now.toISOString()
  const statements = orderedIds.map((id, index) => db.prepare(`UPDATE tables
    SET sort_order = ?, updated_at = ?
    WHERE id = ? AND business_id = ?`).bind(index + 1, timestamp, id, businessId))
  await db.batch([...statements,businessEvent(db,businessId,{action:'tables.reordered',resourceType:'tables',resourceId:businessId,now})])

  return listTables(db, businessId)
}
