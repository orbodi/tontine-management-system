import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  CARREAUX_PAR_CYCLE,
  CYCLES_PAR_CARNET,
  PRIX_CARNET,
  type Agence,
  type AppData,
  type ArretCaisse,
  type CarnetTontine,
  type Client,
  type CompteCaisse,
  type CompteZoneTontine,
  type Credit,
  type Droit,
  type Employe,
  type JournalConnexion,
  type JourneeCompteZone,
  type MiseTontine,
  type MouvementCompte,
  type MouvementCompteCaisse,
  type OuvertureCaisse,
  type Remboursement,
  type Role,
  type Transaction,
  type TypeCarnet,
  type TypeCompte,
  type Zone,
} from './types'
import {
  calculerMisesDepuisMontant,
  carreauxNets,
  carreauxRetirables,
  CARNETS_RETRAIT_6_MOIS,
  compteCaisseDe,
  compteZoneDe,
  deltaSoldeOperationCaisse,
  depotsTontineZoneJour,
  eligibiliteRetraitCarnet,
  estOperationCaisse,
  journeesCaisseEnRetard,
  journeesOuvertesEnAttenteCloture,
  messageBlocageCaisseJournaliere,
  arretCaisseDuJour,
  aujourdHuiIso,
  ouvertureCaisseDuJour,
  situationCaisse,
  statutDepuisEcart,
} from './metier'
import { genererDonneesDemo } from './demo-data'
import { numeroCarnet, numeroClient, numeroCompteCaisse, numeroCompteSolde, pad4, uid } from './utils'

const STORAGE_KEY = 'microfinance-data-v21'
const SESSION_KEY = 'microfinance-session-v21'

export const LIBELLES_ROLE: Record<Role, string> = {
  admin: 'Administrateur',
  chef_agence: "Chef d'agence",
  caissier: 'Caissier',
}

export const LIBELLES_DROIT: Record<Droit, string> = {
  gerer_clients: 'Gérer les clients',
  operer_comptes: 'Opérer les comptes (dépôts, retraits, mises)',
  approuver_credits: 'Approuver les crédits',
  verrouiller_comptes: 'Verrouiller / déverrouiller les comptes',
  gerer_employes: 'Gérer les employés',
  voir_rapports: 'Consulter les rapports',
  gerer_agences: 'Gérer les agences',
  gerer_zones: 'Gérer les zones',
}

export const TOUS_DROITS = Object.keys(LIBELLES_DROIT) as Droit[]

interface StoreApi {
  data: AppData
  employeConnecte: Employe | null
  connexion: (identifiant: string, motDePasse: string) => boolean
  deconnexion: () => void
  estAdmin: boolean
  estChefAgence: boolean
  estCaissier: boolean
  aDroit: (droit: Droit) => boolean
  /** Filtre agence pour opérations/caisse (chef = son agence ; sinon null = tout). */
  agenceFiltreOperations: string | null
  // Agences
  ajouterAgence: (a: Omit<Agence, 'id' | 'actif'>) => boolean
  modifierAgence: (id: string, patch: Partial<Agence>) => void
  basculerActifAgence: (id: string) => void
  // Zones
  ajouterZone: (z: Omit<Zone, 'id' | 'actif'>) => string | null
  modifierZone: (id: string, patch: Partial<Zone>) => string | null
  basculerActifZone: (id: string) => void
  // Compte zone tontine
  saisirMontantReelZone: (zoneId: string, montantReel: number, dateIso?: string, note?: string) => string | null
  cloturerJourneeZone: (zoneId: string, dateIso?: string) => string | null
  ajusterCumulCompteZone: (
    zoneId: string,
    type: 'manquant' | 'surplus',
    montant: number,
    motif: string,
  ) => string | null
  // Clients
  ajouterClient: (
    c: Omit<Client, 'id' | 'codeClient' | 'dateInscription' | 'actif' | 'agenceId' | 'ordreZone'>,
  ) => { codeClient: string; prenom: string; nom: string } | null
  modifierClient: (id: string, patch: Partial<Client>) => string | null
  basculerActifClient: (id: string) => void
  // Carnets
  ouvrirCarnet: (
    clientId: string,
    typeCarnet: TypeCarnet,
    mise: number,
    frequence: CarnetTontine['frequence'],
  ) => { id: string; numero: string } | { erreur: string }
  encaisserCotisation: (carnetId: string, montant: number) => string | null
  /** Retrait partiel ou total sur un cycle (souvent un cycle passé). */
  retraitCycle: (carnetId: string, cycle: number, nombreCarreaux: number) => string | null
  basculerVerrouCarnet: (id: string) => void
  /** Admin uniquement — active/désactive les retraits (cartes enfants / bloquée). */
  basculerRetraitCarnetAdmin: (id: string) => string | null
  // Comptes à solde
  ouvrirCompte: (clientId: string, type: TypeCompte) => { id: string; numero: string } | { erreur: string }
  deposerCompte: (compteId: string, montant: number, note?: string) => string | null
  retirerCompte: (compteId: string, montant: number, note?: string) => string | null
  basculerVerrouCompte: (id: string) => void
  // Crédits
  demanderCredit: (c: {
    clientId: string
    montant: number
    tauxInteret: number
    dureeMois: number
    motif?: string
  }) => void
  approuverCredit: (creditId: string) => void
  rejeterCredit: (creditId: string) => void
  rembourserCredit: (creditId: string, montant: number) => void
  // Employés
  ajouterEmploye: (e: Omit<Employe, 'id' | 'actif' | 'dateEmbauche'>) => boolean
  modifierEmploye: (id: string, patch: Partial<Employe>) => void
  supprimerEmploye: (id: string) => void
  basculerActifEmploye: (id: string) => void
  // Caisse
  /** Ouverture de journée : saisie du montant d'ouverture (admin / chef). */
  ouvrirJourneeCaisse: (
    employeId: string,
    soldeOuverture: number,
    note?: string,
    journee?: string,
  ) => string | null
  /** Régularisation admin des cumuls manquant / surplus du compte caisse. */
  regulariserCumulCompteCaisse: (
    employeId: string,
    type: 'manquant' | 'surplus',
    montant: number,
    motif: string,
  ) => string | null
  arreterCaisse: (
    montantFermeture: number,
    note?: string,
    journee?: string,
    /** Caisse du caissier à arrêter (obligatoire pour admin/chef). */
    cibleEmployeId?: string,
  ) => string | null
  /** Alimentation du compte caisse (admin / chef d'agence). */
  alimenterCompteCaisse: (employeId: string, montant: number, note?: string) => string | null
  reinitialiserDemo: () => void
}

const StoreContext = createContext<StoreApi | null>(null)

function employeACompteCaisse(role: Role): boolean {
  return role === 'caissier' || role === 'chef_agence'
}

