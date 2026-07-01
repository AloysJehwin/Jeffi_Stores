import { NextResponse } from 'next/server'

const DEFAULT_TAT = 5

function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from)
  let added = 0
  while (added < days) {
    d.setDate(d.getDate() + 1)
    if (d.getDay() !== 0) added++
  }
  return d
}

export async function GET() {
  const edd = addBusinessDays(new Date(), DEFAULT_TAT).toISOString().slice(0, 10)
  return NextResponse.json({ edd })
}
