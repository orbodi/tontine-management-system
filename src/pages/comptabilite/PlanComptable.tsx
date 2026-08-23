import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { comptaApi } from '../../api/comptabilite'
import { EnTetePage, EtatVide } from '../../components/ui'
import type { CompteComptable } from '../../types'
import { useStore } from '../../store'
import { useConfirmation } from '../../components/Confirmation'

export default function PlanComptablePage() {
  const { estAdmin, aDroit } = useStore()
  const { alerter } = useConfirmation()
  const [comptes, setComptes] = useState<CompteComptable[]>([])
  const [q, setQ] = useState('')
  const [classe, setClasse] = useState<number | ''>('')
  const peutEcrire = estAdmin || aDroit('gerer_comptabilite')

  const charger = async () => {
    try {
      setComptes(
        await comptaApi.plan({
          q: q || undefined,
          classe: classe === '' ? undefined : classe,
        }),
      )
    } catch (e) {
      await alerter('Erreur', e instanceof Error ? e.message : 'Chargement impossible')
    }
  }

  useEffect(() => {
    void charger()
  }, [classe])

  const basculer = async (id: string) => {
    try {
      await comptaApi.basculerCompte(id)
      await charger()
    } catch (e) {
      await alerter('Impossible', e instanceof Error ? e.message : 'Erreur')
    }
  }

  return (
    <div>
      <Link to="/comptabilite" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700">
        <ArrowLeft className="h-4 w-4" /> Comptabilité
      </Link>
      <EnTetePage titre="Plan comptable" sousTitre="SYSCOHADA — comptes de l’entreprise" />

      <div className="mb-4 flex flex-wrap gap-3">
        <input
          className="input max-w-xs"
          placeholder="Rechercher n° ou intitulé…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void charger()}
        />
        <select
          className="input w-40"
          value={classe}
          onChange={(e) => setClasse(e.target.value === '' ? '' : Number(e.target.value))}
        >
          <option value="">Toutes classes</option>
          {[1, 2, 3, 4, 5, 6, 7, 8].map((c) => (
            <option key={c} value={c}>
              Classe {c}
            </option>
          ))}
        </select>
        <button type="button" className="btn-secondary" onClick={() => void charger()}>
          Filtrer
        </button>
      </div>

      {comptes.length === 0 ? (
        <EtatVide titre="Aucun compte" description="Aucun compte ne correspond aux filtres." />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">N°</th>
                <th className="px-4 py-3">Intitulé</th>
                <th className="px-4 py-3">Classe</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Statut</th>
                {peutEcrire && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody>
              {comptes.map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="px-4 py-2.5 font-mono font-medium text-slate-900">{c.numero}</td>
                  <td className="px-4 py-2.5 text-slate-700">{c.intitule}</td>
                  <td className="px-4 py-2.5">{c.classe}</td>
                  <td className="px-4 py-2.5 capitalize">{c.type}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        c.actif ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {c.actif ? 'Actif' : 'Inactif'}
                    </span>
                  </td>
                  {peutEcrire && (
                    <td className="px-4 py-2.5 text-right">
                      <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => void basculer(c.id)}>
                        {c.actif ? 'Désactiver' : 'Activer'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