function ouvrirCompteCaisseSiBesoin(d: AppData, employeId: string): AppData {
  if (compteCaisseDe(d.comptesCaisse, employeId)) return d
  const emp = d.employes.find((e) => e.id === employeId)
  if (!emp || !employeACompteCaisse(emp.role)) return d
  const ordre = (d.compteurs.compteCaisse ?? 0) + 1
  const compte: CompteCaisse = {
    id: uid(),
    employeId,
    agenceId: emp.agenceId,
    numero: numeroCompteCaisse(ordre),
    solde: 0,
    cumulManquant: 0,
    cumulSurplus: 0,
    dateOuverture: new Date().toISOString(),
    actif: true,
  }
  return {
    ...d,
    comptesCaisse: [...d.comptesCaisse, compte],
    compteurs: { ...d.compteurs, compteCaisse: ordre },
  }
}

/** Applique une opération caisse au solde du compte de l'opérateur. */
function appliquerTxCompteCaisse(d: AppData, tx: Transaction): AppData {
  if (!estOperationCaisse(tx.type) || !tx.operateurId) return d
  const next = ouvrirCompteCaisseSiBesoin(d, tx.operateurId)
  const compte = compteCaisseDe(next.comptesCaisse, tx.operateurId)
  if (!compte) return next
  const delta = deltaSoldeOperationCaisse(tx.type, tx.montant)
  if (delta === 0) return next
  const soldeApres = compte.solde + delta
  const mouvement: MouvementCompteCaisse = {
    id: uid(),
    compteCaisseId: compte.id,
    employeId: tx.operateurId,
    type: delta > 0 ? 'entree_operation' : 'sortie_operation',
    montant: Math.abs(delta),
    sens: delta > 0 ? 'credit' : 'debit',
    soldeApres,
    date: tx.date,
    description: tx.description,
    transactionId: tx.id,
    operateurId: tx.operateurId,
    operateurNom: tx.operateur,
  }
  return {
    ...next,
    comptesCaisse: next.comptesCaisse.map((c) =>
      c.id === compte.id ? { ...c, solde: soldeApres } : c,
    ),
    mouvementsCompteCaisse: [mouvement, ...next.mouvementsCompteCaisse],
  }
}

function enregistrerTransactions(d: AppData, nouvelles: Transaction[]): AppData {
  const apres = nouvelles.reduce((acc, tx) => appliquerTxCompteCaisse(acc, tx), d)
  return { ...apres, transactions: [...nouvelles, ...d.transactions] }
}

function normaliserAppData(brut: AppData): AppData {
  let d: AppData = {
    ...brut,
    comptesZoneTontine: brut.comptesZoneTontine ?? [],
    journeesCompteZone: brut.journeesCompteZone ?? [],
    ajustementsCompteZone: brut.ajustementsCompteZone ?? [],
    comptesCaisse: (brut.comptesCaisse ?? []).map((c) => ({
      ...c,
      cumulManquant: c.cumulManquant ?? 0,
      cumulSurplus: c.cumulSurplus ?? 0,
    })),
    mouvementsCompteCaisse: brut.mouvementsCompteCaisse ?? [],
    ajustementsCompteCaisse: brut.ajustementsCompteCaisse ?? [],
    ouverturesCaisse: brut.ouverturesCaisse ?? [],
    compteurs: {
      client: brut.compteurs?.client ?? 0,
      compte: brut.compteurs?.compte ?? 0,
      credit: brut.compteurs?.credit ?? 0,
      compteCaisse: brut.compteurs?.compteCaisse ?? 0,
    },
    arretsCaisse: (brut.arretsCaisse ?? []).map((a) => {
      const dateCloture = a.dateCloture ?? a.date ?? new Date().toISOString()
      const totalEntrees = a.totalEntrees ?? 0
      const totalSorties = a.totalSorties ?? 0
      const soldeTheorique = a.soldeTheorique ?? totalEntrees - totalSorties
      const soldeOuverture =
        typeof a.soldeOuverture === 'number'
          ? a.soldeOuverture
          : Math.max(0, soldeTheorique - (totalEntrees - totalSorties))
      return {
        ...a,
        journee: a.journee ?? dateCloture.slice(0, 10),
        dateCloture,
        date: dateCloture,
        soldeOuverture,
        soldeTheorique,
      }
    }),
  }
  const manquantsZone: CompteZoneTontine[] = d.zones
    .filter((z) => !d.comptesZoneTontine.some((c) => c.zoneId === z.id))
    .map((z) => ({
      id: uid(),
      zoneId: z.id,
      cumulManquant: 0,
      cumulSurplus: 0,
      actif: true,
    }))
  if (manquantsZone.length > 0) {
    d = { ...d, comptesZoneTontine: [...d.comptesZoneTontine, ...manquantsZone] }
  }
  for (const emp of d.employes) {
    if (emp.actif && employeACompteCaisse(emp.role)) {
      d = ouvrirCompteCaisseSiBesoin(d, emp.id)
    }
  }
  return d
}

function chargerDonnees(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return normaliserAppData(JSON.parse(raw) as AppData)
  } catch {
    // données corrompues
  }
  return genererDonneesDemo()
}

