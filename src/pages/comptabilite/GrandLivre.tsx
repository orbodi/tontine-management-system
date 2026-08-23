import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { comptaApi } from '../../api/comptabilite'
import { EnTetePage } from '../../components/ui'
import { formatMontant } from '../../utils'
import { useConfirmation } from '../../components/Confirmation'
import type { CompteGrandLivre } from '../../types'

export default function GrandLivrePage() {
  const { alerter } = useConfirmation()
  const [compte, setCompte] = useState('571')
  const [data, setData] = useState<CompteGrandLivre[]>([])

  const charger = async () => {
    try {
      setData(await comptaApi.grandLivre({ compte_numero: compte || undefined }))
    } catch (e) {
      await alerter('Erreur', e instanceof Error ? e.message : 'Chargement impossible')
    }
  }

  useEffect(() => {
    void charger()
  }, [])

  return (
    <div>
      <Link to="/comptabilite" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700">
        <ArrowLeft className="h-4 w-4" /> Comptabilité
      </Link>
      <EnTetePage titre="Grand livre" sousTitre="Mouvements par compte avec solde progressif" />

      <div className="mb-4 flex flex-wrap gap-2">
        <input
          className="input w-40 font-mono"
          placeholder="N° compte"
          value={compte}
          onChange={(e) => setCompte(e.target.value)}
        />
        <button type="button" className="btn-secondary" onClick={() => void charger()}>
          Afficher
        </button>
      </div>

      {data.map((bloc) => (
        <div key={bloc.compteNumero} className="mb-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
            <p className="font-semibold text-slate-900">
              {bloc.compteNumero} — {bloc.intitule}
            </p>
            <p className="text-sm text-slate-500">Solde final : {formatMontant(bloc.soldeFinal)}</p>
          </div>
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">Date</th>
                <th className="px-4 py-2 text-left">Pièce</th>
                <th className="px-4 py-2 text-left">Libellé</th>
                <th className="px-4 py-2 text-right">Débit</th>
                <th className="px-4 py-2 text-right">Crédit</th>
                <th className="px-4 py-2 text-right">Solde</th>
              </tr>
            </thead>
            <tbody>
              {bloc.mouvements.map((m, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-4 py-2">{m.date}</td>
                  <td className="px-4 py-2 font-mono text-xs">{m.numeroPiece}</td>
                  <td className="px-4 py-2">{m.libelle}</td>
                  <td className="px-4 py-2 text-right">{m.debit ? formatMontant(m.debit) : '—'}</td>
                  <td className="px-4 py-2 text-right">{m.credit ? formatMontant(m.credit) : '—'}</td>
                  <td className="px-4 py-2 text-right font-medium">{formatMontant(m.solde)}</td>
                </tr>
              ))}
              {bloc.mouvements.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                    Aucun mouvement.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ))}
      {data.length === 0 && <p className="text-sm text-slate-500">Aucun mouvement pour ce filtre.</p>}
    </div>
  )
}
