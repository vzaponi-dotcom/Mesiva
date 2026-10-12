
import Icon from './Icon.jsx'
import './orderEditedBadge.css'

export default function OrderEditedBadge({ className = '' }) {
  return <span className={['status-badge', 'order-edited-badge', className].filter(Boolean).join(' ')}
    role="status" aria-label="Pedido editado" title="Este pedido foi editado">
    <Icon name="edit" size={13} />
    <span>Editado</span>
  </span>
}
