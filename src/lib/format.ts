export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'object' && e !== null && 'message' in e) return String((e as { message: unknown }).message)
  return String(e)
}

export const money = (n: number, currency: string, locale: string): string =>
  `${Number(n).toLocaleString(locale)} ${currency}`

export const day = (d: string, locale: string): string =>
  new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString(locale)
