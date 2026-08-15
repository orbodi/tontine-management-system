export type Sexe = 'M' | 'F'

// ---------- Agences ----------

export interface Agence {
  id: string
  code: string // ex. "01", "02"
  nom: string
  adresse?: string
  chefEmployeId?: string
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
  codeClient: string // ex. CL-0001
  agenceId: string // agence de création
  /** Ordre du client dans son agence d'origine (pour n° carnet xxxx). */
  ordreAgence: number
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
  /** Format 010001 : code agence + ordre client. */
  numero: string
  /** Agence où le carnet a été payé / renouvelé. */
  agenceId: string
  typeCarnet: TypeCarnet
  mise: number
  frequence: FrequenceMise
  misesParCycle: number
  cycleActuel: number // 1..12
  dateOuverture: string
  verrouille: boolean
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

export const DELAI_RETRAIT_EPARGNE_H = 48

export type StatutDemandeRetrait = 'en_attente' | 'executee' | 'annulee'

export interface DemandeRetrait {
  id: string
  compteId: string
  montant: number
  dateDemande: string
  dateExecutable: string
  statut: StatutDemandeRetrait
  dateExecution?: string
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
  employes: Employe[]
  clients: Client[]
  carnets: CarnetTontine[]
  mises: MiseTontine[]
  comptes: Compte[]
  mouvements: MouvementCompte[]
  demandesRetrait: DemandeRetrait[]
  credits: Credit[]
  remboursements: Remboursement[]
  transactions: Transaction[]
  arretsCaisse: ArretCaisse[]
  journalConnexions: JournalConnexion[]
  /** Ordre client par agence (clé = agenceId). */
  compteursOrdreAgence: Record<string, number>
  compteurs: { client: number; compte: number; credit: number }
}
