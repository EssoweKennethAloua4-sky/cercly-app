import type { GroupInfo } from '../types'

export type Cell = 'paid' | 'pending' | 'late' | 'due' | 'future' | 'before'

export function fill(s: string, v: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ''))
}

// Montants en centimes pour eviter les erreurs d'arrondi.
export interface Plan {
  expected: number
  initial: number
  sy: number
  sm: number
}

export function parsePlan(g: GroupInfo): Plan | null {
  const expected = Math.round(Number(g.expected_amount ?? 0) * 100)
  if (!(expected > 0) || !g.start_month) return null
  const [y, m] = g.start_month.split('-').map(Number)
  if (!y || !m) return null
  return { expected, initial: Math.round(Number(g.initial_amount ?? 0) * 100), sy: y, sm: m - 1 }
}

export function monthIndex(plan: Plan, y: number, m: number): number {
  return (y - plan.sy) * 12 + (m - plan.sm)
}

export interface Cover {
  full: number
  allFull: number
  monthsCash: number
  initialMissing: number
}

// Les cotisations validees remplissent d'abord l'apport initial, puis chaque mois dans l'ordre.
export function cover(plan: Plan, validated: number, pending: number): Cover {
  const v = Math.round(validated * 100)
  const p = Math.round(pending * 100)
  const monthsCash = Math.max(0, v - plan.initial)
  return {
    full: Math.floor(monthsCash / plan.expected),
    allFull: Math.floor(Math.max(0, v + p - plan.initial) / plan.expected),
    monthsCash,
    initialMissing: Math.max(0, plan.initial - v),
  }
}

export function cellOf(cov: Cover, idx: number, curIdx: number): Cell {
  if (idx < 0) return 'before'
  if (idx < cov.full) return 'paid'
  if (idx < cov.allFull) return 'pending'
  if (idx < curIdx) return 'late'
  if (idx === curIdx) return 'due'
  return 'future'
}

// Une partie d'un paiement : l'apport initial, un mois, ou une serie de mois complets.
export interface Piece {
  kind: 'initial' | 'months'
  from: number
  to: number
  amount: number
  complete: boolean
  rest: number
}

// Repartit, dans l'ordre, des paiements valides (en centimes) sur l'apport puis sur les mois.
export function allocate(plan: Plan, amounts: number[]): Piece[][] {
  let consumed = 0
  const out: Piece[][] = []
  for (const total of amounts) {
    const raw: Piece[] = []
    let remaining = total
    while (remaining > 0) {
      if (consumed < plan.initial) {
        const room = plan.initial - consumed
        const take = Math.min(room, remaining)
        consumed += take
        remaining -= take
        raw.push({ kind: 'initial', from: -1, to: -1, amount: take, complete: take === room, rest: room - take })
      } else {
        const into = consumed - plan.initial
        const idx = Math.floor(into / plan.expected)
        const room = plan.expected - (into - idx * plan.expected)
        const take = Math.min(room, remaining)
        consumed += take
        remaining -= take
        raw.push({ kind: 'months', from: idx, to: idx, amount: take, complete: take === room, rest: room - take })
      }
    }
    const merged: Piece[] = []
    for (const p of raw) {
      const last = merged[merged.length - 1]
      const lastIsRun =
        last !== undefined &&
        last.kind === 'months' &&
        last.complete &&
        last.amount === (last.to - last.from + 1) * plan.expected
      if (lastIsRun && p.kind === 'months' && p.complete && p.amount === plan.expected && p.from === last.to + 1) {
        last.to = p.to
        last.amount += p.amount
      } else {
        merged.push({ ...p })
      }
    }
    out.push(merged)
  }
  return out
}
