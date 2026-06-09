import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import fs from 'fs'

const SKIP_FIELDS = new Set([
  'mirakl-acceptance-status', 'mirakl-authorized-selling-shop-ids', 'mirakl-catalogs',
  'mirakl-creation-date', 'mirakl-integration-errors',
  'mirakl-last-operator-acceptance-action-date',
  'mirakl-last-operator-acceptance-action-user-name', 'mirakl-product-id',
  'mirakl-product-urls', 'mirakl-rejection-message', 'mirakl-rejection-reason',
  'mirakl-restricted-selling', 'mirakl-sources', 'mirakl-synchronization-status',
  'mirakl-update-date', 'mirakl-validation-status', 'vgc',
])

const DEFAULT_TAX = 'P0000000'

function cleanValue(field: string, value: string): string {
  if (!value) return value
  if (field === 'itemRefundable') value = value.replace(/^itemRefundable_/, '')
  else if (field === 'isBackordered') value = value.replace(/^Is_Backordered_/, '')
  return value
}

function toNumber(val: unknown): number | null {
  if (val === null || val === undefined || String(val).trim() === '') return null
  const f = parseFloat(String(val))
  if (isNaN(f)) return null
  return f === Math.floor(f) ? Math.floor(f) : f
}

function stripPrefix(sku: string): string {
  return sku.replace(/^SHOP\d+_SKU/, '')
}

function indexToColLetter(idx: number): string {
  let result = ''
  let n = idx + 1
  while (n > 0) {
    const r = (n - 1) % 26
    result = String.fromCharCode(65 + r) + result
    n = Math.floor((n - 1) / 26)
  }
  return result
}

function xmlEscape(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function makeCellXml(colLetter: string, rowNum: number, value: unknown): string {
  const ref = `${colLetter}${rowNum}`
  if (typeof value === 'number') {
    return `<c r="${ref}"><v>${value}</v></c>`
  }
  return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(String(value))}</t></is></c>`
}

export interface TransformResult {
  products: number
  offers_matched: number
  unmatched_products: string[]
  unmatched_offers: string[]
}

export async function transform(
  csvPath: string,
  offerPath: string,
  templatePath: string,
  outputPath: string
): Promise<TransformResult> {
  // Load offers from xlsx
  const offerWb = XLSX.read(fs.readFileSync(offerPath), { type: 'buffer' })
  const offerWs = offerWb.Sheets[offerWb.SheetNames[0]]
  const offerRows = XLSX.utils.sheet_to_json(offerWs) as Record<string, unknown>[]
  const offers: Record<string, Record<string, unknown>> = {}
  for (const row of offerRows) {
    if (row['Offer SKU']) {
      offers[String(row['Offer SKU']).trim()] = row
    }
  }

  // Load products from CSV — read as UTF-8 string so all special chars are preserved
  const csvWb = XLSX.read(fs.readFileSync(csvPath, 'utf-8'), { type: 'string' })
  const csvWs = csvWb.Sheets[csvWb.SheetNames[0]]
  const exportRows = XLSX.utils.sheet_to_json(csvWs) as Record<string, string>[]

  // Get field→column mapping from template row 2 (index 1)
  const templateWb = XLSX.read(fs.readFileSync(templatePath), { type: 'buffer' })
  const templateWs = templateWb.Sheets['Data']
  const templateArr = XLSX.utils.sheet_to_json(templateWs, { header: 1 }) as unknown[][]
  const headerRow = (templateArr[1] || []) as unknown[]
  const fieldToCol: Record<string, number> = {}
  headerRow.forEach((val, idx) => {
    if (val) fieldToCol[String(val).trim()] = idx
  })

  // Compute mismatches
  const productBaseSkus = new Set(
    exportRows.map(p => stripPrefix(String(p['mirakl-product-sku'] || '').trim()))
  )
  const offerSkus = new Set(Object.keys(offers))
  const unmatchedProducts = [...productBaseSkus].filter(s => !offerSkus.has(s)).sort()
  const unmatchedOffers = [...offerSkus].filter(s => !productBaseSkus.has(s)).sort()

  // Build row XML
  const rowXmlBlocks: string[] = []
  for (let idx = 0; idx < exportRows.length; idx++) {
    const exp = exportRows[idx]
    const rowNum = idx + 3
    const baseSku = stripPrefix(String(exp['mirakl-product-sku'] || '').trim())
    const tSku = baseSku + '-Deals'
    const offer = offers[baseSku] || {}
    const hasOffer = Object.keys(offer).length > 0
    const cells: Record<number, unknown> = {}
    const SENTINEL = Symbol()

    for (const [field, colIdx] of Object.entries(fieldToCol)) {
      let val: unknown = SENTINEL

      if (['shopSku', 'upc', 'sku', 'product-id'].includes(field)) {
        val = tSku
      } else if (field === 'product-id-type') {
        val = 'SHOP_SKU'
      } else if (field === 'vgc' || field === 'vg-name') {
        const v = cleanValue('vg-name', String(exp['vg-name'] || '').trim())
        val = v || SENTINEL
      } else if (field === 'state') {
        val = 'New'
      } else if (field === 'price') {
        const n = hasOffer ? toNumber(offer['Original price']) : null
        val = n !== null ? n : SENTINEL
      } else if (field === 'quantity') {
        if (hasOffer) {
          const n = toNumber(offer['Quantity'])
          val = n !== null ? n : SENTINEL
        }
      } else if (field === 'discount-price') {
        const n = hasOffer ? toNumber(offer['Price']) : null
        val = n !== null ? n : SENTINEL
      } else if (field === 'product-tax-code') {
        if (hasOffer) {
          const t = String(offer['Product tax code'] || '').trim()
          val = t || DEFAULT_TAX
        }
      } else if (field in exp && !SKIP_FIELDS.has(field)) {
        const c = cleanValue(field, String(exp[field] || '').trim())
        val = c || SENTINEL
      }

      if (typeof val !== 'symbol') {
        cells[colIdx] = val
      }
    }

    const cellXml = Object.entries(cells)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([colIdx, v]) => makeCellXml(indexToColLetter(Number(colIdx)), rowNum, v))
      .join('')

    rowXmlBlocks.push(`<row r="${rowNum}">${cellXml}</row>`)
  }

  // Inject rows into template ZIP and write output
  const templateBuffer = fs.readFileSync(templatePath)
  const zip = await JSZip.loadAsync(templateBuffer)

  const sheetFile = zip.file('xl/worksheets/sheet1.xml')
  if (!sheetFile) throw new Error('Could not find sheet1.xml in template zip')

  let sheetXml = await sheetFile.async('string')
  sheetXml = sheetXml.replace('</sheetData>', rowXmlBlocks.join('') + '</sheetData>')
  zip.file('xl/worksheets/sheet1.xml', sheetXml)

  const outputBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  fs.writeFileSync(outputPath, outputBuffer)

  const offersMatched = exportRows.filter(p =>
    stripPrefix(String(p['mirakl-product-sku'] || '').trim()) in offers
  ).length

  return {
    products: exportRows.length,
    offers_matched: offersMatched,
    unmatched_products: unmatchedProducts,
    unmatched_offers: unmatchedOffers,
  }
}
