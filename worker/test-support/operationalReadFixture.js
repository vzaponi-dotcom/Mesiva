// Deterministic fictional history shared by SQLite tests and the real D1 gate.
// Bulk SQL avoids a remote Miniflare binding round-trip for every fixture row.
export async function seedOperationalReadFixture(db, {
  businessId = 'amor-e-sabor', historicalOrders = 0, activeOrders = 0, itemsPerOrder = 5, historicalOffset = 0,
} = {}) {
  const activeIds = [], historicalIds = []
  const at = '2026-10-13T12:00:00.000Z'
  for (const [kind, count] of [['history', historicalOrders], ['active', activeOrders]]) {
    if (!count) continue
    const offset = kind === 'history' ? historicalOffset : 0
    const prefix = `${businessId}:${kind}:`
    const ids = Array.from({length:count},(_,index)=>`${prefix}${offset+index}`)
    ;(kind === 'active' ? activeIds : historicalIds).push(...ids)
    const orders = db.prepare(`WITH RECURSIVE numbers(n) AS (
      SELECT 0 UNION ALL SELECT n+1 FROM numbers WHERE n+1 < ?
    ) INSERT INTO orders
      (id,business_id,client_name_snapshot,type,order_date,status,subtotal_cents,total_cents,created_at,finished_at,order_number)
      SELECT ? || CAST(n+? AS INTEGER),?,'Cliente fictício','Entrega','2026-10-13',?,?,?,?,?,n+? FROM numbers`)
      .bind(count,prefix,offset,businessId,kind === 'active' ? 'Em preparo' : 'Finalizado',
        itemsPerOrder*1000,itemsPerOrder*1000,at,kind === 'active' ? null : at,
        kind === 'active' ? historicalOrders+1 : offset+1)
    const statements = [orders]
    if (itemsPerOrder) statements.push(db.prepare(`WITH RECURSIVE
      numbers(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM numbers WHERE n+1 < ?),
      items(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM items WHERE n+1 < ?)
      INSERT INTO order_items
        (id,business_id,order_id,name_snapshot,quantity,catalog_price_cents,unit_price_cents,created_at,note)
      SELECT ? || CAST(o.n+? AS INTEGER) || ':item:' || i.n,?,? || CAST(o.n+? AS INTEGER),
        'Prato fictício',1,1000,1000,?,'Sem cebola' FROM numbers o CROSS JOIN items i`)
      .bind(count,itemsPerOrder,prefix,offset,businessId,prefix,offset,at))
    await db.batch(statements)
  }
  return { activeIds, historicalIds }
}
