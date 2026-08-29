import { useMemo, useState } from 'react'
import type { CompteComptable } from '../types'

export function RechercheCompte({
  comptes,
  exclus,
  compteNumero,
  onChoisir,
  placeholder = 'N° ou intitulé du compte…',
  viderApresChoix = false,
}: {
  comptes: CompteComptable[]
  exclus?: Set<string>
  compteNumero?: string
  onChoisir: (c: CompteComptable) => void
  placeholder?: string
  viderApresChoix?: boolean
}) {
  const [q, setQ] = useState('')
  const [ouvert, setOuvert] = useState(false)
  const exclusSet = exclus
  const sel = comptes.find((c) => c.numero === compteNumero)

  const matches = useMemo(() => {
    const n = q.trim().toLowerCase()
    if (n.length < 1) return []
    return comptes
      .filter((c) => !exclusSet?.has(c.numero) || c.numero === compteNumero)
      .filter((c) => c.numero.toLowerCase().includes(n) || c.intitule.toLowerCase().includes(n))
      .slice(0, 12)
  }, [q, comptes, exclusSet, compteNumero])

  const affiche = ouvert || q ? q : sel ? `${sel.numero} — ${sel.intitule}` : ''

  return (
    <div className="relative">
      <input
        className="input"
        placeholder={placeholder}
        value={affiche}
        onChange={(e) => {
          setQ(e.target.value)
          setOuvert(true)
        }}
        onFocus={() => {
          setQ('')
          setOuvert(true)
        }}
        onBlur={() => window.setTimeout(() => setOuvert(false), 180)}
      />
      {ouvert && matches.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {matches.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="flex w-full items-baseline gap-2 px-3 py-2 text-left text-sm hover:bg-brand-50"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChoisir(c)
                  setQ('')
                  setOuvert(false)
                  if (viderApresChoix) setQ('')
                }}
              >
                <span className="shrink-0 font-mono font-medium text-slate-900">{c.numero}</span>
                <span className="truncate text-slate-600">{c.intitule}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
