import { useState, type ReactNode } from 'react'
import { Check, Copy, MessageCircle, MessageSquare, X } from 'lucide-react'
import type { StatutCredit } from '../types'
import { initiales, telPourWhatsApp } from '../utils'

export function EnTetePage({
  titre,
  sousTitre,
  action,
}: {
  titre: string
  sousTitre?: string
  action?: ReactNode
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{titre}</h1>
        {sousTitre && <p className="mt-1 text-sm text-slate-500">{sousTitre}</p>}
      </div>
      {action && <div className="print:hidden">{action}</div>}
    </div>
  )
}

export function Modale({
  titre,
  ouverte,
  onFermer,
  children,
  large,
  xl,
}: {
  titre: string
  ouverte: boolean
  onFermer: () => void
  children: ReactNode
  large?: boolean
  xl?: boolean
}) {
  if (!ouverte) return null
  const largeur = xl ? 'max-w-4xl' : large ? 'max-w-2xl' : 'max-w-md'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onFermer} />
      <div
        className={`relative flex max-h-[90vh] w-full flex-col ${largeur} overflow-hidden rounded-2xl bg-white shadow-xl`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-lg font-bold text-slate-900">{titre}</h2>
          <button
            onClick={onFermer}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            aria-label="Fermer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  )
}

const couleursAvatar = [
  'bg-emerald-100 text-emerald-700',
  'bg-sky-100 text-sky-700',
  'bg-violet-100 text-violet-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-teal-100 text-teal-700',
]

export function Avatar({ nom, prenom, taille = 'md' }: { nom: string; prenom: string; taille?: 'md' | 'lg' }) {
  const idx = (nom.charCodeAt(0) + (prenom.charCodeAt(0) || 0)) % couleursAvatar.length
  const classes = taille === 'lg' ? 'h-12 w-12 text-base' : 'h-9 w-9 text-xs'
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full font-bold ${classes} ${couleursAvatar[idx]}`}
    >
      {initiales(nom, prenom)}
    </div>
  )
}

export function EtatVide({ titre, description }: { titre: string; description?: string }) {
  return (
    <div className="card py-12 text-center">
      <p className="font-semibold text-slate-700">{titre}</p>
      {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
    </div>
  )
}

export const STYLES_STATUT_CREDIT: Record<StatutCredit, { label: string; classe: string }> = {
  en_attente: { label: 'En attente', classe: 'bg-amber-100 text-amber-700' },
  en_cours: { label: 'En cours', classe: 'bg-sky-100 text-sky-700' },
  rembourse: { label: 'Remboursé', classe: 'bg-emerald-100 text-emerald-700' },
  en_retard: { label: 'En retard', classe: 'bg-rose-100 text-rose-700' },
  rejete: { label: 'Rejeté', classe: 'bg-slate-200 text-slate-600' },
}

export function BadgeStatutCredit({ statut }: { statut: StatutCredit }) {
  const s = STYLES_STATUT_CREDIT[statut]
  return <span className={`badge ${s.classe}`}>{s.label}</span>
}

/** Boutons d'envoi d'un message pré-rempli : SMS, WhatsApp ou copie. */
export function BoutonsMessage({ telephone, message }: { telephone: string; message: string }) {
  const [copie, setCopie] = useState(false)

  const copier = async () => {
    try {
      await navigator.clipboard.writeText(message)
      setCopie(true)
      setTimeout(() => setCopie(false), 2000)
    } catch {
      // presse-papiers indisponible : rien à faire
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <a
        className="btn-secondary !py-1.5 text-xs"
        href={`sms:${telephone.replace(/\s/g, '')}?body=${encodeURIComponent(message)}`}
      >
        <MessageSquare className="h-3.5 w-3.5" />
        SMS
      </a>
      <a
        className="btn-secondary !py-1.5 text-xs"
        href={`https://wa.me/${telPourWhatsApp(telephone)}?text=${encodeURIComponent(message)}`}
        target="_blank"
        rel="noreferrer"
      >
        <MessageCircle className="h-3.5 w-3.5" />
        WhatsApp
      </a>
      <button className="btn-secondary !py-1.5 text-xs" onClick={copier}>
        {copie ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
        {copie ? 'Copié !' : 'Copier'}
      </button>
    </div>
  )
}
