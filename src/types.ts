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

/**
 * Compte zone lié uniquement aux dépôts tontine de la zone.
 * Les cumuls manquant / surplus sont uniques (toutes dates confondues).
 */
export interface CompteZoneTontine {
  id: string
  zoneId: string
  /** Cumul unique toutes dates — alimenté à chaque clôture journalière. */
  cumulManquant: number
  /** Cumul unique toutes dates — alimenté à chaque clôture journalière. */
  cumulSurplus: number
  actif: boolean
}

export type StatutJourneeZone = 'en_cours' | 'ok' | 'manquant' | 'surplus'

/**
 * État journalier du compte zone.
 * Flux : 1) saisie montant réel 2) dépôts tontine clients 3) clôture / calcul écart.
 */
export interface JourneeCompteZone {
  id: string
  compteZoneId: string
  zoneId: string
  /** Jour calendaire YYYY-MM-DD */
  date: string
  /** Montant réel collecté (saisi en premier par le caissier). */
  montantReel: number
  /** Σ dépôts tontine saisis ce jour (calculé à la clôture). */
  montantTheorique: number
  /** réel − théorique */
  ecart: number
  statut: StatutJourneeZone
  cloturee: boolean
  dateSaisieReel: string
  dateCloture?: string
  operateurId: string
  operateurNom: string
  note?: string
}

