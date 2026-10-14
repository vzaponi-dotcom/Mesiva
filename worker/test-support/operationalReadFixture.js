// Deterministic fictional history shared by SQLite tests and the real D1 gate.
export async function seedOperationalReadFixture(db, {
  businessId = 'amor-e-sabor', historicalOrders = 0, activeOrders = 0, itemsPerOrder = 5,
} = {}) {
  const activeIds = [], historicalIds = [], statements = []
  const at = '2026-10-13T12:00:00.000Z'
  for (const [kind, count] of [['history', historicalOrders], ['active', activeOrders]]) {
    for (let i = 0; i < count; i += 1) {
      const id = `${businessId}:${kind}:${i}`
      ;(kind === 'active' ? activeIds : historicalIds).push(id)
      statements.push(db.prepare(`INSERT INTO orders
        (id,business_id,client_name_snapshot,type,order_date,status,subtotal_cents,total_cents,created_at,finished_at,order_number)
        VALUES (?,?,?,'Entrega','2026-10-13',?,?,?,?,?,?)`)
        .bind(id,businessId,'Cliente fictício',kind === 'active' ? 'Em preparo' : 'Finalizado',
          itemsPerOrder * 1000,itemsPerOrder * 1000,at,kind === 'active' ? null : at,
          kind === 'active' ? historicalOrders + i + 1 : i + 1))
      for (let j = 0; j < itemsPerOrder; j += 1) {
        statements.push(db.prepare(`INSERT INTO order_items
          (id,business_id,order_id,name_snapshot,quantity,catalog_price_cents,unit_price_cents,created_at,note)
          VALUES (?,?,?,'Prato fictício',1,1000,1000,?,'Sem cebola')`)
          .bind(`${id}:item:${j}`,businessId,id,at))
      }
      if (statements.length >= 100) await db.batch(statements.splice(0))
    }
  }
  if (statements.length) await db.batch(statements)
  return { activeIds, historicalIds }
}
