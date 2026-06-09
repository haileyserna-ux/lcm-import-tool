import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir, access } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

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

  const scriptPath = join(process.cwd(), 'backend', 'transform.py')
  const cmd = `python3 "${scriptPath}" "${csvPath}" "${offerPath}" "${templatePath}" "${outputPath}"`

  console.log('[transform] cwd:', process.cwd())
  console.log('[transform] command:', cmd)

  let stdout: string
  let stderr: string
  try {
    const result = await execAsync(cmd)
    stdout = result.stdout
    stderr = result.stderr
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string }
    console.error('[transform] script threw — stdout:', e.stdout)
    console.error('[transform] script threw — stderr:', e.stderr)
    console.error('[transform] script threw — message:', e.message)
    const detail = e.stderr || e.stdout || e.message || 'Unknown error'
    return NextResponse.json({ error: `Python script failed:\n${detail}` }, { status: 500 })
  }

  console.log('[transform] stdout:', stdout)
  console.log('[transform] stderr:', stderr)

  // Confirm the script actually wrote the output file
  try {
    await access(outputPath)
  } catch {
    return NextResponse.json(
      { error: `Script exited without writing the output file.\nstdout: ${stdout}\nstderr: ${stderr}` },
      { status: 500 }
    )
  }

  // Parse warnings from stdout if present; tolerate empty or non-JSON stdout
  let warnings = { unmatchedProducts: [] as string[], unmatchedOffers: [] as string[] }
  let stats = { productsCount: 0, offersCount: 0 }
  const trimmed = stdout.trim()
  if (trimmed) {
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed.warnings) warnings = parsed.warnings
      if (parsed.stats) stats = parsed.stats
      // Python script returns flat keys, not nested under "stats"
      if (parsed.products !== undefined) stats.productsCount = parsed.products
      if (parsed.offers_matched !== undefined) stats.offersCount = parsed.offers_matched
    } catch {
      // stdout wasn't JSON — script still ran fine, no structured warnings available
    }
  }

  return NextResponse.json({ sessionId, warnings, stats })
}
