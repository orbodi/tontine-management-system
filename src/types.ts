export type Sexe = 'M' | 'F'

// ---------- Agences ----------

export interface Agence {
  id: string
  /** Code interne (ex. "A1") — distinct des numéros de zone. */
  code: string
  nom: string
  adresse?: string
  telephone?: string
  chefEmployeId?: string
  actif: boolean
}

// ---------- Zones (appartenant à une agence) ----------

export interface Zone {
  id: string
  agenceId: string
  /** Numéro de zone : "01", "02"… — préfixe du n° de carnet. */
  code: string
  nom?: string
  actif: boolean
}

// ---------- Employés, rôles et droits ----------

export type Role = 'admin' | 'chef_agence' | 'caissier'

/** Droits accordables individuellement par l'administrateur. */
export type Droit =
  | 'gerer_clients'
  | 'operer_comptes'
  | 'approuver_credits'
  | 'verrouiller_comptes'
  | 'gerer_employes'
  | 'voir_rapports'
  | 'gerer_agences'
  | 'gerer_zones'

export interface Employe {
  id: string
  nomComplet: string
  identifiant: string
  motDePasse: string
  role: Role
  agenceId: string
  /** Droits accordés par l'admin. L'admin possède implicitement tous les droits. */
  droits: Droit[]
  telephone?: string
  email?: string
  adresse?: string
  pieceIdentite?: string
  dateEmbauche: string // ISO
  actif: boolean
}

// ---------- Clients ----------

export interface Client {
  id: string
  codeClient: string // ex. 0001
  agenceId: string // dérivé de la zone
  zoneId: string
  /** Ordre du client dans sa zone (pour n° carnet xxxx). */
  ordreZone: number
  nom: string
  prenom: string
  sexe: Sexe
  telephone: string
  email?: string
  profession?: string
  adresse?: string
  pieceIdentite?: string
  dateInscription: string
  actif: boolean
}

// ---------- Comptes à carnet (tontine et cartes, 31 carreaux, 12 cycles) ----------

export type TypeCarnet = 'tontine' | 'carte_tous' | 'carte_enfants' | 'carte_bloquee'

export type FrequenceMise = 'journaliere' | 'hebdomadaire'

export const PRIX_CARNET = 300
export const MOIS_MIN_RETRAIT_CARTE = 6
export const CYCLES_PAR_CARNET = 12
export const CARREAUX_PAR_CYCLE = 31

export interface CarnetTontine {
  id: string
  clientId: string
  /** Format 010001 : n° zone + ordre client dans la zone. */
  numero: string
  /** Zone du carnet (préfixe du numéro). */
  zoneId: string
  /** Agence (pour filtres / opérations). */
  agenceId: string
  typeCarnet: TypeCarnet
  mise: number
  frequence: FrequenceMise
  misesParCycle: number
  cycleActuel: number // 1..12
  dateOuverture: string
  verrouille: boolean
  /**
   * Cartes enfants / bloquée : retraits grisés tant que l'admin n'a pas activé.
   * Pour tontine et carte pour tous : toujours true.
   */
  retraitActiveParAdmin: boolean
  actif: boolean
}

export interface MiseTontine {
  id: string
  carnetId: string
  cycle: number
  /** Positif = cotisation ; négatif = retrait partiel (carreaux). */
  nombreMises: number
  montant: number
  date: string
}

// ---------- Comptes à solde (courant et épargne) — n° B0001 ----------

export type TypeCompte = 'courant' | 'epargne'

export interface Compte {
  id: string
  clientId: string
  type: TypeCompte
  /** Format B0001 */
  numero: string
  solde: number
  dateOuverture: string
  verrouille: boolean
}

export type TypeMouvement = 'depot' | 'retrait'

export interface MouvementCompte {
  id: string
  compteId: string
  type: TypeMouvement
  montant: number
  date: string
  note?: string
}

// ---------- Crédits ----------

export type StatutCredit = 'en_attente' | 'en_cours' | 'rembourse' | 'en_retard' | 'rejete'

export interface Credit {
  id: string
  numero: string
  clientId: string
  montant: number
  tauxInteret: number
  dureeMois: number
  motif?: string
  dateDemande: string
  dateOctroi?: string
  statut: StatutCredit
}

export interface Remboursement {
  id: string
  creditId: string
  montant: number
  date: string
}

// ---------- Caisse ----------

export interface ArretCaisse {
  id: string
  employeId: string
  employeNom: string
  agenceId: string
  date: string
  debutPeriode: string
  nombreOperations: number
  totalEntrees: number
  totalSorties: number
  soldeTheorique: number
  montantCompte: number
  ecart: number
  note?: string
}

// ---------- Audit ----------

export interface JournalConnexion {
  id: string
  employeId: string
  employeNom: string
  agenceId: string
  date: string
  type: 'connexion' | 'deconnexion'
}

// ---------- Journal ----------

export type TypeTransaction =
  | 'vente_carnet'
  | 'mise_tontine'
  | 'retrait_tontine'
  | 'commission_tontine'
  | 'depot_compte'
  | 'retrait_compte'
  | 'octroi_credit'
  | 'remboursement_credit'

export interface Transaction {
  id: string
  type: TypeTransaction
  clientId: string
  montant: number
  date: string
  description: string
  operateur: string
  operateurId: string
  /** Agence de l'opérateur au moment de l'opération. */
  agenceId: string
}

// ---------- Racine ----------

export interface AppData {
  agences: Agence[]
  zones: Zone[]
  employes: Employe[]
  clients: Client[]
  carnets: CarnetTontine[]
  mises: MiseTontine[]
  comptes: Compte[]
  mouvements: MouvementCompte[]
  credits: Credit[]
  remboursements: Remboursement[]
  transactions: Transaction[]
  arretsCaisse: ArretCaisse[]
  journalConnexions: JournalConnexion[]
  /** Ordre client par zone (clé = zoneId). */
  compteursOrdreZone: Record<string, number>
  compteurs: { client: number; compte: number; credit: number }
}
