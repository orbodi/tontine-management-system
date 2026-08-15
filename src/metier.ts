import {
  MOIS_MIN_RETRAIT_CARTE,
  type ArretCaisse,
  type CarnetTontine,
  type Credit,
  type MiseTontine,
  type Remboursement,
  type Transaction,
  type TypeCarnet,
  type TypeTransaction,
} from './types'

// ---------- Journal ----------

export const LIBELLES_TYPE: Record<TypeTransaction, string> = {
  vente_carnet: 'Vente de carnet',
  mise_tontine: 'Dépôt',
  retrait_tontine: 'Retrait',
  commission_tontine: 'Première cotisation (P.C)',
  depot_compte: 'Dépôt',
  retrait_compte: 'Retrait',
  octroi_credit: 'Octroi de crédit',
  remboursement_credit: 'Remboursement crédit',
}

export const TYPES_SORTIE: TypeTransaction[] = ['retrait_tontine', 'retrait_compte', 'octroi_credit']

// ---------- Carnets ----------

export const LIBELLES_CARNET: Record<TypeCarnet, string> = {
  tontine: 'Tontine',
  carte_tous: 'Carte pour tous',
  carte_enfants: 'Carte pour enfants',
  carte_bloquee: 'Carte bloquée',
}

export const CARNETS_RETRAIT_6_MOIS: TypeCarnet[] = ['carte_enfants', 'carte_bloquee']

export interface EligibiliteRetraitCarnet {
  autorise: boolean
  dateDeblocage?: string
}

export function eligibiliteRetraitCarnet(
  carnet: CarnetTontine,
  mises: MiseTontine[],
): EligibiliteRetraitCarnet {
  if (!CARNETS_RETRAIT_6_MOIS.includes(carnet.typeCarnet)) return { autorise: true }
  const datesMises = mises
    .filter((m) => m.carnetId === carnet.id && m.nombreMises > 0)
    .map((m) => m.date)
    .sort()
  const debut = datesMises[0] ?? carnet.dateOuverture
  const deblocage = new Date(debut)
  deblocage.setMonth(deblocage.getMonth() + MOIS_MIN_RETRAIT_CARTE)
  if (Date.now() >= deblocage.getTime()) return { autorise: true }
  return { autorise: false, dateDeblocage: deblocage.toISOString() }
}

/** Carreaux nets du cycle (cotisations − retraits partiels). */
export function carreauxNets(carnet: CarnetTontine, mises: MiseTontine[], cycle?: number): number {
  const c = cycle ?? carnet.cycleActuel
  return mises
    .filter((m) => m.carnetId === carnet.id && m.cycle === c)
    .reduce((s, m) => s + m.nombreMises, 0)
}

/**
 * Calcule le nombre de mises à partir d'un montant cotisé.
 * Le montant doit être un multiple strict de la mise.
 */
export function calculerMisesDepuisMontant(
  montant: number,
  mise: number,
): { ok: true; nombreMises: number } | { ok: false; erreur: string } {
  if (mise <= 0) return { ok: false, erreur: 'Montant de mise invalide.' }
  if (montant <= 0) return { ok: false, erreur: 'Le montant cotisé doit être positif.' }
  if (montant % mise !== 0) {
    return {
      ok: false,
      erreur: `Incohérence : ${montant} FCFA n'est pas un multiple de la mise (${mise} FCFA).`,
    }
  }
  return { ok: true, nombreMises: montant / mise }
}

// ---------- Caisse ----------

export interface SituationCaisse {
  debutPeriode: string | null
  nombreOperations: number
  totalEntrees: number
  totalSorties: number
  soldeTheorique: number
  transactions: Transaction[]
  dernierArret: ArretCaisse | null
}

export function situationCaisse(
  employeId: string,
  transactions: Transaction[],
  arretsCaisse: ArretCaisse[],
): SituationCaisse {
  const dernierArret =
    arretsCaisse
      .filter((a) => a.employeId === employeId)
      .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null

  const periode = transactions
    .filter((t) => t.operateurId === employeId && (!dernierArret || t.date > dernierArret.date))
    .sort((a, b) => b.date.localeCompare(a.date))

  let totalEntrees = 0
  let totalSorties = 0
  periode.forEach((t) => {
    if (TYPES_SORTIE.includes(t.type)) totalSorties += t.montant
    else totalEntrees += t.montant
  })

  const dates = periode.map((t) => t.date).sort()
  return {
    debutPeriode: dernierArret?.date ?? dates[0] ?? null,
    nombreOperations: periode.length,
    totalEntrees,
    totalSorties,
    soldeTheorique: totalEntrees - totalSorties,
    transactions: periode,
    dernierArret,
  }
}

/** État journalier d'une caisse (ou d'une agence) pour une date ISO (YYYY-MM-DD). */
export function etatJournalierCaisse(
  transactions: Transaction[],
  dateIso: string,
  filtres?: { employeId?: string; agenceId?: string },
): {
  duJour: Transaction[]
  entrees: number
  sorties: number
  parType: Map<TypeTransaction, { entrees: number; sorties: number; nombre: number }>
} {
  const duJour = transactions.filter((t) => {
    if (t.date.slice(0, 10) !== dateIso) return false
    if (filtres?.employeId && t.operateurId !== filtres.employeId) return false
    if (filtres?.agenceId && t.agenceId !== filtres.agenceId) return false
    return true
  })
  const parType = new Map<TypeTransaction, { entrees: number; sorties: number; nombre: number }>()
  let entrees = 0
  let sorties = 0
  duJour.forEach((t) => {
    const ligne = parType.get(t.type) ?? { entrees: 0, sorties: 0, nombre: 0 }
    ligne.nombre++
    if (TYPES_SORTIE.includes(t.type)) {
      ligne.sorties += t.montant
      sorties += t.montant
    } else {
      ligne.entrees += t.montant
      entrees += t.montant
    }
    parType.set(t.type, ligne)
  })
  return { duJour, entrees, sorties, parType }
}

// ---------- Crédits ----------

export interface SituationCredit {
  totalDu: number
  mensualite: number
  dejaPaye: number
  resteAPayer: number
  echeancesPayees: number
  echeancesAttendues: number
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
