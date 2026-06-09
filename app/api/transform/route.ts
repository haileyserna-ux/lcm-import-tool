import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { transform } from '@/lib/transform'

export async function POST(request: NextRequest) {
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Failed to parse form data.' }, { status: 400 })
  }

  const productExport = formData.get('productExport') as File | null
  const offerExport = formData.get('offerExport') as File | null
  const importTemplate = formData.get('importTemplate') as File | null

  if (!productExport || !offerExport || !importTemplate) {
    return NextResponse.json({ error: 'All three files are required.' }, { status: 400 })
  }

  const sessionId = randomUUID()
  const sessionDir = join('/tmp', 'lcm-sessions', sessionId)
  await mkdir(sessionDir, { recursive: true })

  const csvPath = join(sessionDir, 'export.csv')
  const offerPath = join(sessionDir, 'offers.xlsx')
  const templatePath = join(sessionDir, 'template.xlsx')
  const outputPath = join(sessionDir, 'output.xlsx')

  await Promise.all([
    writeFile(csvPath, Buffer.from(await productExport.arrayBuffer())),
    writeFile(offerPath, Buffer.from(await offerExport.arrayBuffer())),
    writeFile(templatePath, Buffer.from(await importTemplate.arrayBuffer())),
  ])

  let stats
  try {
    stats = await transform(csvPath, offerPath, templatePath, outputPath)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[transform] error:', message)
    return NextResponse.json({ error: `Transform failed:\n${message}` }, { status: 500 })
  }

  return NextResponse.json({
    sessionId,
    stats: {
      productsCount: stats.products,
      offersCount: stats.offers_matched,
    },
    warnings: {
      unmatchedProducts: stats.unmatched_products,
      unmatchedOffers: stats.unmatched_offers,
    },
  })
}
