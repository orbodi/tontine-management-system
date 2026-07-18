import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type {
  AppData,
  CarnetTontine,
  Client,
  Credit,
  MiseTontine,
  MouvementEpargne,
  Remboursement,
  Role,
  Transaction,
  Utilisateur,
} from './types'
import { genererDonneesDemo } from './demo-data'
import { pad4, uid } from './utils'

const STORAGE_KEY = 'microfinance-data-v2'
const SESSION_KEY = 'microfinance-session-v2'

export const LIBELLES_ROLE: Record<Role, string> = {
  admin: 'Administrateur',
  chef_agence: "Chef d'agence",
  caissier: 'Caissier',
}

interface StoreApi {
  data: AppData
  // Session
  utilisateurConnecte: Utilisateur | null
  connexion: (identifiant: string, motDePasse: string) => boolean
  deconnexion: () => void
  peutApprouverCredits: boolean
  estAdmin: boolean
  // Clients
  ajouterClient: (c: Omit<Client, 'id' | 'codeClient' | 'dateInscription' | 'actif'>) => void
  modifierClient: (id: string, patch: Partial<Client>) => void
  basculerActifClient: (id: string) => void
  // Tontine individuelle
  ouvrirCarnet: (clientId: string, mise: number, frequence: CarnetTontine['frequence'], misesParCycle: number) => void
  encaisserMises: (carnetId: string, nombreMises: number) => void
  cloturerCycle: (carnetId: string) => void
  // Épargne
  ouvrirCompte: (clientId: string) => void
  deposerEpargne: (compteId: string, montant: number, note?: string) => void
  retirerEpargne: (compteId: string, montant: number, note?: string) => boolean
  // Crédits
  demanderCredit: (c: { clientId: string; montant: number; tauxInteret: number; dureeMois: number; motif?: string }) => void
  approuverCredit: (creditId: string) => void
  rejeterCredit: (creditId: string) => void
  rembourserCredit: (creditId: string, montant: number) => void
  // Utilisateurs (admin)
  ajouterUtilisateur: (u: Omit<Utilisateur, 'id' | 'actif'>) => boolean
  modifierUtilisateur: (id: string, patch: Partial<Utilisateur>) => void
  basculerActifUtilisateur: (id: string) => void
  // Divers
  reinitialiserDemo: () => void
}

const StoreContext = createContext<StoreApi | null>(null)

