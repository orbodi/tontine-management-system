import { useMemo, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, Banknote, CheckCircle2, Scale } from 'lucide-react'
import { useStore } from '../store'
import { LIBELLES_TYPE, TYPES_SORTIE, etatJournalierCaisse, situationCaisse } from '../metier'
import { formatDate, formatDateHeure, formatMontant } from '../utils'
import { Avatar, EnTetePage, EtatVide, Modale } from '../components/ui'

function BadgeEcart({ ecart }: { ecart: number }) {
  if (ecart === 0) return <span className="badge bg-emerald-100 text-emerald-700">Juste</span>
  return (
    <span className={`badge ${ecart > 0 ? 'bg-sky-100 text-sky-700' : 'bg-rose-100 text-rose-700'}`}>
      {ecart > 0 ? '+' : ''}
      {formatMontant(ecart)}
    </span>
  )
}

function aujourdHuiIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export default function Caisse() {
  const { data, employeConnecte, estAdmin, estChefAgence, agenceFiltreOperations, arreterCaisse } = useStore()
  const [modaleArret, setModaleArret] = useState(false)
  const [montantCompte, setMontantCompte] = useState('')
  const [noteArret, setNoteArret] = useState('')
  const [dateJournal, setDateJournal] = useState(aujourdHuiIso())
  const [detailOuvert, setDetailOuvert] = useState(false)

  const maCaisse = useMemo(
    () =>
      employeConnecte ? situationCaisse(employeConnecte.id, data.transactions, data.arretsCaisse) : null,
    [employeConnecte, data.transactions, data.arretsCaisse],
  )

  const journal = useMemo(() => {
    const filtres: { employeId?: string; agenceId?: string } = {}
    if (!estAdmin && !estChefAgence && employeConnecte) filtres.employeId = employeConnecte.id
    if (agenceFiltreOperations) filtres.agenceId = agenceFiltreOperations
    return etatJournalierCaisse(data.transactions, dateJournal, filtres)
  }, [data.transactions, dateJournal, estAdmin, estChefAgence, employeConnecte, agenceFiltreOperations])

  const caissesEquipe = useMemo(() => {
    if (!estAdmin && !estChefAgence) return []
    return data.employes
      .filter((u) => u.actif && u.id !== employeConnecte?.id)
      .filter((u) => !agenceFiltreOperations || u.agenceId === agenceFiltreOperations)
      .map((u) => ({ employe: u, situation: situationCaisse(u.id, data.transactions, data.arretsCaisse) }))
      .filter((x) => x.situation.nombreOperations > 0 || x.situation.dernierArret)
  }, [estAdmin, estChefAgence, data, employeConnecte, agenceFiltreOperations])

  const arretsAffiches = useMemo(() => {
    let arrets = data.arretsCaisse
    if (estAdmin) {
      // tout
    } else if (agenceFiltreOperations) {
      arrets = arrets.filter((a) => a.agenceId === agenceFiltreOperations)
    } else {
      arrets = arrets.filter((a) => a.employeId === employeConnecte?.id)
    }
    return [...arrets].sort((a, b) => b.date.localeCompare(a.date))
  }, [data.arretsCaisse, estAdmin, employeConnecte, agenceFiltreOperations])

  const validerArret = (e: React.FormEvent) => {
    e.preventDefault()
    arreterCaisse(Number(montantCompte), noteArret.trim() || undefined)
    setModaleArret(false)
    setMontantCompte('')
    setNoteArret('')
  }

  if (!employeConnecte || !maCaisse) return null

  const ecartPrevu = montantCompte === '' ? null : Number(montantCompte) - maCaisse.soldeTheorique
  const voirEquipe = estAdmin || estChefAgence

  return (
    <div>
      <EnTetePage
        titre="Caisse"
        sousTitre={`Compte de caisse de ${employeConnecte.nomComplet}${maCaisse.dernierArret ? ` — dernier arrêt le ${formatDateHeure(maCaisse.dernierArret.date)}` : ''}`}
        action={
          <button
            className="btn-primary"
            onClick={() => {
              setMontantCompte('')
              setNoteArret('')
              setModaleArret(true)
            }}
            disabled={maCaisse.nombreOperations === 0}
          >
            <Scale className="h-4 w-4" />
            Effectuer l'arrêt de caisse
          </button>
        }
      />

      <div className="card mb-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold text-slate-900">État journalier de caisse</h3>
          <div className="flex items-center gap-2">
            <input className="input !w-auto" type="date" value={dateJournal} onChange={(e) => setDateJournal(e.target.value)} />
            <button
              className="btn-secondary !py-2 text-xs"
              disabled={journal.duJour.length === 0}
              onClick={() => setDetailOuvert(true)}
            >
              Détail des transactions
            </button>
          </div>
        </div>
        {journal.duJour.length === 0 ? (
          <p className="text-sm text-slate-500">Aucune opération le {formatDate(dateJournal + 'T12:00:00')}.</p>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2.5 pr-4">Type</th>
                  <th className="py-2.5 pr-4 text-right">Nombre</th>
                  <th className="py-2.5 pr-4 text-right">Dépôts / entrées</th>
                  <th className="py-2.5 text-right">Retraits / sorties</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[...journal.parType.entries()].map(([type, l]) => (
                  <tr key={type}>
                    <td className="py-2.5 pr-4 text-slate-800">{LIBELLES_TYPE[type]}</td>
                    <td className="py-2.5 pr-4 text-right text-slate-600">{l.nombre}</td>
                    <td className="py-2.5 pr-4 text-right font-semibold text-emerald-600">
                      {l.entrees ? formatMontant(l.entrees) : '—'}
                    </td>
                    <td className="py-2.5 text-right font-semibold text-rose-600">
                      {l.sorties ? formatMontant(l.sorties) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 font-bold">
                  <td className="py-2.5 pr-4">TOTAL</td>
                  <td className="py-2.5 pr-4 text-right">{journal.duJour.length}</td>
                  <td className="py-2.5 pr-4 text-right text-emerald-700">{formatMontant(journal.entrees)}</td>
                  <td className="py-2.5 text-right text-rose-700">{formatMontant(journal.sorties)}</td>
                </tr>
              </tfoot>
            </table>
            <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm">
              Solde net du jour :{' '}
              <span className={`font-bold ${journal.entrees - journal.sorties >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                {formatMontant(journal.entrees - journal.sorties)}
              </span>
            </div>
          </>
        )}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="card">
          <div className="text-xs text-slate-500">Opérations depuis le dernier arrêt</div>
          <div className="mt-1 text-lg font-bold text-slate-900">{maCaisse.nombreOperations}</div>
        </div>
        <div className="card">
          <div className="text-xs text-slate-500">Entrées</div>
          <div className="mt-1 text-lg font-bold text-emerald-600">{formatMontant(maCaisse.totalEntrees)}</div>
        </div>
        <div className="card">
          <div className="text-xs text-slate-500">Sorties</div>
          <div className="mt-1 text-lg font-bold text-rose-600">{formatMontant(maCaisse.totalSorties)}</div>
        </div>
        <div className="card">
          <div className="text-xs text-slate-500">Solde théorique de caisse</div>
          <div className="mt-1 text-lg font-bold text-brand-700">{formatMontant(maCaisse.soldeTheorique)}</div>
        </div>
      </div>

      <div className="card mb-6">
        <h3 className="mb-4 font-semibold text-slate-900">
          Mes opérations en caisse ({maCaisse.nombreOperations})
        </h3>
        {maCaisse.nombreOperations === 0 ? (
          <p className="text-sm text-slate-500">Aucune opération depuis le dernier arrêt de caisse.</p>
        ) : (
          <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
            {maCaisse.transactions.map((t) => {
              const sortie = TYPES_SORTIE.includes(t.type)
              return (
                <div key={t.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                      sortie ? 'bg-rose-100 text-rose-600' : 'bg-emerald-100 text-emerald-600'
                    }`}
                  >
                    {sortie ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-800">{t.description}</p>
                    <p className="text-xs text-slate-500">
                      {formatDateHeure(t.date)} — {LIBELLES_TYPE[t.type]}
                    </p>
                  </div>
                  <span className={`shrink-0 font-bold ${sortie ? 'text-rose-600' : 'text-emerald-600'}`}>
                    {sortie ? '-' : '+'}
                    {formatMontant(t.montant)}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {voirEquipe && caissesEquipe.length > 0 && (
        <div className="card mb-6">
          <h3 className="mb-4 font-semibold text-slate-900">
            {estChefAgence ? 'Caisses de mon agence' : "Caisses de l'équipe"}
          </h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {caissesEquipe.map(({ employe, situation }) => {
              const [prenom, ...reste] = employe.nomComplet.split(' ')
              return (
                <div key={employe.id} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
                  <Avatar nom={reste.join(' ') || prenom} prenom={prenom} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-slate-900">{employe.nomComplet}</div>
                    <div className="text-xs text-slate-500">
                      {situation.nombreOperations} opération{situation.nombreOperations > 1 ? 's' : ''} en cours
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-slate-500">Solde théorique</div>
                    <div className="font-bold text-brand-700">{formatMontant(situation.soldeTheorique)}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="card !p-0">
        <div className="px-5 pt-5">
          <h3 className="mb-4 font-semibold text-slate-900">
            {estAdmin ? 'Historique des arrêts de caisse' : 'Arrêts de caisse'} ({arretsAffiches.length})
          </h3>
        </div>
        {arretsAffiches.length === 0 ? (
          <div className="px-5 pb-5">
            <EtatVide titre="Aucun arrêt de caisse" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3.5">Date</th>
                  {(estAdmin || estChefAgence) && <th className="px-5 py-3.5">Caissier</th>}
                  <th className="px-5 py-3.5 text-right">Opérations</th>
                  <th className="px-5 py-3.5 text-right">Entrées</th>
                  <th className="px-5 py-3.5 text-right">Sorties</th>
                  <th className="px-5 py-3.5 text-right">Solde théorique</th>
                  <th className="px-5 py-3.5 text-right">Compté</th>
                  <th className="px-5 py-3.5">Écart</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {arretsAffiches.map((a) => (
                  <tr key={a.id} className="transition hover:bg-slate-50">
                    <td className="whitespace-nowrap px-5 py-3 text-slate-600">
                      {formatDateHeure(a.date)}
                      {a.note && <div className="text-xs text-slate-400">{a.note}</div>}
                    </td>
                    {(estAdmin || estChefAgence) && <td className="px-5 py-3 text-slate-800">{a.employeNom}</td>}
                    <td className="px-5 py-3 text-right text-slate-600">{a.nombreOperations}</td>
                    <td className="px-5 py-3 text-right font-semibold text-emerald-600">{formatMontant(a.totalEntrees)}</td>
                    <td className="px-5 py-3 text-right font-semibold text-rose-600">{formatMontant(a.totalSorties)}</td>
                    <td className="px-5 py-3 text-right font-semibold text-slate-900">{formatMontant(a.soldeTheorique)}</td>
                    <td className="px-5 py-3 text-right text-slate-600">{formatMontant(a.montantCompte)}</td>
                    <td className="px-5 py-3">
                      <BadgeEcart ecart={a.ecart} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modale titre="Arrêt de caisse" ouverte={modaleArret} onFermer={() => setModaleArret(false)}>
        <form onSubmit={validerArret} className="space-y-4">
          <div className="rounded-xl bg-slate-50 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Opérations de la période</span>
              <span className="font-semibold">{maCaisse.nombreOperations}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Entrées</span>
              <span className="font-semibold text-emerald-600">{formatMontant(maCaisse.totalEntrees)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Sorties</span>
              <span className="font-semibold text-rose-600">{formatMontant(maCaisse.totalSorties)}</span>
            </div>
            <div className="mt-1 flex justify-between border-t border-slate-200 pt-1">
              <span className="font-semibold text-slate-700">Solde théorique</span>
              <span className="font-bold text-brand-700">{formatMontant(maCaisse.soldeTheorique)}</span>
            </div>
          </div>
          <div>
            <label className="label">Espèces comptées en caisse (FCFA) *</label>
            <input
              className="input"
              type="number"
              min={0}
              required
              autoFocus
              value={montantCompte}
              onChange={(e) => setMontantCompte(e.target.value)}
            />
          </div>
          {ecartPrevu !== null && (
            <div
              className={`flex items-center gap-2 rounded-xl p-3 text-sm font-semibold ${
                ecartPrevu === 0
                  ? 'bg-emerald-50 text-emerald-700'
                  : ecartPrevu > 0
                    ? 'bg-sky-50 text-sky-700'
                    : 'bg-rose-50 text-rose-700'
              }`}
            >
              {ecartPrevu === 0 ? <CheckCircle2 className="h-4 w-4" /> : <Banknote className="h-4 w-4" />}
              {ecartPrevu === 0
                ? 'Caisse juste, aucun écart.'
                : `Écart de ${ecartPrevu > 0 ? '+' : ''}${formatMontant(ecartPrevu)}.`}
            </div>
          )}
          <div>
            <label className="label">Note</label>
            <input className="input" value={noteArret} onChange={(e) => setNoteArret(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setModaleArret(false)}>
              Annuler
            </button>
            <button type="submit" className="btn-primary">
              Valider l'arrêt de caisse
            </button>
          </div>
        </form>
      </Modale>

      <Modale
        titre={`Transactions du ${formatDate(dateJournal + 'T12:00:00')}`}
        ouverte={detailOuvert}
        onFermer={() => setDetailOuvert(false)}
        large
      >
        <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
          {journal.duJour.map((t) => {
            const sortie = TYPES_SORTIE.includes(t.type)
            return (
              <div key={t.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-800">{t.description}</p>
                  <p className="text-xs text-slate-500">
                    {formatDateHeure(t.date)} — {t.operateur} — {LIBELLES_TYPE[t.type]}
                  </p>
                </div>
                <span className={`shrink-0 font-bold ${sortie ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {sortie ? '-' : '+'}
                  {formatMontant(t.montant)}
                </span>
              </div>
            )
          })}
        </div>
      </Modale>
    </div>
  )
}
