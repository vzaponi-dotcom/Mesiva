// Values accepted by the activity API's exact `type` filter. UI labels may be
// localized independently; stored action names remain stable.
export const AUDIT_ACTIONS = Object.freeze([
  'access.denied', 'access.invitation.accepted', 'access.password.changed', 'access.password.reset',
  'access.user.activated', 'access.user.created', 'access.user.deactivated', 'access.user.role-changed', 'access.user.updated',
  'client.created', 'client.deleted', 'client.updated',
  'finance.movement.created', 'finance.movement.deleted', 'finance.movement.updated',
  'kitchen-tv.modality.updated', 'kitchen-tv.order.hidden', 'kitchen-tv.order.restored', 'kitchen-tv.page.updated',
  'login.blocked', 'login.failure', 'login.success',
  'order.cancelled', 'order.created', 'order.edited', 'order.finalized', 'order.payment-promise.updated', 'order.price.adjusted',
  'payment.received', 'payment.refunded', 'payment.supplemental-received', 'payment.partial-refunded',
  'printing.attempt.prepared', 'printing.claimed', 'printing.discarded', 'printing.forced',
  'printing.outcome.observed', 'printing.outcome.resolved', 'printing.primary.updated', 'printing.prioritized',
  'printing.recovery.claimed', 'printing.recovery.updated', 'printing.reprint.requested', 'printing.requested', 'printing.retried',
  'printing.second-copy.prompted', 'printing.second-copy.requested', 'printing.second-copy.skipped',
  'printing.station.updated', 'printing.submission.intent',
  'product.created', 'product.deleted', 'product.updated', 'reservation.arrived', 'reservation.updated', 'session.revoked',
  'settings.business-profile.updated', 'settings.cancellation-reasons.updated', 'settings.finance-categories.updated',
  'settings.finance.updated', 'settings.kitchen-tv.approved', 'settings.kitchen-tv.revoked',
  'settings.operations.updated', 'settings.payment-methods.updated', 'settings.printing.updated',
  'table-tab.transferred', 'table.created', 'table.updated', 'tables.reordered',
])
