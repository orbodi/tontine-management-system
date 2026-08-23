import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type {
  Agence,
  AppData,
  Client,
  Droit,
  Employe,
  Role,
  TypeCarnet,
  TypeCompte,
  Zone,
} from './types'
import { apiFetch, ApiError, getToken, setToken } from './api/client'

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

const DATA_VIDE: AppData = {
  agences: [],
  zones: [],
  comptesZoneTontine: [],
  journeesCompteZone: [],
  ajustementsCompteZone: [],
  employes: [],
  clients: [],
  carnets: [],
  mises: [],
  comptes: [],
  mouvements: [],
  credits: [],
  remboursements: [],
  transactions: [],
  comptesCaisse: [],
  mouvementsCompteCaisse: [],
  ajustementsCompteCaisse: [],
  ouverturesCaisse: [],
  arretsCaisse: [],
  journalConnexions: [],
  compteursOrdreZone: {},
  compteurs: { client: 0, compte: 0, credit: 0, compteCaisse: 0 },
}

interface StoreApi {
  data: AppData
  chargement: boolean
  employeConnecte: Employe | null
  connexion: (identifiant: string, motDePasse: string) => Promise<boolean>
  deconnexion: () => Promise<void>
  estAdmin: boolean
  estChefAgence: boolean
  estCaissier: boolean
  aDroit: (droit: Droit) => boolean
  agenceFiltreOperations: string | null
  rafraichir: () => Promise<void>
  ajouterAgence: (a: Omit<Agence, 'id' | 'actif'>) => Promise<boolean>
  modifierAgence: (id: string, patch: Partial<Agence>) => Promise<void>
  basculerActifAgence: (id: string) => Promise<void>
  ajouterZone: (z: Omit<Zone, 'id' | 'actif'>) => Promise<string | null>
  modifierZone: (id: string, patch: Partial<Zone>) => Promise<string | null>
  basculerActifZone: (id: string) => Promise<void>
  saisirMontantReelZone: (
    zoneId: string,
    montantReel: number,
    dateIso?: string,
    note?: string,
  ) => Promise<string | null>
  cloturerJourneeZone: (zoneId: string, dateIso?: string) => Promise<string | null>
  ajusterCumulCompteZone: (
    zoneId: string,
    type: 'manquant' | 'surplus',
    montant: number,
    motif: string,
  ) => Promise<string | null>
  ajouterClient: (
    c: Omit<Client, 'id' | 'codeClient' | 'ordreZone' | 'agenceId' | 'dateInscription' | 'actif'>,
  ) => Promise<boolean>
  modifierClient: (id: string, patch: Partial<Client>) => Promise<string | null>
  basculerActifClient: (id: string) => Promise<void>
  ouvrirCarnet: (
    clientId: string,
    typeCarnet: TypeCarnet,
    mise: number,
    frequence: 'journaliere' | 'hebdomadaire',
  ) => Promise<{ id: string; numero: string } | { erreur: string }>
  encaisserCotisation: (carnetId: string, montant: number) => Promise<string | null>
  retraitCycle: (carnetId: string, cycle: number, nombreCarreaux: number) => Promise<string | null>
  basculerVerrouCarnet: (id: string) => Promise<void>
  basculerRetraitCarnetAdmin: (id: string) => Promise<string | null>
  ouvrirCompte: (
    clientId: string,
    type: TypeCompte,
  ) => Promise<{ id: string; numero: string } | { erreur: string }>
  deposerCompte: (compteId: string, montant: number, note?: string) => Promise<string | null>
  retirerCompte: (compteId: string, montant: number, note?: string) => Promise<string | null>
  basculerVerrouCompte: (id: string) => Promise<void>
  demanderCredit: (c: {
    clientId: string
    montant: number
    tauxInteret: number
    dureeMois: number
    motif?: string
  }) => Promise<void>
  approuverCredit: (creditId: string) => Promise<void>
  rejeterCredit: (creditId: string) => Promise<void>
  rembourserCredit: (creditId: string, montant: number) => Promise<void>
  ajouterEmploye: (e: Omit<Employe, 'id' | 'actif' | 'dateEmbauche'>) => Promise<boolean>
  modifierEmploye: (id: string, patch: Partial<Employe>) => Promise<void>
  supprimerEmploye: (id: string) => Promise<void>
  basculerActifEmploye: (id: string) => Promise<void>
  ouvrirJourneeCaisse: (
    employeId: string,
    soldeOuverture: number,
    note?: string,
    journee?: string,
  ) => Promise<string | null>
  regulariserCumulCompteCaisse: (
    employeId: string,
    type: 'manquant' | 'surplus',
    montant: number,
    motif: string,
  ) => Promise<string | null>
  arreterCaisse: (
    montantFermeture: number,
    note?: string,
    journee?: string,
    cibleEmployeId?: string,
  ) => Promise<string | null>
  alimenterCompteCaisse: (employeId: string, montant: number, note?: string) => Promise<string | null>
  exporterSauvegardeCsv: () => Promise<void>
  importerSauvegardeCsv: (fichier: File) => Promise<string | null>
}