/** Correction admin des cumuls (manquant ou surplus). */
export interface AjustementCompteZone {
  id: string
  compteZoneId: string
  zoneId: string
  date: string
  type: 'manquant' | 'surplus'
  /** Montant retiré du cumul (positif). */
  montant: number
  motif: string
  adminId: string
  adminNom: string
  cumulAvant: number
  cumulApres: number
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
  | 'gerer_comptabilite'

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

export type OrigineTontine = 'nouveau' | 'ancien'

export interface Client {
  id: string
  /** N° client tontine stocké 010001 (zone + ordre) ; affiché 0001. Absent si client banque seul. */
  codeClient?: string | null
  agenceId: string
  /** Zone tontine — absente pour un client banque rattaché seulement à l’agence. */
  zoneId?: string | null
  /** Ordre local dans la zone : suffixe du N° Client / n° carnet (xxxx). */
  ordreZone?: number | null
  /** N° client banque 0001, 0002… — attribué au premier compte, indépendant de la zone. */
  codeClientBanque?: string | null
  ordreBanque?: number | null
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
  /**
   * Nouveau : vente de carnet (300 F), P.C. chaque cycle, part sociale et adhésion.
   * Ancien (papier) : pas de 300 F, pas de P.C. au 1er cycle, pas de part sociale ni d’adhésion.
   */
  origineTontine?: OrigineTontine
}

// ---------- Comptes à carnet (tontine et cartes, 31 carreaux, 12 cycles) ----------

export type TypeCarnet = 'tontine' | 'carte_tous' | 'carte_enfants' | 'carte_bloquee'

export const TYPES_CARNET: TypeCarnet[] = ['tontine', 'carte_tous', 'carte_enfants', 'carte_bloquee']

export type FrequenceMise = 'journaliere' | 'hebdomadaire'

export const PRIX_CARNET = 300
export const MOIS_MIN_RETRAIT_CARTE = 6
export const CYCLES_PAR_CARNET = 12
export const CARREAUX_PAR_CYCLE = 31

export interface CarnetTontine {
  id: string
  clientId: string
  /** Format 010001 : n° zone + ordre client. Identique au N° Client stocké ; plusieurs types partagent ce numéro. */
  numero: string
  /** Zone du carnet (préfixe du numéro). */
  zoneId: string
  /** Agence (pour filtres / opérations). */
  agenceId: string
  typeCarnet: TypeCarnet
  mise: number
  frequence: FrequenceMise
  misesParCycle: number
  cycleActuel: number // 1, 2, … (12 mois par carnet ; 13 = 1er mois du renouvellement)
  dateOuverture: string
  verrouille: boolean
  /**
   * Cartes enfants / bloquée : retraits grisés tant que l'admin n'a pas activé.
   * Pour tontine et carte pour tous : toujours true.
   */
  retraitActiveParAdmin: boolean
  actif: boolean
  /** Ouvert pour un client ancien : pas de P.C. sur le cycle 1 dans l’app. */
  reprisePapier?: boolean
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
  /** Part sociale versée à la microfinance à l'ouverture. */
  partSociale?: number
  /** Droit d'adhésion crédité sur le compte. */
  droitAdhesion?: number
  promotion?: boolean
}

export type StatutDemandeOuvertureCompte = 'en_attente' | 'validee' | 'refusee'

/** Demande d'ouverture créée par admin/chef ; validée par le caissier désigné. */
export interface DemandeOuvertureCompte {
  id: string
  clientId: string
  type: TypeCompte
  promotion: boolean
  partSociale: number
  droitAdhesion: number
  caissierId: string
  demandeurId: string
  demandeurNom: string
  dateDemande: string
  statut: StatutDemandeOuvertureCompte
  dateTraitement?: string | null
  compteId?: string | null
  motifRefus?: string | null
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

/** Compte de caisse physique unique de l'agence (titulaire : un caissier). Le chef d'agence n'a pas de caisse. */
export interface CompteCaisse {
  id: string
  employeId: string
  agenceId: string
  numero: string
  /** Solde courant (mis à jour automatiquement). */
  solde: number
  /** Cumul unique toutes dates — alimenté à chaque clôture avec écart négatif. */
  cumulManquant: number
  /** Cumul unique toutes dates — alimenté à chaque clôture avec écart positif. */
  cumulSurplus: number
  dateOuverture: string
  actif: boolean
}

/** Correction admin des cumuls manquant / surplus d'un compte caisse. */
export interface AjustementCompteCaisse {
  id: string
  compteCaisseId: string
  employeId: string
  date: string
  type: 'manquant' | 'surplus'
  /** Montant retiré du cumul (positif). */
  montant: number
  motif: string
  adminId: string
  adminNom: string
  cumulAvant: number
  cumulApres: number
}

export type TypeMouvementCaisse =
  | 'alimentation'
  | 'entree_operation'
  | 'sortie_operation'
  | 'ajustement_arret'
  | 'ouverture_journee'

export interface MouvementCompteCaisse {
  id: string
  compteCaisseId: string
  employeId: string
  type: TypeMouvementCaisse
  /** Montant toujours positif. */
  montant: number
  /** credit = augmente le solde, debit = diminue. */
  sens: 'credit' | 'debit'
  soldeApres: number
  date: string
  description: string
  transactionId?: string
  operateurId: string
  operateurNom: string
}

/** Ouverture de journée saisie par admin / chef d'agence. */
export interface OuvertureCaisse {
  id: string
  employeId: string
  employeNom: string
  agenceId: string
  /** Jour calendaire ouvert (YYYY-MM-DD). */
  journee: string
  /** Montant d’ouverture saisi. */
  soldeOuverture: number
  dateOuverture: string
  ouvertParId: string
  ouvertParNom: string
  note?: string
}

export interface ArretCaisse {
  id: string
  /** Caissier dont la caisse est arrêtée. */
  employeId: string
  employeNom: string
  agenceId: string
  /** Jour calendaire des opérations clôturées (YYYY-MM-DD). */
  journee: string
  /**
   * Date/heure réelle de la clôture.
   * Peut être postérieure à `journee` en cas d’arrêt en retard.
   */
  dateCloture: string
  /** @deprecated Utiliser dateCloture — conservé pour compatibilité des anciennes données. */
  date?: string
  debutPeriode: string
  nombreOperations: number
  totalEntrees: number
  totalSorties: number
  /** Solde du compte caisse à l’ouverture de la journée. */
  soldeOuverture: number
  /**
   * Solde attendu à la fermeture (= ouverture + entrées − sorties + alimentations du jour).
   * Correspond au solde du compte caisse avant éventuel ajustement d’écart.
   */
  soldeTheorique: number
  /** Espèces comptées à la fermeture. */
  montantCompte: number
  /** Écart = compté − solde théorique de fermeture. */
  ecart: number
  note?: string
  /** Admin ou chef d'agence ayant validé l'arrêt. */
  valideParId?: string
  valideParNom?: string
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
  | 'complement_mise'
  | 'depot_compte'
  | 'retrait_compte'
  | 'octroi_credit'
  | 'remboursement_credit'
  | 'part_sociale'
  | 'droit_adhesion'

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

// ---------- Comptabilité générale ----------

export type StatutExercice = 'ouvert' | 'cloture'
export type TypeCompteComptable = 'actif' | 'passif' | 'charge' | 'produit' | 'hors'
export type SensBilan = 'actif' | 'passif'

export interface ExerciceComptable {
  id: string
  annee: number
  dateDebut: string
  dateFin: string
  statut: StatutExercice
  bilanValide: boolean
  dateCloture?: string | null
}

export interface CompteComptable {
  id: string
  numero: string
  intitule: string
  classe: number
  type: TypeCompteComptable
  actif: boolean
}

export interface JournalComptable {
  id: string
  code: string
  libelle: string
  actif: boolean
}

export interface LigneEcriture {
  id: string
  compteId: string
  compteNumero: string
  intitule?: string
  libelle?: string | null
  debit: number
  credit: number
}

export interface EcritureComptable {
  id: string
  exerciceId: string
  journalId: string
  journalCode: string
  date: string
  numeroPiece: string
  libelle: string
  source: string
  sourceType?: string | null
  sourceId?: string | null
  auteurId?: string | null
  auteurNom?: string | null
  dateCreation: string
  lignes: LigneEcriture[]
  totalDebit: number
  totalCredit: number
}

export interface BilanInitialLigne {
  id: string
  exerciceId: string
  compteId: string
  compteNumero: string
  intitule?: string
  sens: SensBilan
  montant: number
}

export interface LigneBalance {
  compteNumero: string
  intitule: string
  classe: number
  totalDebit: number
  totalCredit: number
  soldeDebiteur: number
  soldeCrediteur: number
}

export interface CompteGrandLivre {
  compteNumero: string
  intitule: string
  mouvements: {
    date: string
    numeroPiece: string
    libelle: string
    debit: number
    credit: number
    solde: number
    ecritureId: string
  }[]
  soldeFinal: number
}

// ---------- Racine ----------

export interface AppData {
  agences: Agence[]
  zones: Zone[]
  comptesZoneTontine: CompteZoneTontine[]
  journeesCompteZone: JourneeCompteZone[]
  ajustementsCompteZone: AjustementCompteZone[]
  employes: Employe[]
  clients: Client[]
  carnets: CarnetTontine[]
  mises: MiseTontine[]
  comptes: Compte[]
  demandesOuvertureCompte: DemandeOuvertureCompte[]
  mouvements: MouvementCompte[]
  credits: Credit[]
  remboursements: Remboursement[]
  transactions: Transaction[]
  comptesCaisse: CompteCaisse[]
  mouvementsCompteCaisse: MouvementCompteCaisse[]
  ajustementsCompteCaisse: AjustementCompteCaisse[]
  ouverturesCaisse: OuvertureCaisse[]
  arretsCaisse: ArretCaisse[]
  journalConnexions: JournalConnexion[]
  /** Ordre client par zone (clé = zoneId). */
  compteursOrdreZone: Record<string, number>
  compteurs: { client: number; compte: number; credit: number; compteCaisse: number; clientBanque: number }
}
