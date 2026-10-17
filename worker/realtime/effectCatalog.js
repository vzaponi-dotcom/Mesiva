// Explicit coverage of official mutation witnesses. Security/telemetry are excluded.
const catalog={}
const add=(actions,topics,{invalidateBusiness=false,excluded=null}={})=>{
  for(const action of actions)catalog[action]=Object.freeze({topics:Object.freeze(topics),invalidateBusiness,excluded})
}
add(['access.denied','login.blocked','login.failure','login.success'],[],{excluded:'security evidence is not an operational mutation'})
add(['order.cancelled','order.created','order.finalized','order.payment-promise.updated','order.price.adjusted','payment.received','payment.refunded','reservation.arrived','reservation.updated'],['orders','tables','reservations','finance','kitchen-tv'])
add(['client.created','client.deleted','client.updated'],['clients'])
add(['finance.movement.created','finance.movement.deleted','finance.movement.updated'],['finance'])
add(['kitchen-tv.modality.updated','kitchen-tv.order.hidden','kitchen-tv.order.restored','kitchen-tv.page.updated'],['kitchen-tv'])
add(['printing.attempt.prepared','printing.claimed','printing.discarded','printing.forced','printing.outcome.observed','printing.outcome.resolved','printing.primary.updated','printing.prioritized','printing.recovery.claimed','printing.recovery.updated','printing.reprint.requested','printing.requested','printing.retried','printing.second-copy.prompted','printing.second-copy.requested','printing.second-copy.skipped','printing.station.updated','printing.submission.intent'],['printing'])
add(['product.created','product.deleted','product.updated'],['catalog'])
add(['access.invitation.accepted','access.user.created','access.user.updated'],['settings'])
add(['access.password.changed','access.password.reset','access.user.activated','access.user.deactivated','access.user.role-changed','session.revoked'],['settings'],{invalidateBusiness:true})
add(['settings.business-profile.updated','settings.cancellation-reasons.updated','settings.finance-categories.updated','settings.finance.updated','settings.operations.updated','settings.payment-methods.updated','settings.printing.updated'],['settings','catalog','finance','printing','kitchen-tv'])
add(['settings.kitchen-tv.approved'],['settings','kitchen-tv'])
add(['settings.kitchen-tv.revoked'],['settings','kitchen-tv'],{invalidateBusiness:true})
add(['table-tab.transferred','table.created','table.updated','tables.reordered'],['orders','tables','reservations','finance'])
add(['order.cancelled'],['orders','tables','reservations','finance','kitchen-tv','printing'])
add(['order.created','order.finalized','order.payment-promise.updated','order.price.adjusted'],['orders','kitchen-tv'])
add(['order.edited'],['orders','tables','reservations','finance','kitchen-tv','printing','clients'])
add(['payment.supplemental-received','payment.partial-refunded'],['orders','tables','finance','clients'])
export const EFFECT_CATALOG=Object.freeze(catalog)
export function topicsForCommittedEvent({action,resourceType,resourceId,outcome='success'}) {
  const topics=outcome==='success'?[...(catalog[action]?.topics || [])]:[]
  return {topics,orderIds:topics.includes('orders') && resourceType==='order' && resourceId?[resourceId]:[]}
}
export function effectForCommittedEvent(businessId,event) {
  const projection=topicsForCommittedEvent(event)
  if(!projection.topics.length)return null
  return {businessId,...projection,invalidations:catalog[event.action]?.invalidateBusiness?[{scope:'business',id:businessId}]:[]}
}
// Coverage boundaries (trusted owners, not SQL detection):
// - access/audit.prepareAuditEvent: guarded business transaction witness;
//   prepareAuditSelection: same-batch bulk/claim candidate witness, zero rows silent.
// - identity/sessions.prepareBrowserFamilyRevocation and challenges global revoke:
//   RETURNING only newly revoked tenant/session IDs; scopeSelection: old context write.
// - platform/audit.preparePlatformAudit: successful lifecycle/membership completion.
// - kitchenTvRepository.activateKitchenTvApprovedRequest: accepted consumed request
//   and access upsert in one atomic batch; revoke uses conditional business audit.
// - repositories.createOrder: table/reservation totals on the actual order INSERT;
//   orderPrintingRepository.prepareAutomaticPrintJobStatement: actual job INSERT.
// - tableRepository.getOrCreateOpenTableTabByTableId and repositories.closeTableTabIfSettled:
//   actual open/close writes; sequence reservation is not a visible tab.
// - orderPrintingRepository.heartbeatPrintStation: health/recovery transitions only;
//   purgeExpiredTerminalPrintJobs: existing terminal retention, no new deletion rule.
// - kitchenTvControlRepository.reportKitchenTvDisplay: only changed projection
//   fields (one indexed previous-control read); identical presence heartbeat silent.
// Excluded: unchanged heartbeats, session last_seen, unchanged TV display heartbeat, security
// and identity audit/assertions, email delivery telemetry and empty print claims.
// Business-wide access invalidation deliberately reauthenticates valid peers too:
// access userId differs from realtime principal accountId; never confuse the IDs.

export function sessionRevocationEffects(result,principalId=null) {
  return (result.results || []).filter(row=>row.business_id).map(row=>({businessId:row.business_id,topics:[],orderIds:[],invalidations:[principalId?{scope:'principal',id:principalId}:{scope:'session',id:row.id}]}))
}
