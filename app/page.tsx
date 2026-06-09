'use client'

import { useState, useRef } from 'react'

interface Warnings {
  unmatchedProducts: string[]
  unmatchedOffers: string[]
}

interface TransformResult {
  sessionId: string
  warnings: Warnings
  stats: { productsCount: number; offersCount: number }
}

function FileInput({
  label,
  hint,
  accept,
  file,
  onChange,
}: {
  label: string
  hint: string
  accept: string
  file: File | null
  onChange: (f: File | null) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div className="flex items-center gap-4 p-4 border border-slate-200 rounded-lg bg-white">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-700">{label}</p>
        <p className="text-xs text-slate-400 mt-0.5">{hint}</p>
        {file && (
          <p className="text-xs text-emerald-600 mt-1 truncate font-medium">✓ {file.name}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className="shrink-0 text-sm px-3 py-1.5 rounded border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700 transition-colors"
      >
        {file ? 'Change' : 'Choose file'}
      </button>
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
    </div>
  )
}

function WarningBlock({ title, skus, color }: { title: string; skus: string[]; color: 'amber' | 'red' }) {
  const [open, setOpen] = useState(true)
  const bg = color === 'amber' ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'
  const titleColor = color === 'amber' ? 'text-amber-800' : 'text-red-800'
  const countColor = color === 'amber' ? 'text-amber-600' : 'text-red-600'
  const skuColor = color === 'amber' ? 'text-amber-900' : 'text-red-900'
  return (
    <div className={`border rounded-lg p-4 ${bg}`}>
      <div className="flex items-center justify-between cursor-pointer" onClick={() => setOpen(o => !o)}>
        <p className={`text-sm font-semibold ${titleColor}`}>
          {title}
          <span className={`ml-2 font-normal text-xs ${countColor}`}>({skus.length})</span>
        </p>
        <span className={`text-xs ${countColor}`}>{open ? '▲ hide' : '▼ show'}</span>
      </div>
      {open && (
        <ul className="mt-2 space-y-0.5 max-h-40 overflow-y-auto">
          {skus.map(s => (
            <li key={s} className={`text-xs font-mono ${skuColor}`}>{s}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function Page() {
  const [productExport, setProductExport] = useState<File | null>(null)
  const [offerExport, setOfferExport] = useState<File | null>(null)
  const [importTemplate, setImportTemplate] = useState<File | null>(null)

  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [result, setResult] = useState<TransformResult | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [downloading, setDownloading] = useState(false)

  const allFilesReady = productExport && offerExport && importTemplate
  const hasWarnings = result && (result.warnings.unmatchedProducts.length > 0 || result.warnings.unmatchedOffers.length > 0)

  async function runTransform() {
    if (!allFilesReady) return
    setStatus('running')
    setResult(null)
    setErrorMsg('')

    const form = new FormData()
    form.append('productExport', productExport)
    form.append('offerExport', offerExport)
    form.append('importTemplate', importTemplate)

    try {
      const res = await fetch('/api/transform', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) {
        setErrorMsg(data.error ?? 'Transformation failed.')
        setStatus('error')
        return
      }
      setResult(data)
      setStatus('done')
    } catch (e) {
      setErrorMsg('Network error — is the server running?')
      setStatus('error')
    }
  }

  async function downloadFile() {
    if (!result) return
    setDownloading(true)
    try {
      const res = await fetch(`/api/download?session=${result.sessionId}`)
      if (!res.ok) {
        const d = await res.json()
        alert(d.error ?? 'Download failed.')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'products-and-offers-FILLED.xlsx'
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-start py-16 px-4">
      <div className="w-full max-w-xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900">Last Chance Market</h1>
          <p className="text-slate-500 mt-1 text-sm">Product import file generator</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-3">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-4">Upload files</h2>
          <FileInput
            label="1. Product Export"
            hint="export-products-XXXXX.csv"
            accept=".csv"
            file={productExport}
            onChange={setProductExport}
          />
          <FileInput
            label="2. Offer Export"
            hint="offers.xlsx"
            accept=".xlsx,.xls"
            file={offerExport}
            onChange={setOfferExport}
          />
          <FileInput
            label="3. Import Template"
            hint="products-and-offers-en_US-XXXXX.xlsx"
            accept=".xlsx,.xls"
            file={importTemplate}
            onChange={setImportTemplate}
          />

          <div className="pt-2">
            <button
              onClick={runTransform}
              disabled={!allFilesReady || status === 'running'}
              className="w-full py-2.5 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {status === 'running' ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Running transformation…
                </span>
              ) : 'Run Transformation'}
            </button>
          </div>
        </div>

        {status === 'error' && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm font-semibold text-red-800">Error</p>
            <p className="text-sm text-red-700 mt-1 font-mono whitespace-pre-wrap">{errorMsg}</p>
          </div>
        )}

        {status === 'done' && result && (
          <div className="mt-4 space-y-3">
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
              <p className="text-sm font-semibold text-emerald-800">Transformation complete</p>
              <p className="text-xs text-emerald-600 mt-0.5">
                {result.stats.productsCount} products · {result.stats.offersCount} offers loaded
              </p>
            </div>

            {hasWarnings && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">SKU Warnings — review before downloading</p>
                {result.warnings.unmatchedProducts.length > 0 && (
                  <WarningBlock
                    title="Products with no matching offer"
                    skus={result.warnings.unmatchedProducts}
                    color="amber"
                  />
                )}
                {result.warnings.unmatchedOffers.length > 0 && (
                  <WarningBlock
                    title="Offers with no matching product"
                    skus={result.warnings.unmatchedOffers}
                    color="red"
                  />
                )}
              </div>
            )}

            <button
              onClick={downloadFile}
              disabled={downloading}
              className="w-full py-2.5 rounded-lg bg-emerald-700 text-white text-sm font-medium hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {downloading ? 'Preparing download…' : hasWarnings ? 'Proceed & Download' : 'Download Import File'}
            </button>
          </div>
        )}
      </div>
    </main>
  )
}
