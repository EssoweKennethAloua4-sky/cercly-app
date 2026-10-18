// Frais d'envoi (Mobile Money) : le membre envoie « cotisation + frais », seule la cotisation compte.

export interface FeeTier {
  max: number // montant envoye maximum de la tranche (inclus)
  fee: number // frais de cette tranche
}

// Tarif de retrait « Mixx by Yas » (affiche en agence), utilise comme bareme propose par defaut.
export const MIXX_BY_YAS: FeeTier[] = [
  { max: 500, fee: 50 },
  { max: 5000, fee: 100 },
  { max: 20000, fee: 300 },
  { max: 50000, fee: 600 },
  { max: 100000, fee: 1000 },
  { max: 200000, fee: 3100 },
  { max: 300000, fee: 3700 },
  { max: 500000, fee: 4200 },
  { max: 850000, fee: 4400 },
  { max: 900000, fee: 4600 },
  { max: 950000, fee: 4900 },
  { max: 1000000, fee: 5100 },
  { max: 1100000, fee: 5400 },
  { max: 1150000, fee: 5900 },
  { max: 1200000, fee: 6200 },
  { max: 1250000, fee: 6500 },
  { max: 1300000, fee: 6800 },
  { max: 1350000, fee: 7000 },
  { max: 1400000, fee: 7300 },
  { max: 1450000, fee: 7600 },
  { max: 1500000, fee: 7800 },
  { max: 2000000, fee: 9700 },
]

export function parseFeeTable(raw: unknown): FeeTier[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const tiers = raw
    .map((t) => ({ max: Number((t as FeeTier)?.max), fee: Number((t as FeeTier)?.fee) }))
    .filter((t) => t.max > 0 && t.fee >= 0)
    .sort((a, b) => a.max - b.max)
  return tiers.length > 0 ? tiers : null
}

// Frais pour un montant ENVOYE (frais compris). Au-dela de la derniere tranche : frais de la derniere.
export function feeFor(sent: number, table: FeeTier[] | null): number {
  if (!table || !(sent > 0)) return 0
  const tier = table.find((t) => sent <= t.max) ?? table[table.length - 1]
  return tier && tier.fee < sent ? tier.fee : 0
}
