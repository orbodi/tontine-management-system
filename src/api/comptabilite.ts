import { apiFetch } from './client'
import type {
  BilanInitialLigne,
  CompteComptable,
  CompteGrandLivre,
  EcritureComptable,
  ExerciceComptable,
  JournalComptable,
  LigneBalance,
} from '../types'

export interface ComptaOverview {
  exercices: ExerciceComptable[]
  exerciceOuvert: ExerciceComptable | null
  nbComptes: number
  nbJournaux: number
}

export interface BilanResponse {
  exercice: ExerciceComptable
  lignes: BilanInitialLigne[]
  totalActif: number
  totalPassif: number
  equilibre: boolean
  pieceOuverture?: string | null
}

export const comptaApi = {
  overview: () => apiFetch<ComptaOverview>('/api/comptabilite/overview'),
  plan: (params?: { q?: string; classe?: number; actifs_seulement?: boolean }) => {
    const sp = new URLSearchParams()
    if (params?.q) sp.set('q', params.q)
    if (params?.classe != null) sp.set('classe', String(params.classe))
    if (params?.actifs_seulement) sp.set('actifs_seulement', 'true')
    const qs = sp.toString()
    return apiFetch<CompteComptable[]>(`/api/comptabilite/plan${qs ? `?${qs}` : ''}`)
  },
  basculerCompte: (id: string) =>
    apiFetch<{ ok: boolean; compte: CompteComptable }>(`/api/comptabilite/plan/${id}/basculer-actif`, {
      method: 'POST',
    }),
  journaux: () => apiFetch<JournalComptable[]>('/api/comptabilite/journaux'),
  creerJournal: (body: { code: string; libelle: string }) =>
    apiFetch<{ ok: boolean; journal: JournalComptable }>('/api/comptabilite/journaux', {
      method: 'POST',
      json: body,
    }),
  ouvrirExercice: (annee: number) =>
    apiFetch<{ ok: boolean; exercice: ExerciceComptable }>('/api/comptabilite/exercices', {
      method: 'POST',
      json: { annee },
    }),
  cloturerExercice: (id: string, genererAnouveaux = true) =>
    apiFetch<{ ok: boolean }>(`/api/comptabilite/exercices/${id}/cloturer`, {
      method: 'POST',
      json: { genererAnouveaux },
    }),
  getBilan: (exerciceId: string) => apiFetch<BilanResponse>(`/api/comptabilite/bilan/${exerciceId}`),
  saveBilan: (exerciceId: string, lignes: { compteNumero: string; sens: string; montant: number }[]) =>
    apiFetch<BilanResponse>(`/api/comptabilite/bilan/${exerciceId}`, {
      method: 'PUT',
      json: { lignes },
    }),
  validerBilan: (exerciceId: string) =>
    apiFetch<BilanResponse & { ok: boolean }>(`/api/comptabilite/bilan/${exerciceId}/valider`, {
      method: 'POST',
    }),
  ecritures: (params?: {
    exercice_id?: string
    journal_code?: string
    date_debut?: string
    date_fin?: string
  }) => {
    const sp = new URLSearchParams()
    if (params?.exercice_id) sp.set('exercice_id', params.exercice_id)
    if (params?.journal_code) sp.set('journal_code', params.journal_code)
    if (params?.date_debut) sp.set('date_debut', params.date_debut)
    if (params?.date_fin) sp.set('date_fin', params.date_fin)
    const qs = sp.toString()
    return apiFetch<EcritureComptable[]>(`/api/comptabilite/ecritures${qs ? `?${qs}` : ''}`)
  },
  creerEcriture: (body: {
    journalCode: string
    date: string
    libelle: string
    lignes: { compteNumero: string; debit: number; credit: number; libelle?: string }[]
    exerciceId?: string
  }) =>
    apiFetch<{ ok: boolean; ecriture: EcritureComptable }>('/api/comptabilite/ecritures', {
      method: 'POST',
      json: body,
    }),
  grandLivre: (params?: {
    exercice_id?: string
    compte_numero?: string
    date_debut?: string
    date_fin?: string
  }) => {
    const sp = new URLSearchParams()
    if (params?.exercice_id) sp.set('exercice_id', params.exercice_id)
    if (params?.compte_numero) sp.set('compte_numero', params.compte_numero)
    if (params?.date_debut) sp.set('date_debut', params.date_debut)
    if (params?.date_fin) sp.set('date_fin', params.date_fin)
    const qs = sp.toString()
    return apiFetch<CompteGrandLivre[]>(`/api/comptabilite/grand-livre${qs ? `?${qs}` : ''}`)
  },
  balance: (params?: { exercice_id?: string; date_debut?: string; date_fin?: string }) => {
    const sp = new URLSearchParams()
    if (params?.exercice_id) sp.set('exercice_id', params.exercice_id)
    if (params?.date_debut) sp.set('date_debut', params.date_debut)
    if (params?.date_fin) sp.set('date_fin', params.date_fin)
    const qs = sp.toString()
    return apiFetch<LigneBalance[]>(`/api/comptabilite/balance${qs ? `?${qs}` : ''}`)
  },
}
