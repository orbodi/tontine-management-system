import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Download } from 'lucide-react'
import { comptaApi } from '../../api/comptabilite'
import { apiUrl, getToken } from '../../api/client'
import { EnTetePage } from '../../components/ui'
import { formatMontant } from '../../utils'
import { useConfirmation } from '../../components/Confirmation'
import type { LigneBalance } from '../../types'

export default function BalancePage() {
  const { alerter } = useConfirmation()
  const [rows, setRows] = useState<LigneBalance[]>([])

  const charger = async () => {
    try {
      setRows(await comptaApi.balance())
    } catch (e) {
      await alerter('Erreur', e instanceof Error ? e.message : 'Chargement impossible')
    }
  }

  useEffect(() => {
    void charger()
  }, [])

  const exporter = async () => {
    try {
      const token = getToken()
      const res = await fetch(apiUrl('/api/comptabilite/balance.csv'), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) throw new Error('Export impossible')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'balance-generale.csv'
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      await alerter('Impossible', e instanceof Error ? e.message : 'Erreur')
    }
  }

  const totD = rows.reduce((s, r) => s + r.totalDebit, 0)
  const totC = rows.reduce((s, r) => s + r.totalCredit, 0)

  return (
    <div>
      <Link to="/comptabilite" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700">
        <ArrowLeft className="h-4 w-4" /> Comptabilité
      </Link>
      <EnTetePage
        titre="Balance générale"
        sousTitre="Soldes débit / crédit par compte"
        action={
          <button type="button" className="btn-secondary" onClick={() => void exporter()}>
            <Download className="h-4 w-4" /> Export CSV
          </button>
        }
      />

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3 text-left">N°</th>
              <th className="px-4 py-3 text-left">Intitulé</th>
              <th className="px-4 py-3 text-right">Mvt débit</th>
              <th className="px-4 py-3 text-right">Mvt crédit</th>
              <th className="px-4 py-3 text-right">Solde D</th>
              <th className="px-4 py-3 text-right">Solde C</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.compteNumero} className="border-t border-slate-100">
                <td className="px-4 py-2 font-mono">{r.compteNumero}</td>
                <td className="px-4 py-2">{r.intitule}</td>
                <td className="px-4 py-2 text-right">{formatMontant(r.totalDebit)}</td>
                <td className="px-4 py-2 text-right">{formatMontant(r.totalCredit)}</td>
                <td className="px-4 py-2 text-right">{r.soldeDebiteur ? formatMontant(r.soldeDebiteur) : '—'}</td>
                <td className="px-4 py-2 text-right">{r.soldeCrediteur ? formatMontant(r.soldeCrediteur) : '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
              <td className="px-4 py-3" colSpan={2}>
                Totaux
              </td>
              <td className="px-4 py-3 text-right">{formatMontant(totD)}</td>
              <td className="px-4 py-3 text-right">{formatMontant(totC)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