function chargerDonnees(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as AppData
  } catch {
    // données corrompues : on repart de la démo
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
    const utilisateurConnecte =
      data.utilisateurs.find((u) => u.id === sessionUserId && u.actif) ?? null
    const nomOperateur = utilisateurConnecte?.nomComplet ?? 'Inconnu'

    const transaction = (t: Omit<Transaction, 'id' | 'operateur'>): Transaction => ({
      ...t,
      id: uid(),
      operateur: nomOperateur,
    })

    const nomClient = (d: AppData, clientId: string) => {
      const c = d.clients.find((x) => x.id === clientId)
      return c ? `${c.prenom} ${c.nom}` : 'Inconnu'
    }

    return {
      data,
      utilisateurConnecte,
      peutApprouverCredits:
        utilisateurConnecte?.role === 'admin' || utilisateurConnecte?.role === 'chef_agence',
      estAdmin: utilisateurConnecte?.role === 'admin',

      connexion(identifiant, motDePasse) {
        const u = data.utilisateurs.find(
          (x) => x.identifiant === identifiant.trim() && x.motDePasse === motDePasse && x.actif,
        )
        if (!u) return false
        setSessionUserId(u.id)
        return true
      },

      deconnexion() {
        setSessionUserId(null)
      },

      ajouterClient(c) {
        setData((d) => {
          const numero = d.compteurs.client + 1
          return {
            ...d,
            compteurs: { ...d.compteurs, client: numero },
            clients: [
              ...d.clients,
              { ...c, id: uid(), codeClient: `CL-${pad4(numero)}`, dateInscription: maintenant(), actif: true },
            ],
          }
        })
      },

      modifierClient(id, patch) {
        setData((d) => ({
          ...d,
          clients: d.clients.map((c) => (c.id === id ? { ...c, ...patch } : c)),
        }))
      },

      basculerActifClient(id) {
        setData((d) => ({
          ...d,
          clients: d.clients.map((c) => (c.id === id ? { ...c, actif: !c.actif } : c)),
        }))
      },

      ouvrirCarnet(clientId, mise, frequence, misesParCycle) {
        setData((d) => ({
          ...d,
          carnets: [
            ...d.carnets,
            {
              id: uid(),
              clientId,
              mise,
              frequence,
              misesParCycle,
              cycleActuel: 1,
              dateOuverture: maintenant(),
              actif: true,
            },
          ],
        }))
      },

      encaisserMises(carnetId, nombreMises) {
        if (nombreMises <= 0) return
        setData((d) => {
          const carnet = d.carnets.find((c) => c.id === carnetId)
          if (!carnet) return d
          const misesPayees = d.mises
            .filter((m) => m.carnetId === carnetId && m.cycle === carnet.cycleActuel)
            .reduce((s, m) => s + m.nombreMises, 0)
          const nombre = Math.min(nombreMises, carnet.misesParCycle - misesPayees)
          if (nombre <= 0) return d
          const date = maintenant()
          const miseEntree: MiseTontine = {
            id: uid(),
            carnetId,
            cycle: carnet.cycleActuel,
            nombreMises: nombre,
            montant: carnet.mise * nombre,
            date,
          }
          return {
            ...d,
            mises: [...d.mises, miseEntree],
            transactions: [
              transaction({
                type: 'mise_tontine',
                clientId: carnet.clientId,
                montant: miseEntree.montant,
                date,
                description: `Mise tontine ×${nombre} — ${nomClient(d, carnet.clientId)} (cycle ${carnet.cycleActuel})`,
              }),
              ...d.transactions,
            ],
          }
        })
      },

      cloturerCycle(carnetId) {
        setData((d) => {
          const carnet = d.carnets.find((c) => c.id === carnetId)
          if (!carnet) return d
          const misesPayees = d.mises
            .filter((m) => m.carnetId === carnetId && m.cycle === carnet.cycleActuel)
            .reduce((s, m) => s + m.nombreMises, 0)
          if (misesPayees === 0) return d
          const date = maintenant()
          const commission = carnet.mise // une mise de commission
          const remise = carnet.mise * misesPayees - commission
          return {
            ...d,
            carnets: d.carnets.map((c) =>
              c.id === carnetId ? { ...c, cycleActuel: c.cycleActuel + 1 } : c,
            ),
            transactions: [
              transaction({
                type: 'retrait_tontine',
                clientId: carnet.clientId,
                montant: remise,
                date,
                description: `Clôture cycle ${carnet.cycleActuel} — remise de ${nomClient(d, carnet.clientId)} (${misesPayees} mises − 1 de commission)`,
              }),
              transaction({
                type: 'commission_tontine',
                clientId: carnet.clientId,
                montant: commission,
                date,
                description: `Commission tontine cycle ${carnet.cycleActuel} — ${nomClient(d, carnet.clientId)}`,
              }),
              ...d.transactions,
            ],
          }
        })
      },

      ouvrirCompte(clientId) {
        setData((d) => {
          if (d.comptes.some((c) => c.clientId === clientId)) return d
          const numero = d.compteurs.compte + 1
          return {
            ...d,
            compteurs: { ...d.compteurs, compte: numero },
            comptes: [
              ...d.comptes,
              { id: uid(), clientId, numero: `EP-${pad4(numero)}`, solde: 0, dateOuverture: maintenant() },
            ],
          }
        })
      },

      deposerEpargne(compteId, montant, note) {
        if (montant <= 0) return
        setData((d) => {
          const compte = d.comptes.find((c) => c.id === compteId)
          if (!compte) return d
          const date = maintenant()
          const mouvement: MouvementEpargne = { id: uid(), compteId, type: 'depot', montant, date, note }
          return {
            ...d,
            comptes: d.comptes.map((c) => (c.id === compteId ? { ...c, solde: c.solde + montant } : c)),
            mouvements: [...d.mouvements, mouvement],
            transactions: [
              transaction({
                type: 'depot_epargne',
                clientId: compte.clientId,
                montant,
                date,
                description: `Dépôt épargne ${compte.numero} — ${nomClient(d, compte.clientId)}${note ? ` (${note})` : ''}`,
              }),
              ...d.transactions,
            ],
          }
        })
      },

      retirerEpargne(compteId, montant, note) {
        let ok = false
        setData((d) => {
          const compte = d.comptes.find((c) => c.id === compteId)
          if (!compte || montant <= 0 || compte.solde < montant) return d
          ok = true
          const date = maintenant()
          const mouvement: MouvementEpargne = { id: uid(), compteId, type: 'retrait', montant, date, note }
          return {
            ...d,
            comptes: d.comptes.map((c) => (c.id === compteId ? { ...c, solde: c.solde - montant } : c)),
            mouvements: [...d.mouvements, mouvement],
            transactions: [
              transaction({
                type: 'retrait_epargne',
                clientId: compte.clientId,
                montant,
                date,
                description: `Retrait épargne ${compte.numero} — ${nomClient(d, compte.clientId)}${note ? ` (${note})` : ''}`,
              }),
              ...d.transactions,
            ],
          }
        })
        return ok
      },

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
                description: `Octroi crédit ${credit.numero} — ${nomClient(d, credit.clientId)}${credit.motif ? ` (${credit.motif})` : ''}`,
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

      ajouterUtilisateur(u) {
        if (data.utilisateurs.some((x) => x.identifiant === u.identifiant)) return false
        setData((d) => ({
          ...d,
          utilisateurs: [...d.utilisateurs, { ...u, id: uid(), actif: true }],
        }))
        return true
      },

      modifierUtilisateur(id, patch) {
        setData((d) => ({
          ...d,
          utilisateurs: d.utilisateurs.map((u) => (u.id === id ? { ...u, ...patch } : u)),
        }))
      },

      basculerActifUtilisateur(id) {
        setData((d) => ({
          ...d,
          utilisateurs: d.utilisateurs.map((u) => (u.id === id ? { ...u, actif: !u.actif } : u)),
        }))
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
