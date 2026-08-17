import { useMemo, useState } from 'react'
import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  CheckCircle2,
  Scale,
} from 'lucide-react'
import { LIBELLES_ROLE, useStore } from '../store'
import {
  LIBELLES_TYPE,
  TYPES_SORTIE,
  aujourdHuiIso,
  etatJournalierCaisse,
  situationCaisse,
  type SituationCaisse,
} from '../metier'
import type { Employe } from '../types'
import { formatDate, formatDateHeure, formatMontant } from '../utils'
import { Avatar, EnTetePage, EtatVide, Modale } from '../components/ui'
import { useConfirmation } from '../components/Confirmation'

function BadgeEcart({ ecart }: { ecart: number }) {
  if (ecart === 0) return <span className="badge bg-emerald-100 text-emerald-700">Juste</span>
  return (
    <span className={`badge ${ecart > 0 ? 'bg-sky-100 text-sky-700' : 'bg-rose-100 text-rose-700'}`}>
      {ecart > 0 ? '+' : ''}
      {formatMontant(ecart)}
    </span>
  )
}

function BadgeStatutCaisse({ situation }: { situation: SituationCaisse }) {
  if (situation.journeesEnRetard.length > 0) {
    return <span className="badge bg-rose-100 text-rose-700">Retard</span>
  }
  if (situation.cloturee) {
    return <span className="badge bg-emerald-100 text-emerald-700">Arrêtée</span>
  }
  if (situation.nombreOperations === 0) {
    return <span className="badge bg-slate-100 text-slate-600">Sans ops</span>
  }
  return <span className="badge bg-amber-100 text-amber-800">À arrêter</span>
}

function prenomNom(nomComplet: string) {
  const [prenom, ...reste] = nomComplet.split(' ')
  return { prenom, nom: reste.join(' ') || prenom }
}

