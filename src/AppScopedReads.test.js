import test from 'node:test'
import assert from 'node:assert/strict'
import {act} from 'react-test-renderer'
import {workspaceHarness,nodeText,buttonNamed} from './test-support/renderWorkspace.js'
const capabilities=['orders.view','orders.history','orders.create','products.view','clients.view']
const config={paymentMethods:{methods:[{code:'pix',value:'Pix',label:'Pix'}],defaultMethod:'pix'},version:'scoped-config',revisions:{operations:1},operations:{enabledModalities:['Entrega','Retirada','Local'],defaultModality:'Retirada',timing:{scheduledPrepLeadMinutes:50,scheduledLateGraceMinutes:15,immediateLateAfterMinutes:30,immediateVeryLateAfterMinutes:40}}}
const session={authenticated:true,authMode:'multi_company',scope:'business',contextId:'scoped-business-context',businessId:'amor-e-sabor',settingsContextId:'scoped-settings-context',account:{id:'account',displayName:'Fictício',email:'ficticio@example.test'},user:{id:'operator',displayName:'Operador',roleName:'Operador'},capabilities}
const order={id:'history-order',orderNumber:1,client:'Cliente fictício',type:'Retirada',status:'Finalizado',orderDate:'2026-10-15',createdAt:'2026-10-15T12:00:00Z',finishedAt:'2026-10-15T13:00:00Z',paymentStatus:'Pendente',total:20,items:[{id:'item',name:'Prato',quantity:1,unitPrice:20}]}
async function mount(t,path,{grants=capabilities,failOnce=false,failBootstrap=false}={}){
 const h=await workspaceHarness(t),calls=[];let failed=false,bootstrapFailure=failBootstrap
 globalThis.fetch=async path=>{
  const url=new URL(String(path),'https://example.test');calls.push(url.pathname+url.search)
  let data
  if(url.pathname==='/api/auth/session')data={...session,capabilities:grants}
  else if(url.pathname==='/api/bootstrap'){
   if(bootstrapFailure||failOnce&&!failed){failed=true;return{ok:false,status:503,json:async()=>({error:{code:'UNAVAILABLE',message:'offline'}})}}
   const surface=url.searchParams.get('surface')
   data={business:{id:'amor-e-sabor',name:'Loja fictícia'},effectiveBusinessConfig:config,effectiveConfigVersion:config.version,
    readModel:{version:1,surface,completeCollections:surface==='orders'?['orders']:surface==='new-order'?['products','clients']:surface==='products'?['products']:[],orderScope:surface==='orders'?'active':null,counters:{orders:0,comandas:0},operationalOrders:[],openTableTabIds:[]},
    ...(surface==='orders'?{orders:[]}:surface==='new-order'?{clients:[],products:[]}:surface==='products'?{products:[]}:{}),}
  }else if(url.pathname==='/api/reads/orders/kitchen-summary')data={finishedToday:12,businessDate:'2026-10-15'}
  else if(url.pathname==='/api/reads/orders/history')data={orders:[order],summary:{all:200,finalized:200,cancelled:0,days:{'2026-10-15':200}},validRange:true,queryKey:'history',nextCursor:null}
  else if(url.pathname==='/api/access/activity')data={items:[{id:'event',resourceType:'order',resourceId:order.id,action:'order.created',actor:{type:'system'},occurredAt:'2026-10-15T12:00:00Z'}],nextCursor:null}
  else if(url.pathname==='/api/reads/customers')data={clients:[],summary:{count:201,filters:{all:201}},completeHistory:true,nextCursor:null}
  else if(url.pathname==='/api/reads/finance/receivables')data={orders:[],entries:[],groups:[],summary:{today:{amount:4000,count:200},upcoming:{amount:0,count:0},overdue:{amount:0,count:0}},forecast:{days:[]},receivedToday:0,matchingCount:200,matchingGroupCount:100,nextCursor:null}
  else if(url.pathname==='/api/reads/finance/movements')data={movements:[],totals:{entries:5000,exits:100,balance:4900},currentBalance:4900,financeSettings:null,summary:{count:201},nextCursor:null}
  else if(url.pathname==='/api/reads/finance/overview')data={dashboard:{totals:{salesToday:2000,receivedToday:1000,receivables:500},analytics:{metrics:{sales:20000,orderCount:200,averageTicket:100},daily:[],topProducts:[],mealsSold:200,paymentMix:[]}}}
  else if(url.pathname==='/api/realtime/prepare')return{ok:false,status:404,json:async()=>({error:{code:'REALTIME_DISABLED',message:'disabled'}})}
  else if(url.pathname==='/api/orders/by-ids')data={orders:[order]}
  else if(url.pathname==='/api/reads/orders/active')data={orders:[]}
  else if(url.pathname==='/api/orders')data={orders:[order]}
  assert.ok(data,'Unexpected request '+url.pathname+url.search)
  return{ok:true,status:200,json:async()=>data}
 }
 const {default:App}=await h.load('/src/App.jsx'),mounted=await h.renderAdminApp(App,{}, {initialEntries:[path]})
 return{...mounted,h,calls,setBootstrapFailure:value=>{bootstrapFailure=value}}
}
test('scoped deep links finish bootstrap and load history totals from the dedicated read owner',async t=>{
 const {renderer,calls}=await mount(t,'/pedidos/historico')
 assert.match(nodeText(renderer.root),/Histórico de pedidos|Consulte pedidos finalizados/)
 assert.match(nodeText(renderer.root),/200 registro/)
 assert.ok(calls.some(path=>path.startsWith('/api/reads/orders/history')))
 assert.ok(calls.filter(path=>path.startsWith('/api/bootstrap')).every(path=>new URL(path,'https://example.test').searchParams.has('surface')))
 assert.equal(calls.includes('/api/orders'),false)
})
test('kitchen, product and new-order scoped deep links open with confirmed configuration and without integral orders',async t=>{
 for(const [path,text] of [['/pedidos','Cozinha'],['/produtos','Produtos'],['/pedidos/novo','Nova venda']])await t.test(path,async t=>{
  const {renderer,calls}=await mount(t,path)
  assert.doesNotMatch(nodeText(renderer.root),/Não foi possível carregar|Carregando os dados/)
  assert.match(nodeText(renderer.root),new RegExp(text))
  assert.equal(calls.includes('/api/orders'),false)
  assert.ok(calls.filter(p=>p.startsWith('/api/bootstrap')).every(p=>new URL(p,'https://example.test').searchParams.has('surface')))
 })
})
test('a denied history deep link bootstraps shell and lets the route gate return to the permitted kitchen',async t=>{
 const {renderer,router,calls}=await mount(t,'/pedidos/historico',{grants:['orders.view']})
 assert.equal(router.state.location.pathname,'/pedidos')
 assert.match(nodeText(renderer.root),/Cozinha/)
 assert.equal(calls.some(p=>p.startsWith('/api/reads/orders/history')),false)
 assert.ok(calls.filter(p=>p.startsWith('/api/bootstrap')).every(p=>new URL(p,'https://example.test').searchParams.get('surface')!=='history'))
})