function chargerSession(): string | null {
  return localStorage.getItem(SESSION_KEY)
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(chargerDonnees)
  const [sessionUserId, setSessionUserId] = useState<string | null>(chargerSession)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  }, [data])

  useEffect(() => {
    if (sessionUserId) localStorage.setItem(SESSION_KEY, sessionUserId)
    else localStorage.removeItem(SESSION_KEY)
  }, [sessionUserId])

  const api = useMemo<StoreApi>(() => {
    const maintenant = () => new Date().toISOString()
    const employeConnecte = data.employes.find((u) => u.id === sessionUserId && u.actif) ?? null
    const estAdmin = employeConnecte?.role === 'admin'
    const estChefAgence = employeConnecte?.role === 'chef_agence'
    const estCaissier = employeConnecte?.role === 'caissier'

    const transaction = (
      t: Omit<Transaction, 'id' | 'operateur' | 'operateurId' | 'agenceId'>,
    ): Transaction => ({
      ...t,
      id: uid(),
      operateur: employeConnecte?.nomComplet ?? 'Inconnu',
      operateurId: employeConnecte?.id ?? '',
      agenceId: employeConnecte?.agenceId ?? '',
    })

    const nomClient = (d: AppData, clientId: string) => {
      const c = d.clients.find((x) => x.id === clientId)
      return c ? `${c.prenom} ${c.nom}` : 'Inconnu'
    }

    const aLeDroit = (droit: Droit) => {
      if (!employeConnecte) return false
      if (employeConnecte.role === 'admin') return true
      return employeConnecte.droits.includes(droit)
    }

    /** Bloque si une journée passée n'a pas d'arrêt de caisse. */
    const verifierCaisseJournaliere = (d: AppData): string | null => {
      if (!employeConnecte) return 'Non connecté.'
      return messageBlocageCaisseJournaliere(
        employeConnecte.id,
        d.transactions,
        d.arretsCaisse,
        d.ouverturesCaisse ?? [],
      )
    }

    const verifierSoldeCaissePourSortie = (d: AppData, montant: number): string | null => {
      if (!employeConnecte) return 'Non connecté.'
      const compte = compteCaisseDe(d.comptesCaisse, employeConnecte.id)
      const solde = compte?.solde ?? 0
      if (solde < montant) {
        return `Solde de caisse insuffisant (${solde.toLocaleString('fr-FR')} FCFA). Alimentez le compte caisse avant ce retrait.`
      }
      return null
    }

    return {
      data,
      employeConnecte,
      estAdmin: !!estAdmin,
      estChefAgence: !!estChefAgence,
      estCaissier: !!estCaissier,
      agenceFiltreOperations: estChefAgence && employeConnecte ? employeConnecte.agenceId : null,

      aDroit(droit) {
        return aLeDroit(droit)
      },

      connexion(identifiant, motDePasse) {
        const u = data.employes.find(
          (x) => x.identifiant === identifiant.trim() && x.motDePasse === motDePasse && x.actif,
        )
        if (!u) return false
        const log: JournalConnexion = {
          id: uid(),
          employeId: u.id,
          employeNom: u.nomComplet,
          agenceId: u.agenceId,
          date: maintenant(),
          type: 'connexion',
        }
        setData((d) => ({ ...d, journalConnexions: [log, ...d.journalConnexions] }))
        setSessionUserId(u.id)
        return true
      },

      deconnexion() {
        if (employeConnecte) {
          const log: JournalConnexion = {
            id: uid(),
            employeId: employeConnecte.id,
            employeNom: employeConnecte.nomComplet,
            agenceId: employeConnecte.agenceId,
            date: maintenant(),
            type: 'deconnexion',
          }
          setData((d) => ({ ...d, journalConnexions: [log, ...d.journalConnexions] }))
        }
        setSessionUserId(null)
      },

      // ---------- Agences ----------

      ajouterAgence(a) {
        if (data.agences.some((x) => x.code === a.code.trim())) return false
        setData((d) => ({
          ...d,
          agences: [...d.agences, { ...a, code: a.code.trim(), id: uid(), actif: true }],
        }))
        return true
      },

      modifierAgence(id, patch) {
        setData((d) => ({
          ...d,
          agences: d.agences.map((a) => (a.id === id ? { ...a, ...patch } : a)),
        }))
      },

      basculerActifAgence(id) {
        setData((d) => ({
          ...d,
          agences: d.agences.map((a) => (a.id === id ? { ...a, actif: !a.actif } : a)),
        }))
      },

      // ---------- Zones ----------

      ajouterZone(z) {
        const code = z.code.trim()
        if (!/^\d{2}$/.test(code)) return 'Le numéro de zone doit être sur 2 chiffres (ex. 01).'
        // Unique globalement : le n° de carnet = zone + ordre (sans préfixe agence).
        if (data.zones.some((x) => x.code === code)) {
          return 'Ce numéro de zone existe déjà.'
        }
        if (!data.agences.some((a) => a.id === z.agenceId)) return 'Agence introuvable.'
        const id = uid()
        const compteZoneId = uid()
        setData((d) => ({
          ...d,
          zones: [
            ...d.zones,
            {
              ...z,
              code,
              nom: z.nom?.trim() || undefined,
              id,
              actif: true,
            },
          ],
          comptesZoneTontine: [
            ...d.comptesZoneTontine,
            {
              id: compteZoneId,
              zoneId: id,
              cumulManquant: 0,
              cumulSurplus: 0,
              actif: true,
            },
          ],
          compteursOrdreZone: { ...d.compteursOrdreZone, [id]: 0 },
        }))
        return null
      },

      modifierZone(id, patch) {
        let erreur: string | null = null
        setData((d) => {
          const zone = d.zones.find((z) => z.id === id)
          if (!zone) {
            erreur = 'Zone introuvable.'
            return d
          }
          const code = patch.code !== undefined ? patch.code.trim() : zone.code
          if (patch.code !== undefined && !/^\d{2}$/.test(code)) {
            erreur = 'Le numéro de zone doit être sur 2 chiffres (ex. 01).'
            return d
          }
          if (d.zones.some((x) => x.id !== id && x.code === code)) {
            erreur = 'Ce numéro de zone existe déjà.'
            return d
          }
          return {
            ...d,
            zones: d.zones.map((z) =>
              z.id === id
                ? {
                    ...z,
                    ...patch,
                    code,
                    nom: patch.nom !== undefined ? patch.nom.trim() || undefined : z.nom,
                  }
                : z,
            ),
          }
        })
        return erreur
      },

      basculerActifZone(id) {
        setData((d) => ({
          ...d,
          zones: d.zones.map((z) => (z.id === id ? { ...z, actif: !z.actif } : z)),
        }))
      },

      // ---------- Compte zone tontine ----------

      saisirMontantReelZone(zoneId, montantReel, dateIso, note) {
        if (!employeConnecte) return 'Non connecté.'
        if (!aLeDroit('operer_comptes') && !estAdmin) return 'Droit insuffisant.'
        if (montantReel < 0) return 'Montant invalide.'
        const jour = dateIso ?? new Date().toISOString().slice(0, 10)
        let erreur: string | null = null
        setData((d) => {
          const zone = d.zones.find((z) => z.id === zoneId)
          if (!zone) {
            erreur = 'Zone introuvable.'
            return d
          }
          let compte = compteZoneDe(d.comptesZoneTontine, zoneId)
          let comptes = d.comptesZoneTontine
          if (!compte) {
            compte = {
              id: uid(),
              zoneId,
              cumulManquant: 0,
              cumulSurplus: 0,
              actif: true,
            }
            comptes = [...comptes, compte]
          }
          const existante = d.journeesCompteZone.find((j) => j.zoneId === zoneId && j.date === jour)
          if (existante?.cloturee) {
            erreur = 'Cette journée est déjà clôturée. Seul un admin peut ajuster les cumuls.'
            return d
          }
          const maintenantIso = maintenant()
          if (existante) {
            return {
              ...d,
              comptesZoneTontine: comptes,
              journeesCompteZone: d.journeesCompteZone.map((j) =>
                j.id === existante.id
                  ? {
                      ...j,
                      montantReel,
                      note: note?.trim() || j.note,
                      dateSaisieReel: maintenantIso,
                      operateurId: employeConnecte.id,
                      operateurNom: employeConnecte.nomComplet,
                    }
                  : j,
              ),
            }
          }
          const journee: JourneeCompteZone = {
            id: uid(),
            compteZoneId: compte.id,
            zoneId,
            date: jour,
            montantReel,
            montantTheorique: 0,
            ecart: 0,
            statut: 'en_cours',
            cloturee: false,
            dateSaisieReel: maintenantIso,
            operateurId: employeConnecte.id,
            operateurNom: employeConnecte.nomComplet,
            note: note?.trim() || undefined,
          }
          return {
            ...d,
            comptesZoneTontine: comptes,
            journeesCompteZone: [journee, ...d.journeesCompteZone],
          }
        })
        return erreur
      },

      cloturerJourneeZone(zoneId, dateIso) {
        if (!employeConnecte) return 'Non connecté.'
        if (!aLeDroit('operer_comptes') && !estAdmin) return 'Droit insuffisant.'
        const jour = dateIso ?? new Date().toISOString().slice(0, 10)
        let erreur: string | null = null
        setData((d) => {
          const journee = d.journeesCompteZone.find((j) => j.zoneId === zoneId && j.date === jour)
          if (!journee) {
            erreur = 'Saisissez d’abord le montant réel collecté pour ce jour.'
            return d
          }
          if (journee.cloturee) {
            erreur = 'Journée déjà clôturée.'
            return d
          }
          const compte = compteZoneDe(d.comptesZoneTontine, zoneId)
          if (!compte) {
            erreur = 'Compte zone introuvable.'
            return d
          }
          const theorique = depotsTontineZoneJour(zoneId, jour, d.clients, d.transactions)
          const ecart = journee.montantReel - theorique
          const statut = statutDepuisEcart(ecart)
          let cumulManquant = compte.cumulManquant
          let cumulSurplus = compte.cumulSurplus
          if (ecart < 0) cumulManquant += Math.abs(ecart)
          if (ecart > 0) cumulSurplus += ecart
          return {
            ...d,
            comptesZoneTontine: d.comptesZoneTontine.map((c) =>
              c.id === compte.id ? { ...c, cumulManquant, cumulSurplus } : c,
            ),
            journeesCompteZone: d.journeesCompteZone.map((j) =>
              j.id === journee.id
                ? {
                    ...j,
                    montantTheorique: theorique,
                    ecart,
                    statut,
                    cloturee: true,
                    dateCloture: maintenant(),
                  }
                : j,
            ),
          }
        })
        return erreur
      },

      ajusterCumulCompteZone(zoneId, type, montant, motif) {
        if (!estAdmin) return 'Seul l’administrateur peut ajuster les cumuls.'
        if (montant <= 0) return 'Montant invalide.'
        if (!motif.trim()) return 'Le motif est obligatoire.'
        let erreur: string | null = null
        setData((d) => {
          const compte = compteZoneDe(d.comptesZoneTontine, zoneId)
          if (!compte) {
            erreur = 'Compte zone introuvable.'
            return d
          }
          const cumulAvant = type === 'manquant' ? compte.cumulManquant : compte.cumulSurplus
          if (montant > cumulAvant) {
            erreur = `Le montant dépasse le cumul ${type} (${cumulAvant}).`
            return d
          }
          const cumulApres = cumulAvant - montant
          return {
            ...d,
            comptesZoneTontine: d.comptesZoneTontine.map((c) =>
              c.id === compte.id
                ? {
                    ...c,
                    cumulManquant: type === 'manquant' ? cumulApres : c.cumulManquant,
                    cumulSurplus: type === 'surplus' ? cumulApres : c.cumulSurplus,
                  }
                : c,
            ),
            ajustementsCompteZone: [
              {
                id: uid(),
                compteZoneId: compte.id,
                zoneId,
                date: maintenant(),
                type,
                montant,
                motif: motif.trim(),
                adminId: employeConnecte!.id,
                adminNom: employeConnecte!.nomComplet,
                cumulAvant,
                cumulApres,
              },
              ...d.ajustementsCompteZone,
            ],
          }
        })
        return erreur
      },

      // ---------- Clients ----------

      ajouterClient(c) {
        if (!employeConnecte) return null
        let cree: { codeClient: string; prenom: string; nom: string } | null = null
        setData((d) => {
          const zone = d.zones.find((z) => z.id === c.zoneId && z.actif)
          if (!zone) return d
          const numero = d.compteurs.client + 1
          const ordre = (d.compteursOrdreZone[zone.id] ?? 0) + 1
          const codeClient = numeroClient(numero)
          cree = { codeClient, prenom: c.prenom, nom: c.nom }
          return {
            ...d,
            compteurs: { ...d.compteurs, client: numero },
            compteursOrdreZone: { ...d.compteursOrdreZone, [zone.id]: ordre },
            clients: [
              ...d.clients,
              {
                ...c,
                id: uid(),
                codeClient,
                agenceId: zone.agenceId,
                zoneId: zone.id,
                ordreZone: ordre,
                dateInscription: maintenant(),
                actif: true,
              },
            ],
          }
        })
        return cree
      },

      modifierClient(id, patch) {
        if (estCaissier) return 'Un caissier ne peut pas modifier un client.'
        setData((d) => ({
          ...d,
          clients: d.clients.map((c) => (c.id === id ? { ...c, ...patch } : c)),
        }))
        return null
      },

      basculerActifClient(id) {
        setData((d) => ({
          ...d,
          clients: d.clients.map((c) => (c.id === id ? { ...c, actif: !c.actif } : c)),
        }))
      },

      // ---------- Carnets ----------

      ouvrirCarnet(clientId, typeCarnet, mise, frequence) {
        if (!employeConnecte) return { erreur: 'Non connecté.' }
        let resultat: { id: string; numero: string } | { erreur: string } = { erreur: 'Erreur inconnue.' }
        setData((d) => {
          const blocage = verifierCaisseJournaliere(d)
          if (blocage) {
            resultat = { erreur: blocage }
            return d
          }
          const client = d.clients.find((c) => c.id === clientId)
          if (!client) {
            resultat = { erreur: 'Client introuvable.' }
            return d
          }
          const zone = d.zones.find((z) => z.id === client.zoneId)
          if (!zone) {
            resultat = { erreur: 'Zone du client introuvable.' }
            return d
          }
          const date = maintenant()
          // N° unique : préfixe zone + prochain ordre libre (plusieurs carnets / client possibles)
          let ordre = client.ordreZone
          let numero = numeroCarnet(zone.code, ordre)
          const numerosExistants = new Set(d.carnets.map((c) => c.numero))
          while (numerosExistants.has(numero)) {
            ordre += 1
            numero = numeroCarnet(zone.code, ordre)
          }
          const id = uid()
          resultat = { id, numero }
          const txVente = transaction({
            type: 'vente_carnet',
            clientId,
            montant: PRIX_CARNET,
            date,
            description: `Vente du carnet ${numero} — ${nomClient(d, clientId)} (cycle 1/12)`,
          })
          return enregistrerTransactions(
            {
              ...d,
              carnets: [
                ...d.carnets,
                {
                  id,
                  clientId,
                  numero,
                  zoneId: zone.id,
                  agenceId: zone.agenceId,
                  typeCarnet,
                  mise,
                  frequence,
                  misesParCycle: CARREAUX_PAR_CYCLE,
                  cycleActuel: 1,
                  dateOuverture: date,
                  verrouille: false,
                  retraitActiveParAdmin: !CARNETS_RETRAIT_6_MOIS.includes(typeCarnet),
                  actif: true,
                },
              ],
            },
            [txVente],
          )
        })
        return resultat
      },

      encaisserCotisation(carnetId, montant) {
        let erreur: string | null = null
        setData((d) => {
          erreur = verifierCaisseJournaliere(d)
          if (erreur) return d
          const carnet = d.carnets.find((c) => c.id === carnetId)
          if (!carnet || !carnet.actif) return d
          if (carnet.verrouille) {
            erreur = 'Ce carnet est verrouillé.'
            return d
          }
          const calc = calculerMisesDepuisMontant(montant, carnet.mise)
          if (!calc.ok) {
            erreur = calc.erreur
            return d
          }
          const payees = carreauxNets(carnet, d.mises)
          const restants = carnet.misesParCycle - payees
          const nombre = Math.min(calc.nombreMises, restants)
          if (nombre <= 0) {
            erreur = 'Le cycle actuel est déjà complet (31 carreaux).'
            return d
          }
          if (nombre !== calc.nombreMises) {
            erreur = `Seulement ${restants} carreau(x) restant(s) sur ce cycle.`
            return d
          }
          const date = maintenant()
          const cycleDepot = carnet.cycleActuel
          const miseEntree: MiseTontine = {
            id: uid(),
            carnetId,
            cycle: cycleDepot,
            nombreMises: nombre,
            montant: carnet.mise * nombre,
            date,
          }
          const nouvelles: Transaction[] = []
          if (payees === 0) {
            nouvelles.push(
              transaction({
                type: 'commission_tontine',
                clientId: carnet.clientId,
                montant: carnet.mise,
                date,
                description: `Première cotisation (P.C) — ${nomClient(d, carnet.clientId)} (cycle ${cycleDepot})`,
              }),
            )
            if (nombre > 1) {
              nouvelles.push(
                transaction({
                  type: 'mise_tontine',
                  clientId: carnet.clientId,
                  montant: carnet.mise * (nombre - 1),
                  date,
                  description: `Dépôt ×${nombre - 1} — ${nomClient(d, carnet.clientId)} (cycle ${cycleDepot})`,
                }),
              )
            }
          } else {
            nouvelles.push(
              transaction({
                type: 'mise_tontine',
                clientId: carnet.clientId,
                montant: miseEntree.montant,
                date,
                description: `Dépôt ×${nombre} — ${nomClient(d, carnet.clientId)} (cycle ${cycleDepot})`,
              }),
            )
          }

          // Passage automatique au mois / cycle suivant si 31 carreaux atteints
          const netsApres = payees + nombre
          let carnets = d.carnets
          if (netsApres >= carnet.misesParCycle) {
            if (carnet.cycleActuel >= CYCLES_PAR_CARNET) {
              // Fin des 12 mois : renouvellement — n° hérite toujours de la zone du client
              const client = d.clients.find((c) => c.id === carnet.clientId)
              const zone = client ? d.zones.find((z) => z.id === client.zoneId) : undefined
              const nouveauNumero = client && zone
                ? numeroCarnet(zone.code, client.ordreZone)
                : carnet.numero
              nouvelles.push(
                transaction({
                  type: 'vente_carnet',
                  clientId: carnet.clientId,
                  montant: PRIX_CARNET,
                  date,
                  description: `Renouvellement auto carnet ${nouveauNumero} — ${nomClient(d, carnet.clientId)} (nouveau cycle 1/12)`,
                }),
              )
              carnets = d.carnets.map((c) =>
                c.id === carnetId
                  ? {
                      ...c,
                      cycleActuel: 1,
                      zoneId: zone?.id ?? c.zoneId,
                      agenceId: zone?.agenceId ?? c.agenceId,
                      numero: nouveauNumero,
                      dateOuverture: date,
                    }
                  : c,
              )
            } else {
              carnets = d.carnets.map((c) =>
                c.id === carnetId ? { ...c, cycleActuel: c.cycleActuel + 1 } : c,
              )
            }
          }

          return enregistrerTransactions(
            {
              ...d,
              carnets,
              mises: [...d.mises, miseEntree],
            },
            nouvelles,
          )
        })
        return erreur
      },

      retraitCycle(carnetId, cycle, nombreCarreaux) {
        if (nombreCarreaux <= 0) return 'Nombre de carreaux invalide.'
        let erreur: string | null = null
        setData((d) => {
          erreur = verifierCaisseJournaliere(d)
          if (erreur) return d
          const carnet = d.carnets.find((c) => c.id === carnetId)
          if (!carnet || !carnet.actif) return d
          if (carnet.verrouille) {
            erreur = 'Ce carnet est verrouillé.'
            return d
          }
          const eligibilite = eligibiliteRetraitCarnet(carnet, d.mises)
          if (!eligibilite.autorise) {
            erreur =
              'Retrait non activé : demandez à l’administrateur d’autoriser le retrait sur cette carte.'
            return d
          }
          // Retrait possible sur le cycle actuel (partiel) ou un cycle passé
          if (cycle > carnet.cycleActuel) {
            erreur = 'Cycle invalide.'
            return d
          }
          const disponibles = carreauxRetirables(carnet, d.mises, cycle)
          if (disponibles <= 0) {
            erreur = 'Aucun carreau retirable sur ce cycle (déjà soldé ou P.C seule restante).'
            return d
          }
          if (nombreCarreaux > disponibles) {
            erreur = `Retrait impossible : seulement ${disponibles} carreau(x) disponible(s) (hors P.C).`
            return d
          }
          const montant = carnet.mise * nombreCarreaux
          erreur = verifierSoldeCaissePourSortie(d, montant)
          if (erreur) return d
          const date = maintenant()
          const retrait: MiseTontine = {
            id: uid(),
            carnetId,
            cycle,
            nombreMises: -nombreCarreaux,
            montant: -montant,
            date,
          }
          const total = nombreCarreaux === disponibles
          const txRetrait = transaction({
            type: 'retrait_tontine',
            clientId: carnet.clientId,
            montant,
            date,
            description: `Retrait ${total ? 'total' : 'partiel'} ×${nombreCarreaux} — cycle ${cycle} — ${nomClient(d, carnet.clientId)} (carnet ${carnet.numero})`,
          })
          return enregistrerTransactions(
            {
              ...d,
              mises: [...d.mises, retrait],
            },
            [txRetrait],
          )
        })
        return erreur
      },

      basculerVerrouCarnet(id) {
        setData((d) => ({
          ...d,
          carnets: d.carnets.map((c) => (c.id === id ? { ...c, verrouille: !c.verrouille } : c)),
        }))
      },

      basculerRetraitCarnetAdmin(id) {
        if (!estAdmin) return 'Seul l’administrateur peut activer ou désactiver les retraits.'
        let erreur: string | null = null
        setData((d) => {
          const carnet = d.carnets.find((c) => c.id === id)
          if (!carnet) {
            erreur = 'Carnet introuvable.'
            return d
          }
          if (!CARNETS_RETRAIT_6_MOIS.includes(carnet.typeCarnet)) {
            erreur = 'Cette action concerne uniquement les cartes enfants et bloquée.'
            return d
          }
          return {
            ...d,
            carnets: d.carnets.map((c) =>
              c.id === id ? { ...c, retraitActiveParAdmin: !c.retraitActiveParAdmin } : c,
            ),
          }
        })
        return erreur
      },

      // ---------- Comptes à solde ----------

      ouvrirCompte(clientId, type) {
        if (estCaissier) return { erreur: 'Un caissier ne peut pas ouvrir un compte courant ou épargne.' }
        let resultat: { id: string; numero: string } | { erreur: string } = { erreur: 'Erreur inconnue.' }
        setData((d) => {
          const client = d.clients.find((c) => c.id === clientId)
          if (!client) {
            resultat = { erreur: 'Client introuvable.' }
            return d
          }
          const numeroOrdre = d.compteurs.compte + 1
          const id = uid()
          const numero = numeroCompteSolde(numeroOrdre)
          resultat = { id, numero }
          return {
            ...d,
            compteurs: { ...d.compteurs, compte: numeroOrdre },
            comptes: [
              ...d.comptes,
              {
                id,
                clientId,
                type,
                numero,
                solde: 0,
                dateOuverture: maintenant(),
                verrouille: false,
              },
            ],
          }
        })
        return resultat
      },

      deposerCompte(compteId, montant, note) {
        if (montant <= 0) return 'Montant invalide.'
        let erreur: string | null = null
        setData((d) => {
          erreur = verifierCaisseJournaliere(d)
          if (erreur) return d
          const compte = d.comptes.find((c) => c.id === compteId)
          if (!compte) return d
          if (compte.verrouille) {
            erreur = 'Ce compte est verrouillé.'
            return d
          }
          const date = maintenant()
          const mouvement: MouvementCompte = { id: uid(), compteId, type: 'depot', montant, date, note }
          const txDepot = transaction({
            type: 'depot_compte',
            clientId: compte.clientId,
            montant,
            date,
            description: `Dépôt ${compte.numero} — ${nomClient(d, compte.clientId)}${note ? ` (${note})` : ''}`,
          })
          return enregistrerTransactions(
            {
              ...d,
              comptes: d.comptes.map((c) => (c.id === compteId ? { ...c, solde: c.solde + montant } : c)),
              mouvements: [...d.mouvements, mouvement],
            },
            [txDepot],
          )
        })
        return erreur
      },

      retirerCompte(compteId, montant, note) {
        if (montant <= 0) return 'Montant invalide.'
        let erreur: string | null = null
        setData((d) => {
          erreur = verifierCaisseJournaliere(d)
          if (erreur) return d
          const compte = d.comptes.find((c) => c.id === compteId)
          if (!compte) return d
          if (compte.verrouille) {
            erreur = 'Ce compte est verrouillé.'
            return d
          }
          if (compte.solde < montant) {
            erreur = 'Solde insuffisant.'
            return d
          }
          erreur = verifierSoldeCaissePourSortie(d, montant)
          if (erreur) return d
          const date = maintenant()
          const mouvement: MouvementCompte = { id: uid(), compteId, type: 'retrait', montant, date, note }
          const txRetrait = transaction({
            type: 'retrait_compte',
            clientId: compte.clientId,
            montant,
            date,
            description: `Retrait ${compte.numero} — ${nomClient(d, compte.clientId)}${note ? ` (${note})` : ''}`,
          })
          return enregistrerTransactions(
            {
              ...d,
              comptes: d.comptes.map((c) => (c.id === compteId ? { ...c, solde: c.solde - montant } : c)),
              mouvements: [...d.mouvements, mouvement],
            },
            [txRetrait],
          )
        })
        return erreur
      },

      basculerVerrouCompte(id) {
        setData((d) => ({
          ...d,
          comptes: d.comptes.map((c) => (c.id === id ? { ...c, verrouille: !c.verrouille } : c)),
        }))
      },

      // ---------- Crédits ----------

      demanderCredit(c) {
        setData((d) => {
          const numero = d.compteurs.credit + 1
          const credit: Credit = {
            ...c,
            id: uid(),
            numero: `CR-${pad4(numero)}`,
            dateDemande: maintenant(),
            statut: 'en_attente',
          }
          return {
            ...d,
            compteurs: { ...d.compteurs, credit: numero },
            credits: [...d.credits, credit],
          }
        })
      },

      approuverCredit(creditId) {
        setData((d) => {
          const credit = d.credits.find((c) => c.id === creditId)
          if (!credit || credit.statut !== 'en_attente') return d
          const insuffisant = verifierSoldeCaissePourSortie(d, credit.montant)
          if (insuffisant) return d
          const date = maintenant()
          const txOctroi = transaction({
            type: 'octroi_credit',
            clientId: credit.clientId,
            montant: credit.montant,
            date,
            description: `Octroi crédit ${credit.numero} — ${nomClient(d, credit.clientId)}`,
          })
          return enregistrerTransactions(
            {
              ...d,
              credits: d.credits.map((c) =>
                c.id === creditId ? { ...c, statut: 'en_cours' as const, dateOctroi: date } : c,
              ),
            },
            [txOctroi],
          )
        })
      },

      rejeterCredit(creditId) {
        setData((d) => ({
          ...d,
          credits: d.credits.map((c) =>
            c.id === creditId && c.statut === 'en_attente' ? { ...c, statut: 'rejete' as const } : c,
          ),
        }))
      },

      rembourserCredit(creditId, montant) {
        if (montant <= 0) return
        setData((d) => {
          const credit = d.credits.find((c) => c.id === creditId)
          if (!credit || (credit.statut !== 'en_cours' && credit.statut !== 'en_retard')) return d
          const date = maintenant()
          const remboursement: Remboursement = { id: uid(), creditId, montant, date }
          const totalDu = credit.montant * (1 + credit.tauxInteret / 100)
          const dejaPaye = d.remboursements
            .filter((r) => r.creditId === creditId)
            .reduce((s, r) => s + r.montant, 0)
          const soldeApres = totalDu - dejaPaye - montant
          const txRemb = transaction({
            type: 'remboursement_credit',
            clientId: credit.clientId,
            montant,
            date,
            description: `Remboursement ${credit.numero} — ${nomClient(d, credit.clientId)}`,
          })
          return enregistrerTransactions(
            {
              ...d,
              remboursements: [...d.remboursements, remboursement],
              credits: d.credits.map((c) =>
                c.id === creditId && soldeApres <= 0.5 ? { ...c, statut: 'rembourse' as const } : c,
              ),
            },
            [txRemb],
          )
        })
      },

      // ---------- Employés ----------

      ajouterEmploye(e) {
        if (data.employes.some((x) => x.identifiant === e.identifiant)) return false
        setData((d) => {
          const nouvel: Employe = { ...e, id: uid(), actif: true, dateEmbauche: maintenant() }
          let next = { ...d, employes: [...d.employes, nouvel] }
          if (employeACompteCaisse(nouvel.role)) {
            next = ouvrirCompteCaisseSiBesoin(next, nouvel.id)
          }
          return next
        })
        return true
      },

      modifierEmploye(id, patch) {
        setData((d) => ({
          ...d,
          employes: d.employes.map((u) => (u.id === id ? { ...u, ...patch } : u)),
        }))
      },

      supprimerEmploye(id) {
        if (id === employeConnecte?.id) return
        setData((d) => ({
          ...d,
          employes: d.employes.filter((u) => u.id !== id),
        }))
      },

      basculerActifEmploye(id) {
        setData((d) => ({
          ...d,
          employes: d.employes.map((u) => (u.id === id ? { ...u, actif: !u.actif } : u)),
        }))
      },

      alimenterCompteCaisse(employeId, montant, note) {
        if (!employeConnecte) return 'Non connecté.'
        if (!estAdmin && !estChefAgence) {
          return 'Seul l’administrateur ou le chef d’agence peut alimenter un compte caisse.'
        }
        if (montant <= 0) return 'Montant invalide.'
        let erreur: string | null = null
        setData((d) => {
          const cible = d.employes.find((e) => e.id === employeId && e.actif)
          if (!cible) {
            erreur = 'Employé introuvable.'
            return d
          }
          if (!employeACompteCaisse(cible.role)) {
            erreur = 'Cet employé n’a pas de compte caisse.'
            return d
          }
          if (estChefAgence && cible.agenceId !== employeConnecte.agenceId) {
            erreur = 'Vous ne pouvez alimenter que les caisses de votre agence.'
            return d
          }
          let next = ouvrirCompteCaisseSiBesoin(d, cible.id)
          const compte = compteCaisseDe(next.comptesCaisse, cible.id)
          if (!compte) {
            erreur = 'Compte caisse introuvable.'
            return d
          }
          const date = maintenant()
          const soldeApres = compte.solde + montant
          const mouvement: MouvementCompteCaisse = {
            id: uid(),
            compteCaisseId: compte.id,
            employeId: cible.id,
            type: 'alimentation',
            montant,
            sens: 'credit',
            soldeApres,
            date,
            description: note?.trim()
              ? `Alimentation — ${note.trim()}`
              : `Alimentation du compte caisse ${compte.numero}`,
            operateurId: employeConnecte.id,
            operateurNom: employeConnecte.nomComplet,
          }
          return {
            ...next,
            comptesCaisse: next.comptesCaisse.map((c) =>
              c.id === compte.id ? { ...c, solde: soldeApres } : c,
            ),
            mouvementsCompteCaisse: [mouvement, ...next.mouvementsCompteCaisse],
          }
        })
        return erreur
      },

      ouvrirJourneeCaisse(employeId, soldeOuverture, note, journee) {
        if (!employeConnecte) return 'Non connecté.'
        if (!estAdmin && !estChefAgence) {
          return 'Seul l’administrateur ou le chef d’agence peut ouvrir une journée de caisse.'
        }
        if (soldeOuverture < 0) return 'Montant d’ouverture invalide.'
        const jour = journee ?? aujourdHuiIso()
        let erreur: string | null = null
        setData((d) => {
          const cible = d.employes.find((e) => e.id === employeId && e.actif)
          if (!cible) {
            erreur = 'Employé introuvable.'
            return d
          }
          if (!employeACompteCaisse(cible.role)) {
            erreur = 'Cet employé n’a pas de compte caisse.'
            return d
          }
          if (estChefAgence && cible.agenceId !== employeConnecte.agenceId) {
            erreur = 'Vous ne pouvez ouvrir que les caisses de votre agence.'
            return d
          }
          if (ouvertureCaisseDuJour(d.ouverturesCaisse ?? [], cible.id, jour)) {
            erreur = `La journée du ${jour} est déjà ouverte.`
            return d
          }
          if (arretCaisseDuJour(d.arretsCaisse, cible.id, jour)) {
            erreur = `La journée du ${jour} est déjà clôturée.`
            return d
          }
          // Interdit d’ouvrir un nouveau jour tant qu’un jour précédent est en attente de clôture
          const enAttente = journeesOuvertesEnAttenteCloture(
            cible.id,
            d.ouverturesCaisse ?? [],
            d.arretsCaisse,
            jour,
          )
          if (enAttente.length > 0) {
            erreur = `Impossible d’ouvrir le ${jour} : la journée du ${enAttente[0]} est en attente de clôture.`
            return d
          }
          const retards = journeesCaisseEnRetard(
            cible.id,
            d.transactions,
            d.arretsCaisse,
            d.ouverturesCaisse ?? [],
            jour,
          )
          if (retards.length > 0 && jour !== retards[0]) {
            erreur =
              jour > retards[0]
                ? `Clôturez d’abord la journée du ${retards[0]} avant d’ouvrir le ${jour}.`
                : `Journée invalide : traitez d’abord le retard du ${retards[0]}.`
            return d
          }
          if (retards.length === 0 && jour !== aujourdHuiIso()) {
            erreur = 'Seule la journée en cours (ou une journée en retard) peut être ouverte.'
            return d
          }

          const date = maintenant()
          const ouverture: OuvertureCaisse = {
            id: uid(),
            employeId: cible.id,
            employeNom: cible.nomComplet,
            agenceId: cible.agenceId,
            journee: jour,
            soldeOuverture,
            dateOuverture: date,
            ouvertParId: employeConnecte.id,
            ouvertParNom: employeConnecte.nomComplet,
            note: note?.trim() || undefined,
          }

          let next: AppData = {
            ...d,
            ouverturesCaisse: [ouverture, ...(d.ouverturesCaisse ?? [])],
          }
          next = ouvrirCompteCaisseSiBesoin(next, cible.id)
          const compte = compteCaisseDe(next.comptesCaisse, cible.id)
          if (compte && compte.solde !== soldeOuverture) {
            const delta = soldeOuverture - compte.solde
            const mouvement: MouvementCompteCaisse = {
              id: uid(),
              compteCaisseId: compte.id,
              employeId: cible.id,
              type: 'ouverture_journee',
              montant: Math.abs(delta),
              sens: delta >= 0 ? 'credit' : 'debit',
              soldeApres: soldeOuverture,
              date,
              description: `Ouverture de caisse — solde saisi ${soldeOuverture} FCFA`,
              operateurId: employeConnecte.id,
              operateurNom: employeConnecte.nomComplet,
            }
            next = {
              ...next,
              comptesCaisse: next.comptesCaisse.map((c) =>
                c.id === compte.id ? { ...c, solde: soldeOuverture } : c,
              ),
              mouvementsCompteCaisse: [mouvement, ...next.mouvementsCompteCaisse],
            }
          }
          return next
        })
        return erreur
      },

      arreterCaisse(montantFermeture, note, journee, cibleEmployeId) {
        if (!employeConnecte) return 'Non connecté.'
        if (!estAdmin && !estChefAgence) {
          return 'Seul l’administrateur ou le chef d’agence peut effectuer un arrêt de caisse.'
        }
        if (montantFermeture < 0) return 'Montant de fermeture invalide.'
        const cibleId = cibleEmployeId
        if (!cibleId) return 'Caissier non précisé.'
        const jour = journee ?? aujourdHuiIso()
        let erreur: string | null = null
        setData((d) => {
          const cible = d.employes.find((e) => e.id === cibleId && e.actif)
          if (!cible) {
            erreur = 'Employé introuvable.'
            return d
          }
          if (estChefAgence && cible.agenceId !== employeConnecte.agenceId) {
            erreur = 'Vous ne pouvez arrêter que les caisses de votre agence.'
            return d
          }
          if (arretCaisseDuJour(d.arretsCaisse, cible.id, jour)) {
            erreur = `La caisse du ${jour} est déjà arrêtée.`
            return d
          }
          const ouverture = ouvertureCaisseDuJour(d.ouverturesCaisse ?? [], cible.id, jour)
          if (!ouverture) {
            erreur = `Ouvrez d’abord la journée du ${jour} (saisie du montant d’ouverture).`
            return d
          }
          const retards = journeesCaisseEnRetard(
            cible.id,
            d.transactions,
            d.arretsCaisse,
            d.ouverturesCaisse ?? [],
          )
          if (retards.length > 0 && jour !== retards[0]) {
            erreur =
              jour > retards[0]
                ? `Clôturez d’abord la journée du ${retards[0]} avant celle du ${jour}.`
                : `Journée invalide : le prochain arrêt à faire est celui du ${retards[0]}.`
            return d
          }
          if (retards.length === 0 && jour !== aujourdHuiIso()) {
            erreur = 'Seule la journée en cours (ou une journée en retard) peut être arrêtée.'
            return d
          }

          const sit = situationCaisse(
            cible.id,
            d.transactions,
            d.arretsCaisse,
            jour,
            d.comptesCaisse,
            d.mouvementsCompteCaisse,
            d.ouverturesCaisse ?? [],
          )
          const dates = sit.transactions.map((t) => t.date).sort()
          const maintenantIso = maintenant()
          const soldeOuverture = ouverture.soldeOuverture
          const soldeFermetureTheorique = sit.soldeFermetureTheorique
          const ecart = montantFermeture - soldeFermetureTheorique
          const arret: ArretCaisse = {
            id: uid(),
            employeId: cible.id,
            employeNom: cible.nomComplet,
            agenceId: cible.agenceId,
            journee: jour,
            dateCloture: maintenantIso,
            date: maintenantIso,
            debutPeriode: dates[0] ?? ouverture.dateOuverture,
            nombreOperations: sit.nombreOperations,
            totalEntrees: sit.totalEntrees,
            totalSorties: sit.totalSorties,
            soldeOuverture,
            soldeTheorique: soldeFermetureTheorique,
            montantCompte: montantFermeture,
            ecart,
            note,
            valideParId: employeConnecte.id,
            valideParNom: employeConnecte.nomComplet,
          }

          let next: AppData = { ...d, arretsCaisse: [arret, ...d.arretsCaisse] }
          next = ouvrirCompteCaisseSiBesoin(next, cible.id)
          const compte = compteCaisseDe(next.comptesCaisse, cible.id)
          if (compte) {
            let cumulManquant = compte.cumulManquant ?? 0
            let cumulSurplus = compte.cumulSurplus ?? 0
            if (ecart < 0) cumulManquant += Math.abs(ecart)
            if (ecart > 0) cumulSurplus += ecart

            let mouvements = next.mouvementsCompteCaisse
            let solde = compte.solde
            if (ecart !== 0 && compte.solde !== montantFermeture) {
              solde = montantFermeture
              mouvements = [
                {
                  id: uid(),
                  compteCaisseId: compte.id,
                  employeId: cible.id,
                  type: 'ajustement_arret',
                  montant: Math.abs(ecart),
                  sens: ecart > 0 ? 'credit' : 'debit',
                  soldeApres: solde,
                  date: maintenantIso,
                  description:
                    ecart > 0
                      ? `Ajustement de fermeture — surplus ${Math.abs(ecart)} FCFA`
                      : `Ajustement de fermeture — manquant ${Math.abs(ecart)} FCFA`,
                  operateurId: employeConnecte.id,
                  operateurNom: employeConnecte.nomComplet,
                },
                ...mouvements,
              ]
            }
            next = {
              ...next,
              comptesCaisse: next.comptesCaisse.map((c) =>
                c.id === compte.id
                  ? { ...c, solde, cumulManquant, cumulSurplus }
                  : c,
              ),
              mouvementsCompteCaisse: mouvements,
            }
          }
          return next
        })
        return erreur
      },

      regulariserCumulCompteCaisse(employeId, type, montant, motif) {
        if (!employeConnecte) return 'Non connecté.'
        if (!estAdmin) return 'Seul l’administrateur peut régulariser les cumuls de caisse.'
        if (montant <= 0) return 'Montant invalide.'
        if (!motif.trim()) return 'Le motif est obligatoire.'
        let erreur: string | null = null
        setData((d) => {
          const cible = d.employes.find((e) => e.id === employeId && e.actif)
          if (!cible) {
            erreur = 'Employé introuvable.'
            return d
          }
          const compte = compteCaisseDe(d.comptesCaisse, cible.id)
          if (!compte) {
            erreur = 'Compte caisse introuvable.'
            return d
          }
          const cumulAvant = type === 'manquant' ? compte.cumulManquant ?? 0 : compte.cumulSurplus ?? 0
          if (montant > cumulAvant) {
            erreur = `Le montant dépasse le cumul ${type} (${cumulAvant} FCFA).`
            return d
          }
          const cumulApres = cumulAvant - montant
          return {
            ...d,
            comptesCaisse: d.comptesCaisse.map((c) =>
              c.id === compte.id
                ? {
                    ...c,
                    cumulManquant: type === 'manquant' ? cumulApres : c.cumulManquant,
                    cumulSurplus: type === 'surplus' ? cumulApres : c.cumulSurplus,
                  }
                : c,
            ),
            ajustementsCompteCaisse: [
              {
                id: uid(),
                compteCaisseId: compte.id,
                employeId: cible.id,
                date: maintenant(),
                type,
                montant,
                motif: motif.trim(),
                adminId: employeConnecte.id,
                adminNom: employeConnecte.nomComplet,
                cumulAvant,
                cumulApres,
              },
              ...(d.ajustementsCompteCaisse ?? []),
            ],
          }
        })
        return erreur
      },

      reinitialiserDemo() {
        setData(genererDonneesDemo())
        setSessionUserId(null)
      },
    }
  }, [data, sessionUserId])

  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>
}

export function useStore(): StoreApi {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore doit être utilisé dans <StoreProvider>')
  return ctx
}
