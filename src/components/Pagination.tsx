import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export const TAILLE_PAGE = 50

export interface PaginationEtat<T> {
  page: number
  nbPages: number
  total: number
  debut: number
  fin: number
  elements: T[]
  setPage: (page: number) => void
}

/**
 * Découpe une liste en pages (50 par défaut). Revient à la page 1 quand `cleReset` change
 * (recherche, filtre…), mais pas quand les données sont simplement rafraîchies après une opération.
 */
export function usePagination<T>(items: T[], cleReset: string, taille: number = TAILLE_PAGE): PaginationEtat<T> {
  const [page, setPage] = useState(1)
  useEffect(() => setPage(1), [cleReset])
  const nbPages = Math.max(1, Math.ceil(items.length / taille))
  const pageCourante = Math.min(page, nbPages)
  const debut = (pageCourante - 1) * taille
  return {
    page: pageCourante,
    nbPages,
    total: items.length,
    debut,
    fin: Math.min(debut + taille, items.length),
    elements: items.slice(debut, debut + taille),
    setPage,
  }
}

/** « 51–100 sur 400 carnets » + Précédent / Suivant (masqué s'il n'y a qu'une page). */
export function Pagination<T>({ pagination, libelle }: { pagination: PaginationEtat<T>; libelle: string }) {
  const { page, nbPages, total, debut, fin, setPage } = pagination
  if (nbPages <= 1) return null
  const aller = (p: number) => {
    setPage(p)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
      <span>
        {debut + 1}–{fin} sur {total} {libelle}
      </span>
      <div className="flex items-center gap-2">
        <button type="button" className="btn-secondary !px-3 !py-1.5 text-xs" disabled={page <= 1} onClick={() => aller(page - 1)}>
          <ChevronLeft className="h-4 w-4" />
          Précédent
        </button>
        <span className="text-xs text-slate-500">
          Page {page} / {nbPages}
        </span>
        <button type="button" className="btn-secondary !px-3 !py-1.5 text-xs" disabled={page >= nbPages} onClick={() => aller(page + 1)}>
          Suivant
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

/** Regroupe une liste par clé, une seule fois (évite de reparcourir toute la liste pour chaque ligne affichée). */
export function grouperPar<T>(items: T[], cle: (item: T) => string | null | undefined): Map<string, T[]> {
  const groupes = new Map<string, T[]>()
  for (const item of items) {
    const k = cle(item)
    if (!k) continue
    const liste = groupes.get(k)
    if (liste) liste.push(item)
    else groupes.set(k, [item])
  }
  return groupes
}