test('failed scoped startup exposes retry and opens the same history deep link after connection recovery',async t=>{
 const {renderer,setBootstrapFailure}=await mount(t,'/pedidos/historico',{failBootstrap:true})
 assert.match(nodeText(renderer.root),/Não foi possível carregar os dados/)
 setBootstrapFailure(false)
 await act(async()=>buttonNamed(renderer.root,'Tentar novamente').props.onClick())
 assert.match(nodeText(renderer.root),/200 registro/)
 assert.doesNotMatch(nodeText(renderer.root),/Não foi possível carregar os dados/)
})

test('receiving from a scoped historical detail prepares the canonical order and opens the existing payment owner',async t=>{
 const {renderer,calls}=await mount(t,'/pedidos/historico',{grants:[...capabilities,'payments.receive']})
 await act(async()=>renderer.root.findByProps({'aria-label':'Ver detalhes do Pedido #1'}).props.onClick({target:{closest:()=>null}}))
 await act(async()=>buttonNamed(renderer.root,'Registrar pagamento').props.onClick())
 assert.ok(buttonNamed(renderer.root,'Confirmar pagamento'))
 assert.ok(calls.some(path=>path.startsWith('/api/orders/by-ids?')))
 assert.equal(calls.includes('/api/orders'),false)
})

test('scoped customer and financial deep links show global server totals without loading integral orders or movements',async t=>{
 for(const [path,expected,endpoint] of [['/clientes',/201 clientes/,'customers'],['/financeiro/a-receber',/200 pedido/,'finance/receivables'],['/financeiro/movimentacoes',/201 registro/,'finance/movements'],['/financeiro',/20\.000,00/,'finance/overview']])await t.test(path,async t=>{
  const {renderer,calls}=await mount(t,path,{grants:[...capabilities,'finance.overview','finance.movements','finance.receivables']})
  assert.match(nodeText(renderer.root),expected)
  assert.ok(calls.some(p=>p.startsWith('/api/reads/'+endpoint)))
  assert.equal(calls.includes('/api/orders'),false);assert.equal(calls.includes('/api/movements'),false)
  assert.doesNotMatch(nodeText(renderer.root),/Não foi possível carregar|Carregando os dados/)
 })
})

