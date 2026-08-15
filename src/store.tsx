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
  type Credit,
  type Droit,
  type Employe,
  type JournalConnexion,
  type MiseTontine,
  type MouvementCompte,
  type Remboursement,
  type Role,
  type Transaction,
  type TypeCarnet,
  type TypeCompte,
} from './types'
import { calculerMisesDepuisMontant, carreauxNets, eligibiliteRetraitCarnet } from './metier'
import { genererDonneesDemo } from './demo-data'
import { numeroCarnet, numeroClient, numeroCompteSolde, pad4, uid } from './utils'

const STORAGE_KEY = 'microfinance-data-v10'
const SESSION_KEY = 'microfinance-session-v10'

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
  // Clients
  ajouterClient: (
    c: Omit<Client, 'id' | 'codeClient' | 'dateInscription' | 'actif' | 'agenceId' | 'ordreAgence'>,
  ) => { codeClient: string; prenom: string; nom: string } | null
  modifierClient: (id: string, patch: Partial<Client>) => string | null
  basculerActifClient: (id: string) => void
  // Carnets
  ouvrirCarnet: (
    clientId: string,
    typeCarnet: TypeCarnet,
    mise: number,
    frequence: CarnetTontine['frequence'],
  ) => string | null
  encaisserCotisation: (carnetId: string, montant: number) => string | null
  retraitPartielCarnet: (carnetId: string, nombreCarreaux: number) => string | null
  cloturerCycle: (carnetId: string, nouvelleMise?: number) => string | null
  basculerVerrouCarnet: (id: string) => void
  // Comptes à solde
  ouvrirCompte: (clientId: string, type: TypeCompte) => string | null
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
  arreterCaisse: (montantCompte: number, note?: string) => void
  reinitialiserDemo: () => void
}

const StoreContext = createContext<StoreApi | null>(null)

