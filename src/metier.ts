import type { Credit, Remboursement } from './types'

export interface SituationCredit {
  totalDu: number
  mensualite: number
  dejaPaye: number
  resteAPayer: number
  echeancesPayees: number
  echeancesAttendues: number // combien d'échéances auraient dû être payées à ce jour
  enRetard: boolean
}

export function situationCredit(credit: Credit, remboursements: Remboursement[]): SituationCredit {
  const totalDu = credit.montant * (1 + credit.tauxInteret / 100)
  const mensualite = Math.round(totalDu / credit.dureeMois)
  const dejaPaye = remboursements
    .filter((r) => r.creditId === credit.id)
    .reduce((s, r) => s + r.montant, 0)
  const resteAPayer = Math.max(0, totalDu - dejaPaye)

  let echeancesAttendues = 0
  if (credit.dateOctroi) {
    const moisEcoules = Math.floor(
      (Date.now() - new Date(credit.dateOctroi).getTime()) / (30 * 86400000),
    )
    echeancesAttendues = Math.min(credit.dureeMois, Math.max(0, moisEcoules))
  }
  const echeancesPayees = Math.floor(dejaPaye / mensualite)
  const actif = credit.statut === 'en_cours' || credit.statut === 'en_retard'
  const enRetard = actif && resteAPayer > 0 && echeancesPayees < echeancesAttendues

  return { totalDu, mensualite, dejaPaye, resteAPayer, echeancesPayees, echeancesAttendues, enRetard }
}