test('scoped kitchen finished counter is server-authorized and independent of active order payload',async t=>{
 const {renderer,calls}=await mount(t,'/pedidos')
 const cards=renderer.root.findAll(node=>typeof node.props.className==='string'&&node.props.className.includes('kitchen-stat-finished'))
 assert.ok(cards.some(node=>nodeText(node).includes('12')))
 assert.ok(calls.includes('/api/reads/orders/kitchen-summary'))
})

test('audit detail loads its permitted historical order by ID without requiring global history in bootstrap',async t=>{
 const {renderer,calls}=await mount(t,'/configuracoes/atividades',{grants:[...capabilities,'access.audit.view']})
 await act(async()=>buttonNamed(renderer.root,'Abrir detalhe').props.onClick())
 assert.ok(calls.some(path=>path.startsWith('/api/orders/by-ids?')))
 assert.ok(renderer.root.findAllByProps({role:'dialog'}).some(dialog=>nodeText(dialog).includes('Cliente fictício')))
 assert.equal(calls.includes('/api/orders'),false)
})


test('surface navigation preserves the shell and replaces only content while its existing bootstrap is pending',async t=>{
 const {renderer,router,calls}=await mount(t,'/pedidos')
 const shell=renderer.root.findByProps({className:'app-shell'})
 const fetchReady=globalThis.fetch
 let release
 const pending=new Promise(resolve=>{release=resolve})
 globalThis.fetch=async(path,...args)=>{
  if(String(path).includes('/api/bootstrap')&&String(path).includes('surface=clients'))await pending
  return fetchReady(path,...args)
 }
 const before=calls.filter(path=>path.startsWith('/api/bootstrap')).length
 await act(async()=>{await router.navigate('/clientes')})
 assert.equal(renderer.root.findByProps({className:'app-shell'}),shell,'navigation must retain the mounted shell')
 assert.equal(renderer.root.findAllByProps({'aria-label':'Carregando Mesiva'}).length,0)
 assert.equal(renderer.root.findAllByProps({'aria-label':'Carregando conteúdo da tela'}).length,1)
 assert.equal(renderer.root.findAllByProps({'aria-label':'Criar cliente'}).length,0,'actions cannot mount with the previous surface snapshot')
 await act(async()=>{release();await pending})
 assert.match(nodeText(renderer.root),/201 clientes/)
 assert.equal(renderer.root.findByProps({className:'app-shell'}),shell)
 assert.equal(renderer.root.findAllByProps({'aria-label':'Carregando conteúdo da tela'}).length,0)
 assert.equal(calls.filter(path=>path.startsWith('/api/bootstrap')).length-before,1,'skeleton must reuse the navigation request')
 assert.equal(calls.filter(path=>path.startsWith('/api/reads/customers')).length,1)
})

test('a failed surface load keeps navigation available and retries without returning to startup',async t=>{
 const {renderer,router,setBootstrapFailure}=await mount(t,'/pedidos')
 const shell=renderer.root.findByProps({className:'app-shell'})
 setBootstrapFailure(true)
 await act(async()=>{await router.navigate('/clientes')})
 assert.equal(renderer.root.findByProps({className:'app-shell'}),shell)
 assert.match(nodeText(renderer.root),/Não foi possível carregar os dados/)
 assert.equal(renderer.root.findAllByProps({'aria-label':'Carregando Mesiva'}).length,0)
 setBootstrapFailure(false)
 await act(async()=>buttonNamed(renderer.root,'Tentar novamente').props.onClick())
 assert.equal(renderer.root.findByProps({className:'app-shell'}),shell)
 assert.match(nodeText(renderer.root),/201 clientes/)
})


test('returning to visited screens reuses snapshots and queries without another loading screen or read',async t=>{
 const {renderer,router,calls}=await mount(t,'/pedidos',{grants:[...capabilities,'finance.overview','finance.movements','finance.receivables']})
 // Finish the disabled-socket fixture's initial reconciliation before measuring navigation.
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,300))})
 for(const path of ['/clientes','/financeiro','/financeiro/a-receber','/financeiro/movimentacoes','/pedidos/historico','/pedidos'])await act(async()=>{await router.navigate(path)})
 const dataReads=()=>calls.filter(path=>path.startsWith('/api/bootstrap') || path.startsWith('/api/reads/'))
 const before=dataReads().length
 for(const path of ['/clientes','/financeiro','/financeiro/a-receber','/financeiro/movimentacoes','/pedidos/historico','/pedidos']){
  await act(async()=>{await router.navigate(path)})
  assert.equal(renderer.root.findAllByProps({'aria-label':'Carregando Mesiva'}).length,0)
  assert.equal(renderer.root.findAll(node=>node.props.className?.startsWith?.('page-skeleton ')).length,0)
 }
 assert.equal(dataReads().length,before,JSON.stringify(dataReads().slice(before)))
})
