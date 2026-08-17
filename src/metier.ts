import {
  MOIS_MIN_RETRAIT_CARTE,
  type ArretCaisse,
  type CarnetTontine,
  type Client,
  type CompteCaisse,
  type CompteZoneTontine,
  type Credit,
  type JourneeCompteZone,
  type MiseTontine,
  type Remboursement,
  type StatutJourneeZone,
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

/** Types d'opérations qui alimentent le compte de caisse d'un caissier. */
export const TYPES_OPERATION_CAISSE: TypeTransaction[] = [
  'vente_carnet',
  'mise_tontine',
  'retrait_tontine',
  'commission_tontine',
  'depot_compte',
  'retrait_compte',
  'octroi_credit',
  'remboursement_credit',
]

export function estOperationCaisse(type: TypeTransaction): boolean {
  return TYPES_OPERATION_CAISSE.includes(type)
}

export function compteCaisseDe(
  comptes: CompteCaisse[],
  employeId: string,
): CompteCaisse | undefined {
  return comptes.find((c) => c.employeId === employeId && c.actif)
}

/** Variation de solde pour une opération caisse (+ entrée, − sortie). */
export function deltaSoldeOperationCaisse(type: TypeTransaction, montant: number): number {
  if (!estOperationCaisse(type)) return 0
  return TYPES_SORTIE.includes(type) ? -montant : montant
}

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
  if (!CARNETS_RETRAIT_6_MOIS.includes(carnet.typeCarnet)) {
    return { autorise: true }
  }
  // Cartes enfants / bloquée : seul l'admin peut activer le retrait
  if (carnet.retraitActiveParAdmin) return { autorise: true }

  const datesMises = mises
    .filter((m) => m.carnetId === carnet.id && m.nombreMises > 0)
    .map((m) => m.date)
    .sort()
  const debut = datesMises[0] ?? carnet.dateOuverture
  const deblocage = new Date(debut)
  deblocage.setMonth(deblocage.getMonth() + MOIS_MIN_RETRAIT_CARTE)
  return { autorise: false, dateDeblocage: deblocage.toISOString() }
}

/** Carreaux nets du cycle (cotisations − retraits). */
export function carreauxNets(carnet: CarnetTontine, mises: MiseTontine[], cycle?: number): number {
  const c = cycle ?? carnet.cycleActuel
  return mises
    .filter((m) => m.carnetId === carnet.id && m.cycle === c)
    .reduce((s, m) => s + m.nombreMises, 0)
}

/** Carreaux déposés (cotisations uniquement). */
export function carreauxDeposes(carnet: CarnetTontine, mises: MiseTontine[], cycle: number): number {
  return mises
    .filter((m) => m.carnetId === carnet.id && m.cycle === cycle && m.nombreMises > 0)
    .reduce((s, m) => s + m.nombreMises, 0)
}

/** Carreaux déjà retirés sur un cycle. */
export function carreauxRetires(carnet: CarnetTontine, mises: MiseTontine[], cycle: number): number {
  return mises
    .filter((m) => m.carnetId === carnet.id && m.cycle === cycle && m.nombreMises < 0)
    .reduce((s, m) => s + Math.abs(m.nombreMises), 0)
}

/**
 * Carreaux encore retirables (hors P.C = 1re mise).
 * Un cycle complet à 31 laisse au plus 30 carreaux au client.
 */
export function carreauxRetirables(carnet: CarnetTontine, mises: MiseTontine[], cycle: number): number {
  const nets = carreauxNets(carnet, mises, cycle)
  if (nets <= 0) return 0
  return Math.max(0, nets - 1)
}

export type EtatCycle = {
  cycle: number
  /** Ex. « mars 2026 » — un cycle = un mois. */
  moisLabel: string
  moisNom: string
  annee: number
  deposes: number
  retires: number
  nets: number
  retirables: number
  complet: boolean
  /** Cycle passé entièrement retiré (grisé). */
  grise: boolean
  montantRetirable: number
  estActuel: boolean
}

