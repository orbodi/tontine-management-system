import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownRight, ArrowUpRight, ChevronRight } from 'lucide-react'
import { LIBELLES_ROLE, useStore } from '../store'
import {
  LIBELLES_TYPE,
  TYPES_SORTIE,
  aujourdHuiIso,
  situationCaisse,
  type SituationCaisse,
} from '../metier'
import type { Employe } from '../types'
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

  const arretsAffiches = useMemo(() => {
    let arrets = data.arretsCaisse
    if (agenceFiltreOperations) {
      arrets = arrets.filter((a) => a.agenceId === agenceFiltreOperations)
    }
    return [...arrets].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40)
  }, [data.arretsCaisse, agenceFiltreOperations])

  return (
    <div>
      <EnTetePage
        titre="Suivi des caisses"
        sousTitre={
          estAdmin
            ? 'Vue globale — l’arrêt de caisse est validé par l’admin ou le chef d’agence'
            : 'Caisses de votre agence — vous validez les arrêts de caisse'
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="text-sm text-slate-600">Journée</label>
        <input
          className="input !w-auto"
          type="date"
          value={dateJournal}
          onChange={(e) => setDateJournal(e.target.value)}
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
            return (
              <Link
                key={employe.id}
                to={`/caisse/${employe.id}`}
                className="card group flex items-start gap-3 transition hover:shadow-md hover:ring-2 hover:ring-brand-200"
              >
                <Avatar nom={nom} prenom={prenom} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-900 group-hover:text-brand-700">
                      {employe.nomComplet}
                    </span>
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
                <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-slate-300 transition group-hover:text-brand-600" />
              </Link>
            )
          })}
        </div>
      )}

      <div className="card mb-6">
        <h3 className="mb-3 font-semibold text-slate-900">
          Synthèse des caisses — {formatDate(dateJournal + 'T12:00:00')}
        </h3>
        <p className="mb-3 text-xs text-slate-500">
          Totaux calculés uniquement à partir des opérations de chaque caisse listée.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 text-sm">
          <div className="rounded-xl bg-emerald-50 px-3 py-2">
            Entrées : <span className="font-bold">{formatMontant(totaux.entrees)}</span>
          </div>
          <div className="rounded-xl bg-rose-50 px-3 py-2">
            Sorties : <span className="font-bold">{formatMontant(totaux.sorties)}</span>
          </div>
          <div className="rounded-xl bg-slate-50 px-3 py-2">
            Net :{' '}
            <span className="font-bold">{formatMontant(totaux.entrees - totaux.sorties)}</span>
          </div>
        </div>
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

/** Vue caissier : consultation de sa caisse (l’arrêt est fait par admin / chef). */
function VueCaisseCaissier({ employe }: { employe: Employe }) {
  const { data } = useStore()
  const [detailOuvert, setDetailOuvert] = useState(false)

  const maCaisse = useMemo(
    () => situationCaisse(employe.id, data.transactions, data.arretsCaisse),
    [employe.id, data.transactions, data.arretsCaisse],
  )

  const arretsPerso = useMemo(
    () =>
      [...data.arretsCaisse]
        .filter((a) => a.employeId === employe.id)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [data.arretsCaisse, employe.id],
  )

  const enRetard = maCaisse.journeesEnRetard.length > 0

  return (
    <div>
      <EnTetePage
        titre="Ma caisse"
        sousTitre={`Consultation — opérations de votre caisse uniquement — ${employe.nomComplet}`}
      />

      {enRetard && (
        <div className="mb-6 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800 ring-1 ring-rose-200">
          <p className="font-semibold">Arrêt de caisse en retard</p>
          <p className="mt-1">
            Journée(s) non clôturée(s) :{' '}
            {maCaisse.journeesEnRetard.map((j) => formatDate(j + 'T12:00:00')).join(', ')}.
            Contactez l’admin ou le chef d’agence pour l’arrêt. Les nouvelles opérations sont
            bloquées jusqu’à clôture.
          </p>
        </div>
      )}

      {!enRetard && maCaisse.cloturee && maCaisse.arretDuJour && (
        <div className="mb-6 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 ring-1 ring-emerald-200">
          Caisse du jour arrêtée — écart <BadgeEcart ecart={maCaisse.arretDuJour.ecart} />
          {maCaisse.arretDuJour.valideParNom && (
            <span className="text-emerald-700"> — par {maCaisse.arretDuJour.valideParNom}</span>
          )}
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
            Historique des arrêts ({arretsPerso.length})
          </h3>
        </div>
        {arretsPerso.length === 0 ? (
          <div className="p-5">
            <EtatVide
              titre="Aucun arrêt"
              description="L’admin ou le chef d’agence effectue l’arrêt de caisse."
            />
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
                      <div className="text-xs text-slate-400">
                        {formatDateHeure(a.date)}
                        {a.valideParNom ? ` · par ${a.valideParNom}` : ''}
                      </div>
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