function chargerDonnees(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as AppData
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

    const codeAgence = (d: AppData, agenceId: string) =>
      d.agences.find((a) => a.id === agenceId)?.code ?? '00'

    return {
      data,
      employeConnecte,
      estAdmin: !!estAdmin,
      estChefAgence: !!estChefAgence,
      estCaissier: !!estCaissier,
      agenceFiltreOperations: estChefAgence && employeConnecte ? employeConnecte.agenceId : null,

      aDroit(droit) {
        if (!employeConnecte) return false
        if (employeConnecte.role === 'admin') return true
        return employeConnecte.droits.includes(droit)
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

      // ---------- Clients ----------

      ajouterClient(c) {
        if (!employeConnecte) return null
        const agenceId = employeConnecte.agenceId
        let cree: { codeClient: string; prenom: string; nom: string } | null = null
        setData((d) => {
          const numero = d.compteurs.client + 1
          const ordre = (d.compteursOrdreAgence[agenceId] ?? 0) + 1
          const codeClient = numeroClient(numero)
          cree = { codeClient, prenom: c.prenom, nom: c.nom }
          return {
            ...d,
            compteurs: { ...d.compteurs, client: numero },
            compteursOrdreAgence: { ...d.compteursOrdreAgence, [agenceId]: ordre },
            clients: [
              ...d.clients,
              {
                ...c,
                id: uid(),
                codeClient,
                agenceId,
                ordreAgence: ordre,
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
        if (!employeConnecte) return 'Non connecté.'
        let erreur: string | null = null
        setData((d) => {
          const client = d.clients.find((c) => c.id === clientId)
          if (!client) return d
          if (d.carnets.some((k) => k.actif && k.clientId === clientId)) {
            erreur = 'Ce client a déjà un carnet actif.'
            return d
          }
          const agenceId = employeConnecte.agenceId
          const date = maintenant()
          const numero = numeroCarnet(codeAgence(d, agenceId), client.ordreAgence)
          return {
            ...d,
            carnets: [
              ...d.carnets,
              {
                id: uid(),
                clientId,
                numero,
                agenceId,
                typeCarnet,
                mise,
                frequence,
                misesParCycle: CARREAUX_PAR_CYCLE,
                cycleActuel: 1,
                dateOuverture: date,
                verrouille: false,
                actif: true,
              },
            ],
            transactions: [
              transaction({
                type: 'vente_carnet',
                clientId,
                montant: PRIX_CARNET,
                date,
                description: `Vente du carnet ${numero} — ${nomClient(d, clientId)} (cycle 1/12)`,
              }),
              ...d.transactions,
            ],
          }
        })
        return erreur
      },

      encaisserCotisation(carnetId, montant) {
        let erreur: string | null = null
        setData((d) => {
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
          const nombre = Math.min(calc.nombreMises, carnet.misesParCycle - payees)
          if (nombre <= 0) {
            erreur = 'Le carnet est déjà complet pour ce cycle.'
            return d
          }
          if (nombre !== calc.nombreMises) {
            erreur = `Seulement ${carnet.misesParCycle - payees} carreau(x) restant(s) sur ce cycle.`
            return d
          }
          const date = maintenant()
          const miseEntree: MiseTontine = {
            id: uid(),
            carnetId,
            cycle: carnet.cycleActuel,
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
                description: `Première cotisation (P.C) — ${nomClient(d, carnet.clientId)} (cycle ${carnet.cycleActuel})`,
              }),
            )
            if (nombre > 1) {
              nouvelles.push(
                transaction({
                  type: 'mise_tontine',
                  clientId: carnet.clientId,
                  montant: carnet.mise * (nombre - 1),
                  date,
                  description: `Cotisation ×${nombre - 1} — ${nomClient(d, carnet.clientId)} (cycle ${carnet.cycleActuel})`,
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
                description: `Cotisation ×${nombre} — ${nomClient(d, carnet.clientId)} (cycle ${carnet.cycleActuel})`,
              }),
            )
          }
          return {
            ...d,
            mises: [...d.mises, miseEntree],
            transactions: [...nouvelles, ...d.transactions],
          }
        })
        return erreur
      },

      retraitPartielCarnet(carnetId, nombreCarreaux) {
        if (nombreCarreaux <= 0) return 'Nombre de carreaux invalide.'
        let erreur: string | null = null
        setData((d) => {
          const carnet = d.carnets.find((c) => c.id === carnetId)
          if (!carnet || !carnet.actif) return d
          if (carnet.verrouille) {
            erreur = 'Ce carnet est verrouillé.'
            return d
          }
          const eligibilite = eligibiliteRetraitCarnet(carnet, d.mises)
          if (!eligibilite.autorise) {
            erreur = 'Retrait impossible : 6 mois de cotisations minimum requis.'
            return d
          }
          const payees = carreauxNets(carnet, d.mises)
          // On ne peut retirer que les carreaux au-delà de la P.C (1re mise)
          const disponibles = Math.max(0, payees - 1)
          if (nombreCarreaux > disponibles) {
            erreur = `Retrait partiel impossible : seulement ${disponibles} carreau(x) disponible(s) (hors P.C).`
            return d
          }
          const date = maintenant()
          const montant = carnet.mise * nombreCarreaux
          const retrait: MiseTontine = {
            id: uid(),
            carnetId,
            cycle: carnet.cycleActuel,
            nombreMises: -nombreCarreaux,
            montant: -montant,
            date,
          }
          return {
            ...d,
            mises: [...d.mises, retrait],
            transactions: [
              transaction({
                type: 'retrait_tontine',
                clientId: carnet.clientId,
                montant,
                date,
                description: `Retrait partiel ×${nombreCarreaux} — ${nomClient(d, carnet.clientId)} (carnet ${carnet.numero})`,
              }),
              ...d.transactions,
            ],
          }
        })
        return erreur
      },

      cloturerCycle(carnetId, nouvelleMise) {
        if (!employeConnecte) return 'Non connecté.'
        let erreur: string | null = null
        setData((d) => {
          const carnet = d.carnets.find((c) => c.id === carnetId)
          if (!carnet || !carnet.actif) return d
          if (carnet.verrouille) {
            erreur = 'Ce carnet est verrouillé.'
            return d
          }
          const eligibilite = eligibiliteRetraitCarnet(carnet, d.mises)
          if (!eligibilite.autorise) {
            erreur = 'Retrait impossible : 6 mois de cotisations minimum requis.'
            return d
          }
          const payees = carreauxNets(carnet, d.mises)
          if (payees <= 0) {
            erreur = 'Aucune cotisation sur ce cycle.'
            return d
          }
          const date = maintenant()
          const remise = carnet.mise * Math.max(0, payees - 1)
          const nouvelles: Transaction[] = []
          if (remise > 0) {
            nouvelles.push(
              transaction({
                type: 'retrait_tontine',
                clientId: carnet.clientId,
                montant: remise,
                date,
                description: `Clôture cycle ${carnet.cycleActuel}/12 — remise de ${nomClient(d, carnet.clientId)} (${payees} carreaux − 1 P.C)`,
              }),
            )
          }

          const finDes12 = carnet.cycleActuel >= CYCLES_PAR_CARNET
          const agencePaiement = employeConnecte.agenceId
          const client = d.clients.find((c) => c.id === carnet.clientId)
          const miseSuivante =
            nouvelleMise && nouvelleMise > 0 ? nouvelleMise : carnet.mise

          if (finDes12) {
            // Nouveau carnet de 12 cycles : vente 300 FCFA ; n° hérite de l'agence de paiement
            const nouveauNumero = client
              ? numeroCarnet(codeAgence(d, agencePaiement), client.ordreAgence)
              : carnet.numero
            nouvelles.push(
              transaction({
                type: 'vente_carnet',
                clientId: carnet.clientId,
                montant: PRIX_CARNET,
                date,
                description: `Renouvellement carnet ${nouveauNumero} — ${nomClient(d, carnet.clientId)} (nouveau cycle 1/12)`,
              }),
            )
            return {
              ...d,
              carnets: d.carnets.map((c) =>
                c.id === carnetId
                  ? {
                      ...c,
                      cycleActuel: 1,
                      mise: miseSuivante,
                      agenceId: agencePaiement,
                      numero: nouveauNumero,
                      dateOuverture: date,
                    }
                  : c,
              ),
              transactions: [...nouvelles, ...d.transactions],
            }
          }

          // Cycle suivant (2..12) : pas de nouvelle vente ; mise modifiable ici
          return {
            ...d,
            carnets: d.carnets.map((c) =>
              c.id === carnetId
                ? { ...c, cycleActuel: c.cycleActuel + 1, mise: miseSuivante }
                : c,
            ),
            transactions: [...nouvelles, ...d.transactions],
          }
        })
        return erreur
      },

      basculerVerrouCarnet(id) {
        setData((d) => ({
          ...d,
          carnets: d.carnets.map((c) => (c.id === id ? { ...c, verrouille: !c.verrouille } : c)),
        }))
      },

      // ---------- Comptes à solde ----------

      ouvrirCompte(clientId, type) {
        if (estCaissier) return 'Un caissier ne peut pas ouvrir un compte courant ou épargne.'
        let erreur: string | null = null
        setData((d) => {
          if (d.comptes.some((c) => c.clientId === clientId && c.type === type)) {
            erreur = 'Ce client a déjà ce type de compte.'
            return d
          }
          const numero = d.compteurs.compte + 1
          return {
            ...d,
            compteurs: { ...d.compteurs, compte: numero },
            comptes: [
              ...d.comptes,
              {
                id: uid(),
                clientId,
                type,
                numero: numeroCompteSolde(numero),
                solde: 0,
                dateOuverture: maintenant(),
                verrouille: false,
              },
            ],
          }
        })
        return erreur
      },

      deposerCompte(compteId, montant, note) {
        if (montant <= 0) return 'Montant invalide.'
        let erreur: string | null = null
        setData((d) => {
          const compte = d.comptes.find((c) => c.id === compteId)
          if (!compte) return d
          if (compte.verrouille) {
            erreur = 'Ce compte est verrouillé.'
            return d
          }
          const date = maintenant()
          const mouvement: MouvementCompte = { id: uid(), compteId, type: 'depot', montant, date, note }
          return {
            ...d,
            comptes: d.comptes.map((c) => (c.id === compteId ? { ...c, solde: c.solde + montant } : c)),
            mouvements: [...d.mouvements, mouvement],
            transactions: [
              transaction({
                type: 'depot_compte',
                clientId: compte.clientId,
                montant,
                date,
                description: `Dépôt ${compte.numero} — ${nomClient(d, compte.clientId)}${note ? ` (${note})` : ''}`,
              }),
              ...d.transactions,
            ],
          }
        })
        return erreur
      },

      retirerCompte(compteId, montant, note) {
        if (montant <= 0) return 'Montant invalide.'
        let erreur: string | null = null
        setData((d) => {
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
          const date = maintenant()
          const mouvement: MouvementCompte = { id: uid(), compteId, type: 'retrait', montant, date, note }
          return {
            ...d,
            comptes: d.comptes.map((c) => (c.id === compteId ? { ...c, solde: c.solde - montant } : c)),
            mouvements: [...d.mouvements, mouvement],
            transactions: [
              transaction({
                type: 'retrait_compte',
                clientId: compte.clientId,
                montant,
                date,
                description: `Retrait ${compte.numero} — ${nomClient(d, compte.clientId)}${note ? ` (${note})` : ''}`,
              }),
              ...d.transactions,
            ],
          }
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
          const date = maintenant()
          return {
            ...d,
            credits: d.credits.map((c) =>
              c.id === creditId ? { ...c, statut: 'en_cours' as const, dateOctroi: date } : c,
            ),
            transactions: [
              transaction({
                type: 'octroi_credit',
                clientId: credit.clientId,
                montant: credit.montant,
                date,
                description: `Octroi crédit ${credit.numero} — ${nomClient(d, credit.clientId)}`,
              }),
              ...d.transactions,
            ],
          }
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
          return {
            ...d,
            remboursements: [...d.remboursements, remboursement],
            credits: d.credits.map((c) =>
              c.id === creditId && soldeApres <= 0.5 ? { ...c, statut: 'rembourse' as const } : c,
            ),
            transactions: [
              transaction({
                type: 'remboursement_credit',
                clientId: credit.clientId,
                montant,
                date,
                description: `Remboursement ${credit.numero} — ${nomClient(d, credit.clientId)}`,
              }),
              ...d.transactions,
            ],
          }
        })
      },

      // ---------- Employés ----------

      ajouterEmploye(e) {
        if (data.employes.some((x) => x.identifiant === e.identifiant)) return false
        setData((d) => ({
          ...d,
          employes: [...d.employes, { ...e, id: uid(), actif: true, dateEmbauche: maintenant() }],
        }))
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

      arreterCaisse(montantCompte, note) {
        if (!employeConnecte) return
        setData((d) => {
          const dernierArret =
            d.arretsCaisse
              .filter((a) => a.employeId === employeConnecte.id)
              .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null
          const periode = d.transactions.filter(
            (t) =>
              t.operateurId === employeConnecte.id && (!dernierArret || t.date > dernierArret.date),
          )
          let totalEntrees = 0
          let totalSorties = 0
          periode.forEach((t) => {
            if (t.type === 'retrait_tontine' || t.type === 'retrait_compte' || t.type === 'octroi_credit') {
              totalSorties += t.montant
            } else {
              totalEntrees += t.montant
            }
          })
          const soldeTheorique = totalEntrees - totalSorties
          const dates = periode.map((t) => t.date).sort()
          const arret: ArretCaisse = {
            id: uid(),
            employeId: employeConnecte.id,
            employeNom: employeConnecte.nomComplet,
            agenceId: employeConnecte.agenceId,
            date: maintenant(),
            debutPeriode: dernierArret?.date ?? dates[0] ?? maintenant(),
            nombreOperations: periode.length,
            totalEntrees,
            totalSorties,
            soldeTheorique,
            montantCompte,
            ecart: montantCompte - soldeTheorique,
            note,
          }
          return { ...d, arretsCaisse: [arret, ...d.arretsCaisse] }
        })
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
