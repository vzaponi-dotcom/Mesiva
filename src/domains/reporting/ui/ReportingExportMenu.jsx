import { useContextApi } from '../../../infrastructure/api/ContextApi.js'
import { useEffect, useRef, useState } from 'react'
import { reportingApi, createReportingApi } from '../infrastructure/reportingApi.js'

const EXPORT_OPTIONS = Object.freeze([
  {
    format: 'xlsx',
    title: 'Excel — Pedidos do período',
    description: 'Base completa, uma linha por pedido, pronta para análise.',
  },
  {
    format: 'csv',
    title: 'CSV — Pedidos do período',
    description: 'Dados tabulares completos para importar ou analisar.',
  },
  {
    format: 'pdf',
    title: 'PDF — Resumo executivo',
    description: 'Resumo gerencial em duas páginas, com KPIs, mix, ranking e oportunidades.',
  },
])

const download = ({ blob, filename }) => {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

const filenameFor = (format, query) => format === 'pdf'
  ? `resumo-relatorio-${query.from}-${query.to}.pdf`
  : `pedidos-${query.from}-${query.to}.${format}`

export function ReportingExportMenu({ query, granted, api: suppliedApi = reportingApi, onDownload = download }) {
  const api = useContextApi(createReportingApi, suppliedApi, reportingApi)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const detailsRef = useRef(null)
  const allowed = granted instanceof Set && granted.has('reports.export')
  const ownerRef = useRef(null), operationRef = useRef(null), mounted = useRef(false)
  ownerRef.current = { api, allowed }
  useEffect(() => {
    mounted.current = true; setBusy(false); setError(null)
    return () => { mounted.current = false; operationRef.current?.abort(); operationRef.current = null }
  }, [api, allowed])

  if (!allowed) return null

  const run = async (format) => {
    if (!mounted.current || operationRef.current || ownerRef.current.api !== api || !ownerRef.current.allowed) return
    const operation = new AbortController(); operationRef.current = operation
    const current = () => mounted.current && operationRef.current === operation && ownerRef.current.api === api && ownerRef.current.allowed
    setBusy(true)
    setError(null)
    try {
      // Excel e CSV sempre recebem a base detalhada completa do recorte.
      // O PDF solicita também o modelo executivo multi-visão para compor as duas páginas.
      const response = await api.exportModel(query, null, { format, signal: operation.signal })
      if (!current()) return
      const model = response.data
      let blob

      if (format === 'csv') {
        const { exportReportingCsv } = await import('../export/csvExport.js')
        blob = new Blob([exportReportingCsv(model)], { type: 'text/csv;charset=utf-8' })
      } else if (format === 'xlsx') {
        const { createXlsxWorkbook } = await import('../export/xlsxExport.js')
        const workbook = await createXlsxWorkbook(model)
        blob = new Blob(
          [await workbook.xlsx.writeBuffer()],
          { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
        )
      } else {
        const { createPdfSummary } = await import('../export/pdfExport.js')
        blob = (await createPdfSummary(model)).output('blob')
      }

      if (!current()) return
      onDownload({ blob, filename: filenameFor(format, query), format, model })
      if (detailsRef.current) detailsRef.current.open = false
    } catch (cause) {
      if (current()) setError(cause)
    } finally {
      if (current()) { operationRef.current = null; setBusy(false) }
    }
  }

  return <div className="reporting-export">
    <details ref={detailsRef}>
      <summary>Exportar</summary>
      <div className="reporting-export-options">
        <div className="reporting-export-options-heading">
          <strong>Exportar dados</strong>
          <small>{query.view === 'products'
            ? 'A exportação usa o período e os filtros da barra de relatórios.'
            : 'O período e os filtros ativos serão respeitados.'}</small>
        </div>
        {EXPORT_OPTIONS.map((option) => <button
          key={option.format}
          type="button"
          disabled={busy}
          onClick={() => run(option.format)}
        >
          <strong>{option.title}</strong>
          <small>{option.description}</small>
        </button>)}
      </div>
    </details>
    {busy ? <span role="status">Preparando exportação…</span> : null}
    {error ? <p role="alert">{error.message || 'Não foi possível exportar.'}</p> : null}
  </div>
}
