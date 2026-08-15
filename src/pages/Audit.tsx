import { useMemo, useState } from 'react'
import { LogIn, LogOut } from 'lucide-react'
import { useStore } from '../store'
import { LIBELLES_TYPE, TYPES_SORTIE } from '../metier'
import { formatDateHeure, formatMontant } from '../utils'
import { EnTetePage, EtatVide } from '../components/ui'

export default function Audit() {
  const { data } = useStore()
  const [onglet, setOnglet] = useState<'connexions' | 'activites'>('connexions')
  const [employeFiltre, setEmployeFiltre] = useState('tous')

  const connexions = useMemo(() => {
    return data.journalConnexions
      .filter((j) => employeFiltre === 'tous' || j.employeId === employeFiltre)
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [data.journalConnexions, employeFiltre])

  const activites = useMemo(() => {
    return data.transactions
      .filter((t) => employeFiltre === 'tous' || t.operateurId === employeFiltre)
      .slice(0, 200)
  }, [data.transactions, employeFiltre])

  const nomAgence = (id: string) => {
    const a = data.agences.find((x) => x.id === id)
    return a ? `${a.code} — ${a.nom}` : '—'
  }

  return (
    <div>
      <EnTetePage
        titre="Audit"
        sousTitre="Historique des connexions et des activités des employés"
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="flex gap-2">
          <button
            onClick={() => setOnglet('connexions')}
            className={`rounded-xl px-3.5 py-2 text-sm font-medium transition ${
              onglet === 'connexions' ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'
            }`}
          >
            Connexions
          </button>
          <button
            onClick={() => setOnglet('activites')}
            className={`rounded-xl px-3.5 py-2 text-sm font-medium transition ${
              onglet === 'activites' ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'
            }`}
          >
            Activités
          </button>
        </div>
        <select className="input !w-auto" value={employeFiltre} onChange={(e) => setEmployeFiltre(e.target.value)}>
          <option value="tous">Tous les employés</option>
          {data.employes.map((u) => (
            <option key={u.id} value={u.id}>
              {u.nomComplet}
            </option>
          ))}
        </select>
      </div>

      {onglet === 'connexions' ? (
        connexions.length === 0 ? (
          <EtatVide titre="Aucune connexion enregistrée" />
        ) : (
          <div className="card overflow-x-auto !p-0">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3.5">Date / heure</th>
                  <th className="px-5 py-3.5">Employé</th>
                  <th className="px-5 py-3.5">Agence</th>
                  <th className="px-5 py-3.5">Événement</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {connexions.map((j) => (
                  <tr key={j.id} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap px-5 py-3 text-slate-600">{formatDateHeure(j.date)}</td>
                    <td className="px-5 py-3 font-medium text-slate-900">{j.employeNom}</td>
                    <td className="px-5 py-3 text-slate-600">{nomAgence(j.agenceId)}</td>
                    <td className="px-5 py-3">
                      <span
                        className={`badge inline-flex items-center gap-1 ${
                          j.type === 'connexion' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {j.type === 'connexion' ? <LogIn className="h-3 w-3" /> : <LogOut className="h-3 w-3" />}
                        {j.type === 'connexion' ? 'Connexion' : 'Déconnexion'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : activites.length === 0 ? (
        <EtatVide titre="Aucune activité" />
      ) : (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3.5">Date / heure</th>
                <th className="px-5 py-3.5">Opérateur</th>
                <th className="px-5 py-3.5">Agence</th>
                <th className="px-5 py-3.5">Type</th>
                <th className="px-5 py-3.5">Description</th>
                <th className="px-5 py-3.5 text-right">Montant</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {activites.map((t) => {
                const sortie = TYPES_SORTIE.includes(t.type)
                return (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap px-5 py-3 text-slate-600">{formatDateHeure(t.date)}</td>
                    <td className="px-5 py-3 text-slate-800">{t.operateur}</td>
                    <td className="px-5 py-3 text-xs text-slate-500">{nomAgence(t.agenceId)}</td>
                    <td className="px-5 py-3">
                      <span className="badge bg-slate-100 text-slate-600">{LIBELLES_TYPE[t.type]}</span>
                    </td>
                    <td className="max-w-xs truncate px-5 py-3 text-slate-700">{t.description}</td>
                    <td className={`whitespace-nowrap px-5 py-3 text-right font-bold ${sortie ? 'text-rose-600' : 'text-emerald-600'}`}>
                      {sortie ? '-' : '+'}
                      {formatMontant(t.montant)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
