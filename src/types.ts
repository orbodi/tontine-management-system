export type Sexe = 'M' | 'F'

// ---------- Utilisateurs et rôles ----------

export type Role = 'admin' | 'chef_agence' | 'caissier'

export interface Utilisateur {
  id: string
  nomComplet: string
  identifiant: string
  motDePasse: string
  role: Role
  actif: boolean
}

// ---------- Clients ----------

export interface Client {
  id: string
  codeClient: string // ex. CL-0001
  nom: string
  prenom: string
  sexe: Sexe
  telephone: string
  email?: string
  profession?: string
  adresse?: string
  pieceIdentite?: string // ex. CNI n° ...
  dateInscription: string // ISO
  actif: boolean
}

// ---------- Tontine individuelle (carnet) ----------

export type FrequenceMise = 'journaliere' | 'hebdomadaire'

export interface CarnetTontine {
  id: string
  clientId: string
  mise: number // montant d'une mise
  frequence: FrequenceMise
  misesParCycle: number // ex. 31
  cycleActuel: number // commence à 1
  dateOuverture: string
  actif: boolean
}

export interface MiseTontine {
  id: string
  carnetId: string
  cycle: number
  nombreMises: number // permet d'encaisser plusieurs mises d'un coup
  montant: number
  date: string
}

// ---------- Épargne ----------

export interface CompteEpargne {
  id: string
  clientId: string
  numero: string // ex. EP-0001
  solde: number
  dateOuverture: string
}

export type TypeMouvement = 'depot' | 'retrait'

export interface MouvementEpargne {
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
  numero: string // ex. CR-0001
  clientId: string
  montant: number
  tauxInteret: number // % sur la durée totale
  dureeMois: number
  motif?: string
  dateDemande: string
  dateOctroi?: string // renseignée à l'approbation
  statut: StatutCredit
}

export interface Remboursement {
  id: string
  creditId: string
  montant: number
  date: string
}

// ---------- Journal ----------

export type TypeTransaction =
  | 'mise_tontine'
  | 'retrait_tontine'
  | 'commission_tontine'
  | 'depot_epargne'
  | 'retrait_epargne'
  | 'octroi_credit'
  | 'remboursement_credit'

export interface Transaction {
  id: string
  type: TypeTransaction
  clientId: string
  montant: number
  date: string
  description: string
  operateur: string // nom de l'utilisateur qui a saisi l'opération
}

// ---------- Racine ----------

export interface AppData {
  utilisateurs: Utilisateur[]
  clients: Client[]
  carnets: CarnetTontine[]
  mises: MiseTontine[]
  comptes: CompteEpargne[]
  mouvements: MouvementEpargne[]
  credits: Credit[]
  remboursements: Remboursement[]
  transactions: Transaction[]
  compteurs: { client: number; compte: number; credit: number }
}