function ListeTransactions({
  transactions,
}: {
  transactions: SituationCaisse['transactions']
}) {
  if (transactions.length === 0) {
    return <p className="text-sm text-slate-500">Aucune opération.</p>
  }
  return (
    <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
      {transactions.map((t) => {
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
  )
}

/** Vue pilotage : admin (toutes agences) / chef (son agence). */
function VueGlobaleCaisses() {
  const { data, estAdmin, agenceFiltreOperations } = useStore()
  const [dateJournal, setDateJournal] = useState(aujourdHuiIso())
  const [selectionId, setSelectionId] = useState<string | null>(null)
  const [filtreStatut, setFiltreStatut] = useState<'tous' | 'a_arreter' | 'retard' | 'arretee'>('tous')

  const caisses = useMemo(() => {
    return data.employes
      .filter((u) => u.actif && (u.role === 'caissier' || u.role === 'chef_agence'))
      .filter((u) => !agenceFiltreOperations || u.agenceId === agenceFiltreOperations)
      .map((employe) => ({
        employe,
        situation: situationCaisse(employe.id, data.transactions, data.arretsCaisse, dateJournal),
        agence: data.agences.find((a) => a.id === employe.agenceId),
      }))
      .sort((a, b) => {
        const prio = (s: SituationCaisse) =>
          s.journeesEnRetard.length > 0 ? 0 : !s.cloturee && s.nombreOperations > 0 ? 1 : s.cloturee ? 2 : 3
        const d = prio(a.situation) - prio(b.situation)
        if (d !== 0) return d
        return a.employe.nomComplet.localeCompare(b.employe.nomComplet)
      })
  }, [data, agenceFiltreOperations, dateJournal])

  const caissesFiltrees = useMemo(() => {
    return caisses.filter(({ situation }) => {
      if (filtreStatut === 'tous') return true
      if (filtreStatut === 'retard') return situation.journeesEnRetard.length > 0
      if (filtreStatut === 'arretee') return situation.cloturee
      return !situation.cloturee && situation.journeesEnRetard.length === 0
    })
  }, [caisses, filtreStatut])

  const totaux = useMemo(() => {
    return caisses.reduce(
      (acc, { situation }) => {
        acc.entrees += situation.totalEntrees
        acc.sorties += situation.totalSorties
        acc.ops += situation.nombreOperations
        if (situation.journeesEnRetard.length > 0) acc.retard++
        else if (situation.cloturee) acc.arretees++
        else if (situation.nombreOperations > 0) acc.aArreter++
        return acc
      },
      { entrees: 0, sorties: 0, ops: 0, retard: 0, arretees: 0, aArreter: 0 },
    )
  }, [caisses])

  const selection = caisses.find((c) => c.employe.id === selectionId)

  const arretsAffiches = useMemo(() => {
    let arrets = data.arretsCaisse
    if (agenceFiltreOperations) {
      arrets = arrets.filter((a) => a.agenceId === agenceFiltreOperations)
    }
    return [...arrets].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40)
  }, [data.arretsCaisse, agenceFiltreOperations])

  const journalGlobal = useMemo(
    () =>
      etatJournalierCaisse(data.transactions, dateJournal, {
        agenceId: agenceFiltreOperations ?? undefined,
      }),
    [data.transactions, dateJournal, agenceFiltreOperations],
  )

  return (
    <div>
      <EnTetePage
        titre="Suivi des caisses"
        sousTitre={
          estAdmin
            ? 'Vue globale de toutes les caisses'
            : 'Vue des caisses de votre agence'
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="text-sm text-slate-600">Journée</label>
        <input
          className="input !w-auto"
          type="date"
          value={dateJournal}
          onChange={(e) => {
            setDateJournal(e.target.value)
            setSelectionId(null)
          }}
        />
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['tous', 'Tous'],
              ['a_arreter', 'À arrêter'],
              ['retard', 'En retard'],
              ['arretee', 'Arrêtées'],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setFiltreStatut(v)}
              className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${
                filtreStatut === v
                  ? 'bg-brand-600 text-white'
                  : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className="card">
          <div className="text-xs text-slate-500">Caisses</div>
          <div className="mt-1 text-xl font-bold text-slate-900">{caisses.length}</div>
        </div>
        <div className="card">
          <div className="text-xs text-slate-500">À arrêter</div>
          <div className="mt-1 text-xl font-bold text-amber-700">{totaux.aArreter}</div>
        </div>
        <div className="card">
          <div className="text-xs text-slate-500">En retard</div>
          <div className="mt-1 text-xl font-bold text-rose-700">{totaux.retard}</div>
        </div>
        <div className="card">
          <div className="text-xs text-slate-500">Entrées du jour</div>
          <div className="mt-1 text-lg font-bold text-emerald-600">{formatMontant(totaux.entrees)}</div>
        </div>
        <div className="card">
          <div className="text-xs text-slate-500">Sorties du jour</div>
          <div className="mt-1 text-lg font-bold text-rose-600">{formatMontant(totaux.sorties)}</div>
        </div>
      </div>

      {caissesFiltrees.length === 0 ? (
        <EtatVide titre="Aucune caisse" description="Aucun caissier ne correspond au filtre." />
      ) : (
        <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {caissesFiltrees.map(({ employe, situation, agence }) => {
            const { prenom, nom } = prenomNom(employe.nomComplet)
            const actif = selectionId === employe.id
            return (
              <button
                key={employe.id}
                type="button"
                onClick={() => setSelectionId((id) => (id === employe.id ? null : employe.id))}
                className={`card text-left transition hover:shadow-md hover:ring-2 hover:ring-brand-200 ${
                  actif ? 'ring-2 ring-brand-500 shadow-md' : ''
                }`}
              >
                <div className="flex items-start gap-3">
                  <Avatar nom={nom} prenom={prenom} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-900">{employe.nomComplet}</span>
                      <BadgeStatutCaisse situation={situation} />
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {LIBELLES_ROLE[employe.role]}
                      {agence ? ` · ${agence.nom}` : ''}
                    </p>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <div className="text-slate-500">Entrées</div>
                        <div className="font-semibold text-emerald-600">
                          {formatMontant(situation.totalEntrees)}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">Sorties</div>
                        <div className="font-semibold text-rose-600">
                          {formatMontant(situation.totalSorties)}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">Solde</div>
                        <div className="font-bold text-brand-700">
                          {formatMontant(situation.soldeTheorique)}
                        </div>
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      {situation.nombreOperations} opération
                      {situation.nombreOperations > 1 ? 's' : ''}
                      {situation.journeesEnRetard.length > 0 &&
                        ` · ${situation.journeesEnRetard.length} j. en retard`}
                      {situation.arretDuJour && (
                        <>
                          {' · '}
                          <BadgeEcart ecart={situation.arretDuJour.ecart} />
                        </>
                      )}
                    </p>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {selection && (
        <div className="card mb-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-semibold text-slate-900">
                Détail — {selection.employe.nomComplet}
              </h3>
              <p className="text-xs text-slate-500">
                {formatDate(dateJournal + 'T12:00:00')} · consultation (l’arrêt est fait par le
                caissier)
              </p>
            </div>
            <BadgeStatutCaisse situation={selection.situation} />
          </div>
          <ListeTransactions transactions={selection.situation.transactions} />
        </div>
      )}

      <div className="card mb-6">
        <h3 className="mb-3 font-semibold text-slate-900">
          Synthèse du {formatDate(dateJournal + 'T12:00:00')}
        </h3>
        {journalGlobal.duJour.length === 0 ? (
          <p className="text-sm text-slate-500">Aucune opération sur cette période.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 text-sm">
            <div className="rounded-xl bg-emerald-50 px-3 py-2">
              Entrées : <span className="font-bold">{formatMontant(journalGlobal.entrees)}</span>
            </div>
            <div className="rounded-xl bg-rose-50 px-3 py-2">
              Sorties : <span className="font-bold">{formatMontant(journalGlobal.sorties)}</span>
            </div>
            <div className="rounded-xl bg-slate-50 px-3 py-2">
              Net :{' '}
              <span className="font-bold">
                {formatMontant(journalGlobal.entrees - journalGlobal.sorties)}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="card !p-0">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="font-semibold text-slate-900">Derniers arrêts de caisse</h3>
        </div>
        {arretsAffiches.length === 0 ? (
          <div className="p-5">
            <EtatVide titre="Aucun arrêt" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3">Journée</th>
                  <th className="px-5 py-3">Caissier</th>
                  <th className="px-5 py-3 text-right">Solde th.</th>
                  <th className="px-5 py-3 text-right">Compté</th>
                  <th className="px-5 py-3">Écart</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {arretsAffiches.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <div className="font-medium">
                        {formatDate((a.journee ?? a.date.slice(0, 10)) + 'T12:00:00')}
                      </div>
                      <div className="text-xs text-slate-400">{formatDateHeure(a.date)}</div>
                    </td>
                    <td className="px-5 py-3">{a.employeNom}</td>
                    <td className="px-5 py-3 text-right font-semibold">
                      {formatMontant(a.soldeTheorique)}
                    </td>
                    <td className="px-5 py-3 text-right">{formatMontant(a.montantCompte)}</td>
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
    </div>
  )
}

/** Vue caissier : état de sa caisse + arrêt journalier. */
function VueCaisseCaissier({ employe }: { employe: Employe }) {
  const { data, arreterCaisse } = useStore()
  const { alerter } = useConfirmation()
  const [modaleArret, setModaleArret] = useState(false)
  const [montantCompte, setMontantCompte] = useState('')
  const [noteArret, setNoteArret] = useState('')
  const [detailOuvert, setDetailOuvert] = useState(false)

  const maCaisse = useMemo(
    () => situationCaisse(employe.id, data.transactions, data.arretsCaisse),
    [employe.id, data.transactions, data.arretsCaisse],
  )

  const jourAArreter = maCaisse.journeesEnRetard[0] ?? aujourdHuiIso()

  const caisseAArreter = useMemo(
    () => situationCaisse(employe.id, data.transactions, data.arretsCaisse, jourAArreter),
    [employe.id, data.transactions, data.arretsCaisse, jourAArreter],
  )

  const arretsPerso = useMemo(
    () =>
      [...data.arretsCaisse]
        .filter((a) => a.employeId === employe.id)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [data.arretsCaisse, employe.id],
  )

  const enRetard = maCaisse.journeesEnRetard.length > 0
  const ecartPrevu =
    montantCompte === '' ? null : Number(montantCompte) - caisseAArreter.soldeTheorique

  const validerArret = async (e: React.FormEvent) => {
    e.preventDefault()
    const err = arreterCaisse(Number(montantCompte), noteArret.trim() || undefined, jourAArreter)
    if (err) {
      await alerter('Arrêt impossible', err)
      return
    }
    setModaleArret(false)
    setMontantCompte('')
    setNoteArret('')
    await alerter(
      'Arrêt de caisse enregistré',
      `La caisse du ${formatDate(jourAArreter + 'T12:00:00')} a été clôturée.`,
    )
  }

  return (
    <div>
      <EnTetePage
        titre="Ma caisse"
        sousTitre={`État et gestion — ${employe.nomComplet}`}
        action={
          <button
            className="btn-primary"
            onClick={() => {
              setMontantCompte('')
              setNoteArret('')
              setModaleArret(true)
            }}
            disabled={maCaisse.cloturee && !enRetard}
            title={
              maCaisse.cloturee && !enRetard
                ? 'Caisse du jour déjà arrêtée'
                : `Arrêter la caisse du ${jourAArreter}`
            }
          >
            <Scale className="h-4 w-4" />
            {enRetard
              ? `Arrêter le ${formatDate(jourAArreter + 'T12:00:00')}`
              : maCaisse.cloturee
                ? 'Caisse du jour arrêtée'
                : 'Arrêt de caisse du jour'}
          </button>
        }
      />

      {enRetard && (
        <div className="mb-6 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800 ring-1 ring-rose-200">
          <p className="font-semibold">Arrêt de caisse en retard</p>
          <p className="mt-1">
            Journée(s) non clôturée(s) :{' '}
            {maCaisse.journeesEnRetard.map((j) => formatDate(j + 'T12:00:00')).join(', ')}. Les
            nouvelles opérations sont bloquées jusqu’à clôture.
          </p>
        </div>
      )}

      {!enRetard && maCaisse.cloturee && maCaisse.arretDuJour && (
        <div className="mb-6 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 ring-1 ring-emerald-200">
          Caisse du jour arrêtée — écart <BadgeEcart ecart={maCaisse.arretDuJour.ecart} />
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="card">
          <div className="text-xs text-slate-500">Statut du jour</div>
          <div className="mt-1">
            <BadgeStatutCaisse situation={maCaisse} />
          </div>
        </div>
        <div className="card">
          <div className="text-xs text-slate-500">Entrées</div>
          <div className="mt-1 text-lg font-bold text-emerald-600">
            {formatMontant(maCaisse.totalEntrees)}
          </div>
        </div>
        <div className="card">
          <div className="text-xs text-slate-500">Sorties</div>
          <div className="mt-1 text-lg font-bold text-rose-600">
            {formatMontant(maCaisse.totalSorties)}
          </div>
        </div>
        <div className="card">
          <div className="text-xs text-slate-500">Solde théorique</div>
          <div className="mt-1 text-lg font-bold text-brand-700">
            {formatMontant(maCaisse.soldeTheorique)}
          </div>
          <div className="text-xs text-slate-500">{maCaisse.nombreOperations} op.</div>
        </div>
      </div>

      <div className="card mb-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold text-slate-900">
            Opérations du jour ({maCaisse.nombreOperations})
          </h3>
          <button
            type="button"
            className="btn-secondary !py-2 text-xs"
            disabled={maCaisse.nombreOperations === 0}
            onClick={() => setDetailOuvert(true)}
          >
            Agrandir
          </button>
        </div>
        <ListeTransactions transactions={maCaisse.transactions} />
      </div>

      <div className="card !p-0">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="font-semibold text-slate-900">
            Mes arrêts de caisse ({arretsPerso.length})
          </h3>
        </div>
        {arretsPerso.length === 0 ? (
          <div className="p-5">
            <EtatVide titre="Aucun arrêt" description="Effectuez l’arrêt en fin de journée." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3">Journée</th>
                  <th className="px-5 py-3 text-right">Ops</th>
                  <th className="px-5 py-3 text-right">Solde th.</th>
                  <th className="px-5 py-3 text-right">Compté</th>
                  <th className="px-5 py-3">Écart</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {arretsPerso.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <div className="font-medium">
                        {formatDate((a.journee ?? a.date.slice(0, 10)) + 'T12:00:00')}
                      </div>
                      <div className="text-xs text-slate-400">{formatDateHeure(a.date)}</div>
                    </td>
                    <td className="px-5 py-3 text-right">{a.nombreOperations}</td>
                    <td className="px-5 py-3 text-right font-semibold">
                      {formatMontant(a.soldeTheorique)}
                    </td>
                    <td className="px-5 py-3 text-right">{formatMontant(a.montantCompte)}</td>
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

      <Modale
        titre={`Arrêt de caisse — ${formatDate(jourAArreter + 'T12:00:00')}`}
        ouverte={modaleArret}
        onFermer={() => setModaleArret(false)}
      >
        <form onSubmit={validerArret} className="space-y-4">
          <p className="text-sm text-slate-600">
            {enRetard
              ? 'Clôture d’une journée en retard. Comptez les espèces de cette journée.'
              : 'Clôture de la caisse du jour. Comptez les espèces en caisse.'}
          </p>
          <div className="rounded-xl bg-slate-50 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Opérations</span>
              <span className="font-semibold">{caisseAArreter.nombreOperations}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Entrées</span>
              <span className="font-semibold text-emerald-600">
                {formatMontant(caisseAArreter.totalEntrees)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Sorties</span>
              <span className="font-semibold text-rose-600">
                {formatMontant(caisseAArreter.totalSorties)}
              </span>
            </div>
            <div className="mt-1 flex justify-between border-t border-slate-200 pt-1">
              <span className="font-semibold text-slate-700">Solde théorique</span>
              <span className="font-bold text-brand-700">
                {formatMontant(caisseAArreter.soldeTheorique)}
              </span>
            </div>
          </div>
          <div>
            <label className="label">Espèces comptées (FCFA) *</label>
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
              {ecartPrevu === 0 ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <Banknote className="h-4 w-4" />
              )}
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
              Valider l&apos;arrêt
            </button>
          </div>
        </form>
      </Modale>

      <Modale
        titre="Opérations du jour"
        ouverte={detailOuvert}
        onFermer={() => setDetailOuvert(false)}
        large
      >
        <ListeTransactions transactions={maCaisse.transactions} />
      </Modale>
    </div>
  )
}

export default function Caisse() {
  const { employeConnecte, estAdmin, estChefAgence } = useStore()

  if (!employeConnecte) return null

  if (estAdmin || estChefAgence) {
    return <VueGlobaleCaisses />
  }

  return <VueCaisseCaissier employe={employeConnecte} />
}