const StoreContext = createContext<StoreApi | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(DATA_VIDE)
  const [employeConnecte, setEmployeConnecte] = useState<Employe | null>(null)
  const [chargement, setChargement] = useState(true)

  const appliquerData = useCallback((next: AppData) => {
    setData(next)
    setEmployeConnecte((prev) => {
      if (!prev) return prev
      return next.employes.find((e) => e.id === prev.id && e.actif) ?? null
    })
  }, [])

  const rafraichir = useCallback(async () => {
    const next = await apiFetch<AppData>('/api/data')
    appliquerData(next)
  }, [appliquerData])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const token = getToken()
      if (!token) {
        if (!cancelled) setChargement(false)
        return
      }
      try {
        const me = await apiFetch<Employe>('/api/auth/me')
        const next = await apiFetch<AppData>('/api/data')
        if (!cancelled) {
          setEmployeConnecte(me)
          setData(next)
        }
      } catch {
        setToken(null)
        if (!cancelled) {
          setEmployeConnecte(null)
          setData(DATA_VIDE)
        }
      } finally {
        if (!cancelled) setChargement(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const muter = useCallback(
    async (action: string, payload: Record<string, unknown> = {}) => {
      const res = await apiFetch<{
        ok?: boolean
        erreur?: string
        data?: AppData
        id?: string
        numero?: string
      }>(`/api/mutations/${action}`, { method: 'POST', json: { payload } })
      if (res.data) appliquerData(res.data)
      return res
    },
    [appliquerData],
  )

  const api = useMemo<StoreApi>(() => {
    const estAdmin = employeConnecte?.role === 'admin'
    const estChefAgence = employeConnecte?.role === 'chef_agence'
    const estCaissier = employeConnecte?.role === 'caissier'
    const aDroit = (droit: Droit) => {
      if (!employeConnecte) return false
      if (employeConnecte.role === 'admin') return true
      return employeConnecte.droits.includes(droit)
    }

    return {
      data,
      chargement,
      employeConnecte,
      estAdmin: !!estAdmin,
      estChefAgence: !!estChefAgence,
      estCaissier: !!estCaissier,
      aDroit,
      agenceFiltreOperations: estChefAgence && employeConnecte ? employeConnecte.agenceId : null,
      rafraichir,

      async connexion(identifiant, motDePasse) {
        try {
          const res = await apiFetch<{ access_token: string; employe: Employe }>('/api/auth/login', {
            method: 'POST',
            json: { identifiant, motDePasse },
          })
          setToken(res.access_token)
          setEmployeConnecte(res.employe)
          const next = await apiFetch<AppData>('/api/data')
          setData(next)
          return true
        } catch {
          return false
        }
      },

      async deconnexion() {
        try {
          await apiFetch('/api/auth/logout', { method: 'POST' })
        } catch {
          /* ignore */
        }
        setToken(null)
        setEmployeConnecte(null)
        setData(DATA_VIDE)
      },

      async ajouterAgence(a) {
        const res = await muter('ajouterAgence', a as unknown as Record<string, unknown>)
        return !res.erreur
      },
      async modifierAgence(id, patch) {
        await muter('modifierAgence', { id, patch })
      },
      async basculerActifAgence(id) {
        await muter('basculerActifAgence', { id })
      },
      async ajouterZone(z) {
        const res = await muter('ajouterZone', z as unknown as Record<string, unknown>)
        return res.erreur ?? null
      },
      async modifierZone(id, patch) {
        const res = await muter('modifierZone', { id, patch })
        return res.erreur ?? null
      },
      async basculerActifZone(id) {
        await muter('basculerActifZone', { id })
      },
      async saisirMontantReelZone(zoneId, montantReel, dateIso, note) {
        const res = await muter('saisirMontantReelZone', { zoneId, montantReel, dateIso, note })
        return res.erreur ?? null
      },
      async cloturerJourneeZone(zoneId, dateIso) {
        const res = await muter('cloturerJourneeZone', { zoneId, dateIso })
        return res.erreur ?? null
      },
      async ajusterCumulCompteZone(zoneId, type, montant, motif) {
        const res = await muter('ajusterCumulCompteZone', { zoneId, type, montant, motif })
        return res.erreur ?? null
      },
      async ajouterClient(c) {
        const res = await muter('ajouterClient', c as unknown as Record<string, unknown>)
        return !res.erreur
      },
      async modifierClient(id, patch) {
        const res = await muter('modifierClient', { id, patch })
        return res.erreur ?? null
      },
      async basculerActifClient(id) {
        await muter('basculerActifClient', { id })
      },
      async ouvrirCarnet(clientId, typeCarnet, mise, frequence) {
        const res = await muter('ouvrirCarnet', { clientId, typeCarnet, mise, frequence })
        if (res.erreur) return { erreur: res.erreur }
        if (res.id && res.numero) return { id: res.id, numero: res.numero }
        return { erreur: 'Ouverture impossible.' }
      },
      async encaisserCotisation(carnetId, montant) {
        const res = await muter('encaisserCotisation', { carnetId, montant })
        return res.erreur ?? null
      },
      async retraitCycle(carnetId, cycle, nombreCarreaux) {
        const res = await muter('retraitCycle', { carnetId, cycle, nombreCarreaux })
        return res.erreur ?? null
      },
      async basculerVerrouCarnet(id) {
        await muter('basculerVerrouCarnet', { id })
      },
      async basculerRetraitCarnetAdmin(id) {
        const res = await muter('basculerRetraitCarnetAdmin', { id })
        return res.erreur ?? null
      },
      async ouvrirCompte(clientId, type) {
        const res = await muter('ouvrirCompte', { clientId, type })
        if (res.erreur) return { erreur: res.erreur }
        if (res.id && res.numero) return { id: res.id, numero: res.numero }
        return { erreur: 'Ouverture impossible.' }
      },
      async deposerCompte(compteId, montant, note) {
        const res = await muter('deposerCompte', { compteId, montant, note })
        return res.erreur ?? null
      },
      async retirerCompte(compteId, montant, note) {
        const res = await muter('retirerCompte', { compteId, montant, note })
        return res.erreur ?? null
      },
      async basculerVerrouCompte(id) {
        await muter('basculerVerrouCompte', { id })
      },
      async demanderCredit(c) {
        await muter('demanderCredit', c)
      },
      async approuverCredit(creditId) {
        await muter('approuverCredit', { creditId })
      },
      async rejeterCredit(creditId) {
        await muter('rejeterCredit', { creditId })
      },
      async rembourserCredit(creditId, montant) {
        await muter('rembourserCredit', { creditId, montant })
      },
      async ajouterEmploye(e) {
        const res = await muter('ajouterEmploye', e as unknown as Record<string, unknown>)
        return !res.erreur
      },
      async modifierEmploye(id, patch) {
        await muter('modifierEmploye', { id, patch })
      },
      async supprimerEmploye(id) {
        await muter('supprimerEmploye', { id })
      },
      async basculerActifEmploye(id) {
        await muter('basculerActifEmploye', { id })
      },
      async ouvrirJourneeCaisse(employeId, soldeOuverture, note, journee) {
        const res = await muter('ouvrirJourneeCaisse', { employeId, soldeOuverture, note, journee })
        return res.erreur ?? null
      },
      async regulariserCumulCompteCaisse(employeId, type, montant, motif) {
        const res = await muter('regulariserCumulCompteCaisse', { employeId, type, montant, motif })
        return res.erreur ?? null
      },
      async arreterCaisse(montantFermeture, note, journee, cibleEmployeId) {
        const res = await muter('arreterCaisse', {
          montantFermeture,
          note,
          journee,
          cibleEmployeId,
        })
        return res.erreur ?? null
      },
      async alimenterCompteCaisse(employeId, montant, note) {
        const res = await muter('alimenterCompteCaisse', { employeId, montant, note })
        return res.erreur ?? null
      },
      async exporterSauvegardeCsv() {
        const token = getToken()
        const res = await fetch('/api/admin/export-csv', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        if (!res.ok) {
          let detail = `Export impossible (HTTP ${res.status}).`
          try {
            const body = await res.json()
            if (typeof body?.detail === 'string') detail = body.detail
          } catch {
            if (res.status === 404) {
              detail = 'Route introuvable : redémarrez l’API (lancer.bat ou fenêtre DON DE DIEU - API).'
            } else if (res.status === 401 || res.status === 403) {
              detail = 'Session insuffisante. Reconnectez-vous en administrateur.'
            }
          }
          throw new Error(detail)
        }
        const blob = await res.blob()
        const dispo = res.headers.get('Content-Disposition') ?? ''
        const match = /filename="?([^";]+)"?/i.exec(dispo)
        const nom = match?.[1] ?? `sauvegarde-don-de-dieu-${new Date().toISOString().slice(0, 10)}.zip`
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = nom
        a.click()
        URL.revokeObjectURL(url)
      },
      async importerSauvegardeCsv(fichier) {
        const token = getToken()
        const form = new FormData()
        form.append('fichier', fichier)
        const res = await fetch('/api/admin/import-csv', {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: form,
        })
        if (!res.ok) {
          try {
            const body = await res.json()
            return typeof body?.detail === 'string' ? body.detail : 'Import impossible.'
          } catch {
            return 'Import impossible.'
          }
        }
        const body = (await res.json()) as { data?: AppData }
        if (body.data) appliquerData(body.data)
        return null
      },
    }
  }, [data, chargement, employeConnecte, muter, rafraichir, appliquerData])

  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>
}

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore hors StoreProvider')
  return ctx
}

export { ApiError }
