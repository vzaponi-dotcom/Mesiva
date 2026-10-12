import Icon from '../../../../shared/ui/Icon.jsx'
import './order-edit-changes.css'

const quantity = item => Number.isSafeInteger(Number(item?.quantity)) ? Math.max(0,Number(item.quantity)) : 0
const note = item => String(item?.note || '').trim()

export default function OrderEditChanges({ changes = [], defaultOpen = false, className = '' }) {
  if (!Array.isArray(changes) || changes.length === 0) return null
  return <details className={['order-detail-edit-history', className].filter(Boolean).join(' ')} open={defaultOpen} aria-label="Revisão do pedido">
    <summary>
      <span className="order-edit-history-heading"><Icon name="edit" size={16}/>Últimas alterações</span>
      <span className="order-edit-history-count">{changes.length} {changes.length === 1 ? 'alteração' : 'alterações'}</span>
      <Icon name="arrow-down" size={16}/>
    </summary>
    <div className="order-edit-history-content">
      <p className="order-edit-history-hint">O que mudou na última edição do pedido</p>
      <ol className="order-edit-change-list">
        {changes.map((change,index)=>{
          const kind = ['added','removed'].includes(change.kind) ? change.kind : 'updated'
          const item = change.after || change.before || {}
          const beforeQty=quantity(change.before), afterQty=quantity(change.after)
          const beforeNote=note(change.before), afterNote=note(change.after)
          const quantityChanged=kind==='updated' && beforeQty!==afterQty
          const noteChanged=kind==='updated' && beforeNote!==afterNote
          const label=kind==='added'?'Adicionado':kind==='removed'?'Removido':'Alterado'
          const singleNote=kind==='removed'?beforeNote:afterNote
          return <li key={index} className="order-edit-change-row" data-kind={kind}>
            <div className="order-edit-change-heading">
              <span className="order-edit-change-tag">{label}</span>
              <strong className="order-edit-change-name">{item.name || 'Produto'}</strong>
            </div>
            <div className="order-edit-change-facts">
              {kind!=='updated' && <div className="order-edit-change-quantity">
                <span>Quantidade</span><strong>{kind==='removed'?beforeQty:afterQty}</strong>
              </div>}
              {quantityChanged && <div className="order-edit-change-quantity">
                <span>Quantidade</span>
                <span className="order-edit-change-compare">
                  <span>{beforeQty}</span><Icon name="arrow-right" size={13}/><strong>{afterQty}</strong>
                </span>
              </div>}
              {noteChanged && <div className="order-edit-change-notes">
                <span className="order-edit-change-notes-heading">Observação alterada</span>
                <div className="order-edit-change-note-row"><span>Antes</span><p>{beforeNote || 'Sem observação'}</p></div>
                <div className="order-edit-change-note-row"><span>Depois</span><p>{afterNote || 'Sem observação'}</p></div>
              </div>}
              {kind!=='updated' && Boolean(singleNote) && <p className="order-edit-change-single-note">
                <span>Observação:</span> {singleNote}
              </p>}
            </div>
          </li>
        })}
      </ol>
    </div>
  </details>
}
