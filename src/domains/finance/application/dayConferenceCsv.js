const csvText = value => {
  const text=String(value??'')
  // Identificadores e formas são texto não confiável, nunca fórmulas de planilha.
  return '"'+(/^[\s]*[=+\-@]/.test(text)?"'"+text:text).replaceAll('"','""')+'"'
}

export async function buildDayConferenceCsv({request,summary,signal}) {
  const rows=[['Conferência de recebimentos',summary.date],['Fuso','America/Sao_Paulo'],
    ['Versão da fonte',summary.sourceVersion],['Alertas de integridade',summary.integrityIssues],
    ['Valores em centavos; saídas negativas; não representa fechamento de gaveta'],[],
    ['Data financeira','Registrado em (São Paulo)','Forma','Origem','Status','Movimento','Recebimento','Pedido ID','Pedido número','Valor com sinal (centavos)']]
  const ids=new Set()
  for(const method of summary.methods) {
    let page=1,count=0,gross=0,refund=0
    while(page!==null) {
      signal?.throwIfAborted()
      const params=new URLSearchParams({date:summary.date,method:method.method,page:String(page),sourceVersion:summary.sourceVersion})
      const result=await request('/api/finance/day-conference/entries?'+params,{signal})
      signal?.throwIfAborted()
      for(const entry of result.entries) {
        if(ids.has(entry.id)||entry.method!==method.method||entry.date!==summary.date
          ||!Number.isSafeInteger(entry.amountCents)||entry.amountCents<0||!['entrada','saida'].includes(entry.type)) {
          throw new Error('Lançamento inválido. Atualize os recebimentos antes de exportar.')
        }
        ids.add(entry.id);count++
        if(entry.type==='entrada')gross+=entry.amountCents;else refund+=entry.amountCents
        rows.push([entry.date,entry.createdAt?new Date(entry.createdAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'',
          entry.method,entry.source,'Ativo',entry.id,entry.receiptId,entry.orderId,entry.orderNumber,
          entry.type==='saida'?-entry.amountCents:entry.amountCents])
      }
      if(result.nextPage!==null&&result.nextPage!==page+1)throw new Error('Paginação inválida. Nenhum arquivo foi exportado.')
      page=result.nextPage
    }
    if(count!==method.count||gross!==method.grossCents||refund!==method.refundCents) {
      throw new Error('O detalhe não reconcilia com o resumo. Atualize antes de exportar.')
    }
  }
  return '\uFEFF'+rows.map(row=>row.map(value=>typeof value==='number'?String(value):csvText(value)).join(',')).join('\r\n')
}