const NOMS_MOIS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
]

/** Mois calendaire associé à un cycle (cycle 1 = mois d'ouverture du carnet). */
export function moisDuCycle(
  carnet: CarnetTontine,
  cycle: number,
): { nom: string; annee: number; label: string } {
  const d = new Date(carnet.dateOuverture)
  d.setMonth(d.getMonth() + Math.max(0, cycle - 1))
  const brut = NOMS_MOIS[d.getMonth()]
  const nom = brut.charAt(0).toUpperCase() + brut.slice(1)
  const annee = d.getFullYear()
  return { nom, annee, label: `${nom} ${annee}` }
}

/** Résumé de tous les cycles connus d'un carnet (1 → cycleActuel). */
export function situationsCycles(carnet: CarnetTontine, mises: MiseTontine[]): EtatCycle[] {
  const max = carnet.cycleActuel
  const cycles = new Set<number>()
  for (let i = 1; i <= max; i++) cycles.add(i)
  mises.filter((m) => m.carnetId === carnet.id).forEach((m) => cycles.add(m.cycle))

  return [...cycles]
    .sort((a, b) => a - b)
    .map((cycle) => {
      const deposes = carreauxDeposes(carnet, mises, cycle)
      const retires = carreauxRetires(carnet, mises, cycle)
      const nets = carreauxNets(carnet, mises, cycle)
      const retirables = carreauxRetirables(carnet, mises, cycle)
      const complet = deposes >= carnet.misesParCycle
      const estActuel = cycle === carnet.cycleActuel
      const grise = !estActuel && complet && retirables === 0
      const mois = moisDuCycle(carnet, cycle)
      return {
        cycle,
        moisLabel: mois.label,
        moisNom: mois.nom,
        annee: mois.annee,
        deposes,
        retires,
        nets,
        retirables,
        complet,
        grise,
        montantRetirable: retirables * carnet.mise,
        estActuel,
      }
    })
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
  /** Jour YYYY-MM-DD concerné */
  journee: string
  debutPeriode: string | null
  nombreOperations: number
  totalEntrees: number
  totalSorties: number
  soldeTheorique: number
  transactions: Transaction[]
  /** Arrêt déjà effectué pour ce jour (s'il existe). */
  arretDuJour: ArretCaisse | null
  /** Dernier arrêt (tous jours). */
  dernierArret: ArretCaisse | null
  /** Jours passés avec opérations mais sans arrêt (du plus ancien au plus récent). */
  journeesEnRetard: string[]
  cloturee: boolean
}

function jourIsoDepuisDate(iso: string): string {
  return iso.slice(0, 10)
}

export function aujourdHuiIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function arretCaisseDuJour(
  arretsCaisse: ArretCaisse[],
  employeId: string,
  journee: string,
): ArretCaisse | undefined {
  return arretsCaisse.find(
    (a) => a.employeId === employeId && (a.journee ?? jourIsoDepuisDate(dateClotureArret(a))) === journee,
  )
}

/** Horodatage de clôture d'un arrêt (compat anciennes données). */
export function dateClotureArret(a: ArretCaisse): string {
  return a.dateCloture ?? a.date ?? a.journee
}

/** True si la clôture a eu lieu un jour calendaire après la journée arrêtée. */
export function arretClotureEnRetard(a: ArretCaisse): boolean {
  const journee = a.journee ?? jourIsoDepuisDate(dateClotureArret(a))
  return jourIsoDepuisDate(dateClotureArret(a)) > journee
}

/** Jours (strictement avant `avantJour`) avec ops et sans arrêt, triés du plus ancien. */
export function journeesCaisseEnRetard(
  employeId: string,
  transactions: Transaction[],
  arretsCaisse: ArretCaisse[],
  avantJour: string = aujourdHuiIso(),
): string[] {
  const joursAvecOps = new Set(
    transactions
      .filter(
        (t) =>
          t.operateurId === employeId &&
          estOperationCaisse(t.type) &&
          jourIsoDepuisDate(t.date) < avantJour,
      )
      .map((t) => jourIsoDepuisDate(t.date)),
  )
  const joursArretes = new Set(
    arretsCaisse
      .filter((a) => a.employeId === employeId)
      .map((a) => a.journee ?? jourIsoDepuisDate(dateClotureArret(a))),
  )
  return [...joursAvecOps].filter((j) => !joursArretes.has(j)).sort()
}

