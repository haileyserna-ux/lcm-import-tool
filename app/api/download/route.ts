import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { join } from 'path'

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('session')

  if (!sessionId || !/^[0-9a-f-]{36}$/.test(sessionId)) {
    return NextResponse.json({ error: 'Invalid session ID.' }, { status: 400 })
  }

  const outputPath = join('/tmp', 'lcm-sessions', sessionId, 'output.xlsx')

  let file: Buffer
  try {
    file = await readFile(outputPath)
  } catch {
    return NextResponse.json({ error: 'Output file not found. Run the transformation first.' }, { status: 404 })
  }

  return new NextResponse(new Uint8Array(file), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="products-and-offers-FILLED.xlsx"',
    },
  })
}
