import {
  CYCLES_PAR_CARNET,
  MOIS_MIN_RETRAIT_CARTE,
  PRIX_CARNET,
  type ArretCaisse,
  type CarnetTontine,
  type Client,
  type CompteCaisse,
  type CompteZoneTontine,
  type Credit,
  type Employe,
  type JourneeCompteZone,
  type MiseTontine,
  type MouvementCompteCaisse,
  type OuvertureCaisse,
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
  complement_mise: 'Complément de mise',
  depot_compte: 'Dépôt',
  retrait_compte: 'Retrait',
  octroi_credit: 'Octroi de crédit',
  remboursement_credit: 'Remboursement crédit',
  part_sociale: 'Part sociale',
  droit_adhesion: "Droit d'adhésion",
}

export const TYPES_SORTIE: TypeTransaction[] = ['retrait_tontine', 'retrait_compte', 'octroi_credit']

/** Types d'opérations qui alimentent le compte de caisse d'un caissier. */
export const TYPES_OPERATION_CAISSE: TypeTransaction[] = [
  'vente_carnet',
  'mise_tontine',
  'retrait_tontine',
  'commission_tontine',
  'complement_mise',
  'depot_compte',
  'retrait_compte',
  'octroi_credit',
  'remboursement_credit',
  'part_sociale',
  'droit_adhesion',
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

export function compteCaisseAgence(
  comptes: CompteCaisse[],
  agenceId: string,
): CompteCaisse | undefined {
  return comptes.find((c) => c.agenceId === agenceId && c.actif)
}

export function compteCaissePourEmploye(
  comptes: CompteCaisse[],
  employeId: string,
  employes: { id: string; agenceId: string }[] = [],
): CompteCaisse | undefined {
  const direct = compteCaisseDe(comptes, employeId)
  if (direct) return direct
  const agenceId = employes.find((e) => e.id === employeId)?.agenceId
  return agenceId ? compteCaisseAgence(comptes, agenceId) : undefined
}

function operateursCaisseAgence(
  employes: { id: string; agenceId: string; role: string }[],
  agenceId: string,
): Set<string> {
  return new Set(
    employes
      .filter((e) => e.agenceId === agenceId && (e.role === 'caissier' || e.role === 'chef_agence'))
      .map((e) => e.id),
  )
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

/** Montant à encaisser pour passer d'une mise à une autre sur les carreaux déjà déposés du cycle. */
export function montantComplementMise(
  carnet: CarnetTontine,
  mises: MiseTontine[],
  nouvelleMise: number,
  cycle?: number,
): { carreaux: number; complement: number; ancienneMise: number } {
  const c = cycle ?? carnet.cycleActuel
  const carreaux = carreauxDeposes(carnet, mises, c)
  const ancienneMise = carnet.mise
  const complement = Math.max(0, carreaux * (nouvelleMise - ancienneMise))
  return { carreaux, complement, ancienneMise }
}

/** Carreaux déjà retirés sur un cycle. */
export function carreauxRetires(carnet: CarnetTontine, mises: MiseTontine[], cycle: number): number {
  return mises
    .filter((m) => m.carnetId === carnet.id && m.cycle === cycle && m.nombreMises < 0)
    .reduce((s, m) => s + Math.abs(m.nombreMises), 0)
}

/**
 * Carreaux encore retirables (hors P.C = 1re mise, sauf 1er cycle d’un carnet papier).
 * Un cycle complet à 31 laisse au plus 30 carreaux au client (31 si P.C. non due).
 */
export function pcDueSurCycle(_carnet: Pick<CarnetTontine, 'reprisePapier'>, cycle: number): boolean {
  return cycle >= 1
}

/** Rang 1..12 dans l’année de carnet en cours. */
export function cycleDansAnnee(cycle: number): number {
  return ((cycle - 1) % CYCLES_PAR_CARNET) + 1
}

/** 1 = premier carnet, 2 = premier renouvellement, etc. */
export function anneeCarnet(cycle: number): number {
  return Math.floor((cycle - 1) / CYCLES_PAR_CARNET) + 1
}

/** Premier mois d’un carnet renouvelé (13, 25, …). */
export function estPremierCycleRenouvellement(cycle: number): boolean {
  return cycle > 1 && cycleDansAnnee(cycle) === 1
}

const RE_ANNEE_RENOUVELLEMENT = /carnet\s+(\d+),\s*cycle\s+1\//i

export function cycleCourantEffectif(
  carnet: Pick<CarnetTontine, 'id' | 'cycleActuel' | 'misesParCycle'>,
  mises: MiseTontine[],
): number {
  const parCycle = carnet.misesParCycle
  let cycle = carnet.cycleActuel
  let garde = 0
  while (garde < 200 && carreauxNets(carnet as CarnetTontine, mises, cycle) >= parCycle) {
    cycle += 1
    garde += 1
  }
  return cycle
}

/** Années de 12 cycles déjà ouvertes (1 à l’ouverture, +1 par renouvellement payé). */
export function anneeCarnetOuverte(
  carnet: Pick<CarnetTontine, 'id' | 'clientId' | 'numero' | 'cycleActuel'>,
  mises: MiseTontine[],
  transactions: Transaction[] = [],
): number {
  let ouverte = 1
  for (const t of transactions) {
    if (t.type !== 'vente_carnet') continue
    if (t.clientId !== carnet.clientId) continue
    if (!t.description.includes('Renouvellement')) continue
    if (carnet.numero && !t.description.includes(carnet.numero)) continue
    const m = t.description.match(RE_ANNEE_RENOUVELLEMENT)
    if (m) ouverte = Math.max(ouverte, Number(m[1]))
  }
  for (const mi of mises) {
    if (mi.carnetId !== carnet.id || mi.nombreMises <= 0) continue
    ouverte = Math.max(ouverte, anneeCarnet(mi.cycle))
  }
  return ouverte
}

/** Année de 12 cycles terminée : le renouvellement (300 F) est dû avant tout dépôt. */
export function besoinRenouvellementCarnet(
  carnet: Pick<CarnetTontine, 'id' | 'clientId' | 'numero' | 'cycleActuel' | 'misesParCycle'>,
  mises: MiseTontine[],
  transactions: Transaction[] = [],
): boolean {
  return anneeCarnet(cycleCourantEffectif(carnet, mises)) > anneeCarnetOuverte(carnet, mises, transactions)
}

const RE_CYCLE_PC = /cycle\s+(\d+)/i

export function abonnementAnnee1Paye(
  carnet: Pick<CarnetTontine, 'clientId' | 'numero' | 'reprisePapier'>,
  transactions: Transaction[] = [],
): boolean {
  return transactions.some((t) => {
    if (t.type !== 'vente_carnet') return false
    if (t.clientId !== carnet.clientId) return false
    if (t.description.includes('Renouvellement')) return false
    if (carnet.numero && !t.description.includes(carnet.numero)) return false
    return true
  })
}

/** Case abonnement (300 F) : une fois sur les 12 premiers cycles. */
export function abonnementASaisir(
  carnet: Pick<CarnetTontine, 'id' | 'clientId' | 'numero' | 'cycleActuel' | 'misesParCycle' | 'reprisePapier'>,
  mises: MiseTontine[],
  transactions: Transaction[] = [],
): boolean {
  if (besoinRenouvellementCarnet(carnet, mises, transactions)) return false
  if (anneeCarnet(cycleCourantEffectif(carnet, mises)) > 1) return false
  return !abonnementAnnee1Paye(carnet, transactions)
}

export function pcPayeeSurCycle(
  carnet: Pick<CarnetTontine, 'clientId' | 'numero'>,
  transactions: Transaction[] = [],
  cycle: number,
): boolean {
  return transactions.some((t) => {
    if (t.type !== 'commission_tontine') return false
    if (t.clientId !== carnet.clientId) return false
    if (carnet.numero && !t.description.includes(carnet.numero) && /carnet/i.test(t.description)) {
      return false
    }
    const m = t.description.match(RE_CYCLE_PC)
    return !!m && Number(m[1]) === cycle
  })
}

/** Case P.C. du cycle en cours, tant que non payée. */
export function pcASaisir(
  carnet: Pick<CarnetTontine, 'id' | 'clientId' | 'numero' | 'cycleActuel' | 'misesParCycle' | 'reprisePapier'>,
  mises: MiseTontine[],
  transactions: Transaction[] = [],
): boolean {
  const cycle = cycleCourantEffectif(carnet, mises)
  if (!pcDueSurCycle(carnet, cycle)) return false
  return !pcPayeeSurCycle(carnet, transactions, cycle)
}

export function preparerDepotTontine(
  montant: number,
  mise: number,
  payerAbonnement: boolean,
  payerPc: boolean,
):
  | { ok: true; nombreMises: number; reste: number; fraisAbonnement: number; fraisPc: number }
  | { ok: false; erreur: string } {
  if (montant <= 0) return { ok: false, erreur: 'Montant invalide.' }
  if (mise <= 0) return { ok: false, erreur: 'Mise invalide.' }
  const fraisAbonnement = payerAbonnement ? PRIX_CARNET : 0
  if (montant < fraisAbonnement) return { ok: false, erreur: 'Montant insuffisant pour l’abonnement.' }
  const alloueCarreaux = montant - fraisAbonnement
  if (alloueCarreaux === 0) {
    if (!payerAbonnement) return { ok: false, erreur: 'Indiquez un dépôt ou cochez un frais.' }
    if (payerPc) return { ok: false, erreur: 'La P.C. requiert au moins une mise sur le carnet.' }
    return { ok: true, nombreMises: 0, reste: 0, fraisAbonnement, fraisPc: 0 }
  }
  const calc = calculerMisesDepuisMontant(alloueCarreaux, mise)
  if (!calc.ok) return calc
  if (payerPc && calc.nombreMises < 1) {
    return { ok: false, erreur: 'La P.C. requiert au moins une mise sur le carnet.' }
  }
  const fraisPc = payerPc ? mise : 0
  return { ok: true, nombreMises: calc.nombreMises, reste: alloueCarreaux - fraisPc, fraisAbonnement, fraisPc }
}

export function libelleCycleCarnet(cycle: number): string {
  const annee = anneeCarnet(cycle)
  const rang = cycleDansAnnee(cycle)
  if (annee <= 1) return `cycle ${rang}/${CYCLES_PAR_CARNET}`
  return `carnet ${annee}, cycle ${rang}/${CYCLES_PAR_CARNET}`
}

export function estAncienClient(client: Pick<Client, 'origineTontine'> | undefined): boolean {
  return client?.origineTontine === 'ancien'
}

/** @deprecated préférer estAncienClient — le flag s’applique aussi aux comptes. */
export const estAncienClientTontine = estAncienClient

export function fraisOuvertureComptePour(
  client: Pick<Client, 'origineTontine'> | undefined,
  tarifs: { partSociale: number; droitAdhesion: number; droitAdhesionPromo: number },
  promo: boolean,
): { partSociale: number; droitAdhesion: number; total: number; offerts: boolean } {
  if (estAncienClient(client)) {
    return { partSociale: 0, droitAdhesion: 0, total: 0, offerts: true }
  }
  const droit = promo ? tarifs.droitAdhesionPromo : tarifs.droitAdhesion
  return {
    partSociale: tarifs.partSociale,
    droitAdhesion: droit,
    total: tarifs.partSociale + droit,
    offerts: false,
  }
}

export function carreauxRetirables(carnet: CarnetTontine, mises: MiseTontine[], cycle: number): number {
  const nets = carreauxNets(carnet, mises, cycle)
  if (nets <= 0) return 0
  const reservePc = pcDueSurCycle(carnet, cycle) ? 1 : 0
  return Math.max(0, nets - reservePc)
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

/** Nombre max de cycles qu’un seul dépôt peut alimenter. */
export const MAX_CYCLES_DEPOT = 24

export type TrancheDepotCycle = {
  cycle: number
  nombre: number
  payeesAvant: number
  preleverPc: boolean
  renouvellement: boolean
}

/**
 * Répartit un dépôt (en carreaux) sur le cycle courant puis les suivants.
 * Ex. mise 300, cycle vide : 18 600 F → 31 + 31 carreaux sur 2 cycles.
 */
export function repartirDepotSurCycles(
  carnet: Pick<CarnetTontine, 'id' | 'clientId' | 'numero' | 'cycleActuel' | 'misesParCycle' | 'reprisePapier'>,
  mises: MiseTontine[],
  nombreMises: number,
  transactions: Transaction[] = [],
):
  | { ok: true; tranches: TrancheDepotCycle[]; cycleFinal: number }
  | { ok: false; erreur: string } {
  if (nombreMises <= 0) return { ok: false, erreur: 'Nombre de carreaux invalide.' }
  const parCycle = carnet.misesParCycle
  const anneeOuverte = anneeCarnetOuverte(carnet, mises, transactions)
  const cycleMax = anneeOuverte * CYCLES_PAR_CARNET
  let cycle = cycleCourantEffectif(carnet, mises)
  if (cycle > cycleMax) {
    return { ok: false, erreur: 'Renouvelez d’abord le carnet (300 F) pour ouvrir 12 nouveaux cycles.' }
  }
  let reste = nombreMises
  const tranches: TrancheDepotCycle[] = []
  while (reste > 0) {
    if (cycle > cycleMax) {
      const restantsAnnee = tranches.reduce((s, t) => s + t.nombre, 0)
      return {
        ok: false,
        erreur: restantsAnnee
          ? `Il reste ${restantsAnnee} carreau(x) sur cette année de carnet. Renouvelez le carnet (300 F) pour déposer davantage.`
          : 'Renouvelez d’abord le carnet (300 F) pour ouvrir 12 nouveaux cycles.',
      }
    }
    if (tranches.length >= MAX_CYCLES_DEPOT) {
      return { ok: false, erreur: `Dépôt trop important : au plus ${MAX_CYCLES_DEPOT} cycles d’un coup.` }
    }
    const payeesAvant = carreauxNets(carnet as CarnetTontine, mises, cycle)
    const restants = parCycle - payeesAvant
    if (restants <= 0) {
      cycle += 1
      continue
    }
    const nombre = Math.min(reste, restants)
    tranches.push({
      cycle,
      nombre,
      payeesAvant,
      preleverPc: payeesAvant === 0 && pcDueSurCycle(carnet, cycle),
      renouvellement: false,
    })
    reste -= nombre
    if (payeesAvant + nombre >= parCycle) cycle += 1
  }
  const dernier = tranches[tranches.length - 1]
  const cycleFinal =
    dernier.payeesAvant + dernier.nombre >= parCycle ? dernier.cycle + 1 : dernier.cycle
  return { ok: true, tranches, cycleFinal }
}

// ---------- Caisse ----------

export interface SituationCaisse {
  /** Jour YYYY-MM-DD concerné */
  journee: string
  debutPeriode: string | null
  nombreOperations: number
  totalEntrees: number
  totalSorties: number
  /** Solde d’ouverture saisi (0 si journée non ouverte). */
  soldeOuverture: number
  /**
   * Solde attendu à la fermeture (solde compte en fin de journée / actuel).
   * = ouverture + flux du jour (ops + alimentations).
   */
  soldeFermetureTheorique: number
  /** @deprecated Alias de soldeFermetureTheorique (compat affichages). */
  soldeTheorique: number
  transactions: Transaction[]
  /** Ouverture déjà effectuée pour ce jour. */
  ouvertureDuJour: OuvertureCaisse | null
  /** Arrêt déjà effectué pour ce jour (s'il existe). */
  arretDuJour: ArretCaisse | null
  /** Dernier arrêt (tous jours). */
  dernierArret: ArretCaisse | null
  /** Jours passés ouverts ou avec ops, sans arrêt (du plus ancien au plus récent). */
  journeesEnRetard: string[]
  /** Journée ouverte (montant d’ouverture saisi). */
  ouverte: boolean
  cloturee: boolean
}

function jourIsoDepuisDate(iso: string): string {
  return iso.slice(0, 10)
}

function deltaMouvementCaisse(m: MouvementCompteCaisse): number {
  return m.sens === 'credit' ? m.montant : -m.montant
}

/** Solde du compte juste avant le début du jour (YYYY-MM-DD). */
export function soldeCompteCaisseAvantJour(
  compte: CompteCaisse | undefined,
  mouvements: MouvementCompteCaisse[],
  journee: string,
): number {
  if (!compte) return 0
  let s = compte.solde
  for (const m of mouvements) {
    if (m.compteCaisseId !== compte.id) continue
    if (jourIsoDepuisDate(m.date) >= journee) s -= deltaMouvementCaisse(m)
  }
  return s
}

/** Solde du compte en fin de journée (pour aujourd’hui = solde courant). */
export function soldeCompteCaisseFinJour(
  compte: CompteCaisse | undefined,
  mouvements: MouvementCompteCaisse[],
  journee: string,
  aujourdhui: string = aujourdHuiIso(),
): number {
  if (!compte) return 0
  if (journee >= aujourdhui) return compte.solde
  let s = compte.solde
  for (const m of mouvements) {
    if (m.compteCaisseId !== compte.id) continue
    if (jourIsoDepuisDate(m.date) > journee) s -= deltaMouvementCaisse(m)
  }
  return s
}

export function aujourdHuiIso(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function ouvertureCaisseDuJour(
  ouverturesCaisse: OuvertureCaisse[],
  employeId: string,
  journee: string,
): OuvertureCaisse | undefined {
  return ouverturesCaisse.find((o) => o.employeId === employeId && o.journee === journee)
}

export function ouvertureCaisseAgence(
  ouverturesCaisse: OuvertureCaisse[],
  agenceId: string,
  journee: string,
  titulaireId?: string,
): OuvertureCaisse | undefined {
  const cands = ouverturesCaisse.filter((o) => o.agenceId === agenceId && o.journee === journee)
  if (titulaireId) {
    const hit = cands.find((o) => o.employeId === titulaireId)
    if (hit) return hit
  }
  return cands[0]
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

export function arretCaisseAgence(
  arretsCaisse: ArretCaisse[],
  agenceId: string,
  journee: string,
  titulaireId?: string,
): ArretCaisse | undefined {
  const cands = arretsCaisse.filter(
    (a) => a.agenceId === agenceId && (a.journee ?? jourIsoDepuisDate(dateClotureArret(a))) === journee,
  )
  if (titulaireId) {
    const hit = cands.find((a) => a.employeId === titulaireId)
    if (hit) return hit
  }
  return cands[0]
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

/** Jours ouverts et non encore clôturés (strictement avant `avantJour`). */
export function journeesOuvertesEnAttenteCloture(
  employeId: string,
  ouverturesCaisse: OuvertureCaisse[],
  arretsCaisse: ArretCaisse[],
  avantJour: string = aujourdHuiIso(),
): string[] {
  const joursArretes = new Set(
    arretsCaisse
      .filter((a) => a.employeId === employeId)
      .map((a) => a.journee ?? jourIsoDepuisDate(dateClotureArret(a))),
  )
  return ouverturesCaisse
    .filter(
      (o) =>
        o.employeId === employeId && o.journee < avantJour && !joursArretes.has(o.journee),
    )
    .map((o) => o.journee)
    .sort()
}

/** Jours (strictement avant `avantJour`) ouverts ou avec ops, sans arrêt. */
export function journeesCaisseEnRetard(
  employeId: string,
  transactions: Transaction[],
  arretsCaisse: ArretCaisse[],
  ouverturesCaisse: OuvertureCaisse[] = [],
  avantJour: string = aujourdHuiIso(),
  employes: Employe[] = [],
): string[] {
  const agenceId = employes.find((e) => e.id === employeId)?.agenceId
  const opIds = agenceId ? operateursCaisseAgence(employes, agenceId) : new Set([employeId])
  const joursAvecOps = new Set(
    transactions
      .filter(
        (t) =>
          opIds.has(t.operateurId) &&
          estOperationCaisse(t.type) &&
          jourIsoDepuisDate(t.date) < avantJour,
      )
      .map((t) => jourIsoDepuisDate(t.date)),
  )
  const joursOuverts = new Set(
    ouverturesCaisse
      .filter((o) => (agenceId ? o.agenceId === agenceId : o.employeId === employeId) && o.journee < avantJour)
      .map((o) => o.journee),
  )
  const jours = new Set([...joursAvecOps, ...joursOuverts])
  const joursArretes = new Set(
    arretsCaisse
      .filter((a) => (agenceId ? a.agenceId === agenceId : a.employeId === employeId))
      .map((a) => a.journee ?? jourIsoDepuisDate(dateClotureArret(a))),
  )
  return [...jours].filter((j) => !joursArretes.has(j)).sort()
}

/**
 * Bloque les nouvelles opérations si la journée en cours n'est pas ouverte (ou déjà clôturée).
 * Une journée passée non clôturée n'empêche plus d'ouvrir ni de travailler sur aujourd'hui.
 */
export function messageBlocageCaisseJournaliere(
  employeId: string,
  transactions: Transaction[],
  arretsCaisse: ArretCaisse[],
  ouverturesCaisse: OuvertureCaisse[] = [],
  employes: Employe[] = [],
): string | null {
  const aujourdhui = aujourdHuiIso()
  const agenceId = employes.find((e) => e.id === employeId)?.agenceId
  const ouverte = agenceId
    ? !!ouvertureCaisseAgence(ouverturesCaisse, agenceId, aujourdhui)
    : !!ouvertureCaisseDuJour(ouverturesCaisse, employeId, aujourdhui)
  const cloturee = agenceId
    ? !!arretCaisseAgence(arretsCaisse, agenceId, aujourdhui)
    : !!arretCaisseDuJour(arretsCaisse, employeId, aujourdhui)
  if (!ouverte) {
    return `Ouverture de caisse obligatoire : l’admin ou le chef d’agence doit ouvrir la journée (${aujourdhui}) dans Suivi des caisses avant toute opération.`
  }
  if (cloturee) {
    return 'La caisse du jour est déjà clôturée.'
  }
  return null
}

/** Situation de caisse pour un jour donné (défaut : aujourd’hui). */
export function situationCaisse(
  employeId: string,
  transactions: Transaction[],
  arretsCaisse: ArretCaisse[],
  journee: string = aujourdHuiIso(),
  comptesCaisse: CompteCaisse[] = [],
  mouvementsCompteCaisse: MouvementCompteCaisse[] = [],
  ouverturesCaisse: OuvertureCaisse[] = [],
  employes: Employe[] = [],
): SituationCaisse {
  const agenceId = employes.find((e) => e.id === employeId)?.agenceId
  const compte = agenceId
    ? (compteCaisseAgence(comptesCaisse, agenceId) ?? compteCaisseDe(comptesCaisse, employeId))
    : compteCaisseDe(comptesCaisse, employeId)
  const titulaireId = compte?.employeId
  const opIds = agenceId ? operateursCaisseAgence(employes, agenceId) : new Set([employeId])

  const dernierArret =
    arretsCaisse
      .filter((a) => (agenceId ? a.agenceId === agenceId : a.employeId === employeId))
      .sort((a, b) => dateClotureArret(b).localeCompare(dateClotureArret(a)))[0] ?? null

  const arretDuJour = agenceId
    ? (arretCaisseAgence(arretsCaisse, agenceId, journee, titulaireId) ?? null)
    : (arretCaisseDuJour(arretsCaisse, employeId, journee) ?? null)
  const ouvertureDuJour = agenceId
    ? (ouvertureCaisseAgence(ouverturesCaisse, agenceId, journee, titulaireId) ?? null)
    : (ouvertureCaisseDuJour(ouverturesCaisse, employeId, journee) ?? null)

  const periode = transactions
    .filter(
      (t) =>
        opIds.has(t.operateurId) &&
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

  let soldeOuverture: number
  let soldeFermetureTheorique: number
  if (arretDuJour && typeof arretDuJour.soldeOuverture === 'number') {
    soldeOuverture = arretDuJour.soldeOuverture
    soldeFermetureTheorique = arretDuJour.soldeTheorique
  } else if (ouvertureDuJour) {
    soldeOuverture = ouvertureDuJour.soldeOuverture
    soldeFermetureTheorique = soldeCompteCaisseFinJour(compte, mouvementsCompteCaisse, journee)
  } else {
    soldeOuverture = 0
    soldeFermetureTheorique = soldeCompteCaisseFinJour(compte, mouvementsCompteCaisse, journee)
  }

  const dates = periode.map((t) => t.date).sort()
  return {
    journee,
    debutPeriode: dates[0] ?? null,
    nombreOperations: periode.length,
    totalEntrees,
    totalSorties,
    soldeOuverture,
    soldeFermetureTheorique,
    soldeTheorique: soldeFermetureTheorique,
    transactions: periode,
    ouvertureDuJour,
    arretDuJour,
    dernierArret,
    journeesEnRetard: journeesCaisseEnRetard(
      employeId,
      transactions,
      arretsCaisse,
      ouverturesCaisse,
      aujourdHuiIso(),
      employes,
    ),
    ouverte: !!ouvertureDuJour,
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

/** Types d'opérations qui alimentent le théorique d'une journée zone tontine. */
export const TYPES_DEPOT_TONTINE_ZONE: TypeTransaction[] = [
  'mise_tontine',
  'commission_tontine',
  'complement_mise',
  'vente_carnet',
]

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
        TYPES_DEPOT_TONTINE_ZONE.includes(t.type) &&
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

/** Journées de zone encore ouvertes, jusqu'à aujourd'hui (pas de date future). */
export function joursCollecteSaisissables(
  journees: JourneeCompteZone[],
  zoneId: string,
  avantJour: string = aujourdHuiIso(),
): string[] {
  return [
    ...new Set(
      journees
        .filter((j) => j.zoneId === zoneId && !j.cloturee && j.date <= avantJour)
        .map((j) => j.date),
    ),
  ].sort((a, b) => b.localeCompare(a))
}

export function dateCollecteParDefaut(
  jours: string[],
  aujourdhui: string = aujourdHuiIso(),
): string {
  if (jours.includes(aujourdhui)) return aujourdhui
  return jours[0] ?? aujourdhui
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