/**
 * Bloque les nouvelles opérations si une journée passée n'a pas été arrêtée.
 * Retourne le message d'erreur, ou null si OK.
 */
export function messageBlocageCaisseJournaliere(
  employeId: string,
  transactions: Transaction[],
  arretsCaisse: ArretCaisse[],
): string | null {
  const retard = journeesCaisseEnRetard(employeId, transactions, arretsCaisse)
  if (retard.length === 0) return null
  const premier = retard[0]
  return `Arrêt de caisse obligatoire : demandez à l’admin ou au chef d’agence de clôturer la journée du ${premier} avant de continuer.`
}

/** Situation de caisse pour un jour donné (défaut : aujourd’hui). */
export function situationCaisse(
  employeId: string,
  transactions: Transaction[],
  arretsCaisse: ArretCaisse[],
  journee: string = aujourdHuiIso(),
): SituationCaisse {
  const dernierArret =
    arretsCaisse
      .filter((a) => a.employeId === employeId)
      .sort((a, b) => dateClotureArret(b).localeCompare(dateClotureArret(a)))[0] ?? null

  const arretDuJour = arretCaisseDuJour(arretsCaisse, employeId, journee) ?? null

  const periode = transactions
    .filter(
      (t) =>
        t.operateurId === employeId &&
        estOperationCaisse(t.type) &&
        jourIsoDepuisDate(t.date) === journee,
    )
    .sort((a, b) => b.date.localeCompare(a.date))

  let totalEntrees = 0
  let totalSorties = 0
  periode.forEach((t) => {
    if (TYPES_SORTIE.includes(t.type)) totalSorties += t.montant
    else totalEntrees += t.montant
  })

  const dates = periode.map((t) => t.date).sort()
  return {
    journee,
    debutPeriode: dates[0] ?? null,
    nombreOperations: periode.length,
    totalEntrees,
    totalSorties,
    soldeTheorique: totalEntrees - totalSorties,
    transactions: periode,
    arretDuJour,
    dernierArret,
    journeesEnRetard: journeesCaisseEnRetard(employeId, transactions, arretsCaisse),
    cloturee: !!arretDuJour,
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
    if (!estOperationCaisse(t.type)) return false
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

// ---------- Compte zone tontine ----------

/** Dépôts tontine (mises + P.C) d'une zone pour un jour YYYY-MM-DD. */
export function depotsTontineZoneJour(
  zoneId: string,
  dateIso: string,
  clients: Client[],
  transactions: Transaction[],
): number {
  const clientIds = new Set(clients.filter((c) => c.zoneId === zoneId).map((c) => c.id))
  return transactions
    .filter(
      (t) =>
        (t.type === 'mise_tontine' || t.type === 'commission_tontine') &&
        clientIds.has(t.clientId) &&
        t.date.slice(0, 10) === dateIso,
    )
    .reduce((s, t) => s + t.montant, 0)
}

export function statutDepuisEcart(ecart: number): StatutJourneeZone {
  if (ecart === 0) return 'ok'
  if (ecart < 0) return 'manquant'
  return 'surplus'
}

export function journeeZoneDuJour(
  journees: JourneeCompteZone[],
  zoneId: string,
  dateIso: string,
): JourneeCompteZone | undefined {
  return journees.find((j) => j.zoneId === zoneId && j.date === dateIso)
}

export function compteZoneDe(
  comptes: CompteZoneTontine[],
  zoneId: string,
): CompteZoneTontine | undefined {
  return comptes.find((c) => c.zoneId === zoneId)
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
