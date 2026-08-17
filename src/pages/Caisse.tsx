import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownRight, ArrowUpRight, ChevronRight } from 'lucide-react'
import { LIBELLES_ROLE, useStore } from '../store'
import {
  LIBELLES_TYPE,
  TYPES_SORTIE,
  aujourdHuiIso,
  arretClotureEnRetard,
  compteCaisseDe,
  dateClotureArret,
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
    return <span className="badge bg-emerald-100 text-emerald-700">Clôturée</span>
  }
  if (!situation.ouverte) {
    return <span className="badge bg-slate-100 text-slate-600">Non ouverte</span>
  }
  if (situation.nombreOperations === 0) {
    return <span className="badge bg-sky-100 text-sky-700">Ouverte</span>
  }
  return <span className="badge bg-amber-100 text-amber-800">À clôturer</span>
}

function prenomNom(nomComplet: string) {
  const [prenom, ...reste] = nomComplet.split(' ')
  return { prenom, nom: reste.join(' ') || prenom }
}

/** Date / mois locaux (évite le décalage UTC de toISOString). */
function aujourdhuiLocalIso(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function moisEnCoursLocal(): string {
  return aujourdhuiLocalIso().slice(0, 7)
}

function bornesMois(mois: string): { debut: string; fin: string } {
  const [y, m] = mois.split('-').map(Number)
  const dernierJour = new Date(y, m, 0).getDate()
  return {
    debut: `${mois}-01`,
    fin: `${mois}-${String(dernierJour).padStart(2, '0')}`,
  }
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
  const [filtreStatut, setFiltreStatut] = useState<
    'tous' | 'a_arreter' | 'retard' | 'arretee' | 'non_ouverte'
  >('tous')
  const [filtreArretsMode, setFiltreArretsMode] = useState<'mois' | 'intervalle'>('mois')
  const [filtreArretsMois, setFiltreArretsMois] = useState(moisEnCoursLocal)
  const bornesMoisCourant = bornesMois(moisEnCoursLocal())
  const [filtreArretsDebut, setFiltreArretsDebut] = useState(bornesMoisCourant.debut)
  const [filtreArretsFin, setFiltreArretsFin] = useState(bornesMoisCourant.fin)

  const caisses = useMemo(() => {
    return data.employes
      .filter((u) => u.actif && (u.role === 'caissier' || u.role === 'chef_agence'))
      .filter((u) => !agenceFiltreOperations || u.agenceId === agenceFiltreOperations)
      .map((employe) => ({
        employe,
        situation: situationCaisse(
          employe.id,
          data.transactions,
          data.arretsCaisse,
          dateJournal,
          data.comptesCaisse,
          data.mouvementsCompteCaisse,
          data.ouverturesCaisse ?? [],
        ),
        agence: data.agences.find((a) => a.id === employe.agenceId),
      }))
      .sort((a, b) => {
        const prio = (s: SituationCaisse) =>
          s.journeesEnRetard.length > 0
            ? 0
            : !s.ouverte
              ? 1
              : !s.cloturee && s.nombreOperations > 0
                ? 2
                : s.ouverte && !s.cloturee
                  ? 3
                  : s.cloturee
                    ? 4
                    : 5
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
      if (filtreStatut === 'non_ouverte') return !situation.ouverte && !situation.cloturee
      return situation.ouverte && !situation.cloturee
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
        else if (!situation.ouverte) acc.nonOuvertes++
        else if (situation.nombreOperations > 0) acc.aArreter++
        else acc.ouvertes++
        return acc
      },
      { entrees: 0, sorties: 0, ops: 0, retard: 0, arretees: 0, aArreter: 0, nonOuvertes: 0, ouvertes: 0 },
    )
  }, [caisses])

  const arretsAffiches = useMemo(() => {
    let arrets = data.arretsCaisse
    if (agenceFiltreOperations) {
      arrets = arrets.filter((a) => a.agenceId === agenceFiltreOperations)
    }
    arrets = arrets.filter((a) => {
      const jour = a.journee ?? dateClotureArret(a).slice(0, 10)
      if (filtreArretsMode === 'mois') {
        const mois = filtreArretsMois || moisEnCoursLocal()
        return jour.startsWith(mois)
      }
      const debut = filtreArretsDebut || bornesMois(moisEnCoursLocal()).debut
      const fin = filtreArretsFin || bornesMois(moisEnCoursLocal()).fin
      if (jour < debut) return false
      if (jour > fin) return false
      return true
    })
    return [...arrets].sort((a, b) => dateClotureArret(b).localeCompare(dateClotureArret(a)))
  }, [
    data.arretsCaisse,
    agenceFiltreOperations,
    filtreArretsMode,
    filtreArretsMois,
    filtreArretsDebut,
    filtreArretsFin,
  ])

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
              ['non_ouverte', 'Non ouvertes'],
              ['a_arreter', 'À clôturer'],
              ['retard', 'En retard'],
              ['arretee', 'Clôturées'],
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

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-7">
        <div className="card">
          <div className="text-xs text-slate-500">Caisses</div>
          <div className="mt-1 text-xl font-bold text-slate-900">{caisses.length}</div>
        </div>
        <div className="card">
          <div className="text-xs text-slate-500">Soldes comptes</div>
          <div className="mt-1 text-lg font-bold text-brand-700">
            {formatMontant(
              caisses.reduce((s, { employe }) => {
                const c = compteCaisseDe(data.comptesCaisse, employe.id)
                return s + (c?.solde ?? 0)
              }, 0),
            )}
          </div>
        </div>
        <div className="card">
          <div className="text-xs text-slate-500">Non ouvertes</div>
          <div className="mt-1 text-xl font-bold text-slate-700">{totaux.nonOuvertes}</div>
        </div>
        <div className="card">
          <div className="text-xs text-slate-500">À clôturer</div>
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
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    <div>
                      <div className="text-slate-500">Compte caisse</div>
                      <div className="font-bold text-brand-700">
                        {formatMontant(compteCaisseDe(data.comptesCaisse, employe.id)?.solde ?? 0)}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Ouverture</div>
                      <div className="font-semibold text-slate-800">
                        {formatMontant(situation.soldeOuverture)}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Entrées / sorties</div>
                      <div className="font-semibold">
                        <span className="text-emerald-600">{formatMontant(situation.totalEntrees)}</span>
                        {' / '}
                        <span className="text-rose-600">{formatMontant(situation.totalSorties)}</span>
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Fermeture th.</div>
                      <div className="font-bold text-slate-800">
                        {formatMontant(situation.soldeFermetureTheorique)}
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
        <div className="space-y-3 border-b border-slate-200 px-5 py-4">
          <h3 className="font-semibold text-slate-900">
            Arrêts de caisse ({arretsAffiches.length})
          </h3>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setFiltreArretsMode('mois')
                  setFiltreArretsMois(moisEnCoursLocal())
                }}
                className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${
                  filtreArretsMode === 'mois'
                    ? 'bg-brand-600 text-white'
                    : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
                }`}
              >
                Par mois
              </button>
              <button
                type="button"
                onClick={() => {
                  setFiltreArretsMode('intervalle')
                  const { debut, fin } = bornesMois(filtreArretsMois || moisEnCoursLocal())
                  setFiltreArretsDebut(debut)
                  setFiltreArretsFin(fin)
                }}
                className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${
                  filtreArretsMode === 'intervalle'
                    ? 'bg-brand-600 text-white'
                    : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
                }`}
              >
                Par intervalle
              </button>
            </div>
            {filtreArretsMode === 'mois' ? (
              <div>
                <label className="label !mb-1">Mois</label>
                <input
                  className="input !w-auto"
                  type="month"
                  value={filtreArretsMois || moisEnCoursLocal()}
                  max={moisEnCoursLocal()}
                  onChange={(e) => setFiltreArretsMois(e.target.value)}
                />
              </div>
            ) : (
              <>
                <div>
                  <label className="label !mb-1">Du</label>
                  <input
                    className="input !w-auto"
                    type="date"
                    value={filtreArretsDebut}
                    max={filtreArretsFin || aujourdhuiLocalIso()}
                    onChange={(e) => setFiltreArretsDebut(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label !mb-1">Au</label>
                  <input
                    className="input !w-auto"
                    type="date"
                    value={filtreArretsFin}
                    min={filtreArretsDebut || undefined}
                    max={aujourdhuiLocalIso()}
                    onChange={(e) => setFiltreArretsFin(e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className="btn-secondary !py-2 text-xs"
                  onClick={() => {
                    const { debut, fin } = bornesMois(moisEnCoursLocal())
                    setFiltreArretsDebut(debut)
                    setFiltreArretsFin(fin)
                  }}
                >
                  Mois en cours
                </button>
              </>
            )}
          </div>
        </div>
        {arretsAffiches.length === 0 ? (
          <div className="p-5">
            <EtatVide
              titre="Aucun arrêt"
              description={
                filtreArretsMode === 'mois'
                  ? 'Aucun arrêt pour ce mois.'
                  : 'Aucun arrêt pour cet intervalle.'
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3">Journée</th>
                  <th className="px-5 py-3">Clôture</th>
                  <th className="px-5 py-3">Caissier</th>
                  <th className="px-5 py-3 text-right">Ouverture</th>
                  <th className="px-5 py-3 text-right">Fermeture th.</th>
                  <th className="px-5 py-3 text-right">Compté</th>
                  <th className="px-5 py-3">Écart</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {arretsAffiches.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <div className="font-medium">
                        {formatDate((a.journee ?? dateClotureArret(a).slice(0, 10)) + 'T12:00:00')}
                      </div>
                      {arretClotureEnRetard(a) && (
                        <span className="badge mt-1 bg-amber-100 text-amber-800">Clôturé en retard</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-slate-600">
                      <div className="text-sm">{formatDateHeure(dateClotureArret(a))}</div>
                      {a.valideParNom && (
                        <div className="text-xs text-slate-400">par {a.valideParNom}</div>
                      )}
                    </td>
                    <td className="px-5 py-3">{a.employeNom}</td>
                    <td className="px-5 py-3 text-right">{formatMontant(a.soldeOuverture ?? 0)}</td>
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
    () =>
      situationCaisse(
        employe.id,
        data.transactions,
        data.arretsCaisse,
        aujourdHuiIso(),
        data.comptesCaisse,
        data.mouvementsCompteCaisse,
        data.ouverturesCaisse ?? [],
      ),
    [
      employe.id,
      data.transactions,
      data.arretsCaisse,
      data.comptesCaisse,
      data.mouvementsCompteCaisse,
      data.ouverturesCaisse,
    ],
  )

  const monCompte = useMemo(
    () => compteCaisseDe(data.comptesCaisse, employe.id),
    [data.comptesCaisse, employe.id],
  )

  const arretsPerso = useMemo(
    () =>
      [...data.arretsCaisse]
        .filter((a) => a.employeId === employe.id)
        .sort((a, b) => dateClotureArret(b).localeCompare(dateClotureArret(a))),
    [data.arretsCaisse, employe.id],
  )

  const enRetard = maCaisse.journeesEnRetard.length > 0

  return (
    <div>
      <EnTetePage
        titre="Ma caisse"
        sousTitre={`Consultation — opérations de votre caisse uniquement — ${employe.nomComplet}`}
      />

      <div className="card mb-6 border-brand-200 bg-brand-50/40">
        <div className="text-xs font-medium uppercase tracking-wide text-brand-700">
          Solde de mon compte caisse
        </div>
        <div className="mt-1 text-3xl font-bold text-brand-800">
          {formatMontant(monCompte?.solde ?? 0)}
        </div>
        {monCompte && (
          <p className="mt-1 text-xs text-slate-500">
            Compte {monCompte.numero} — mis à jour automatiquement à chaque opération
          </p>
        )}
      </div>
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

      {!enRetard && !maCaisse.ouverte && (
        <div className="mb-6 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700 ring-1 ring-slate-200">
          Journée non ouverte — l’admin ou le chef d’agence doit saisir le montant d’ouverture avant
          vos opérations.
        </div>
      )}

      {!enRetard && maCaisse.ouverte && !maCaisse.cloturee && (
        <div className="mb-6 rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-800 ring-1 ring-sky-200">
          Journée ouverte — solde d’ouverture {formatMontant(maCaisse.soldeOuverture)}
          {maCaisse.ouvertureDuJour?.ouvertParNom && (
            <span> (par {maCaisse.ouvertureDuJour.ouvertParNom})</span>
          )}
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
          <div className="text-xs text-slate-500">Solde à l’ouverture</div>
          <div className="mt-1 text-lg font-bold text-slate-800">
            {formatMontant(maCaisse.soldeOuverture)}
          </div>
        </div>
        <div className="card">
          <div className="text-xs text-slate-500">Entrées / sorties</div>
          <div className="mt-1 text-sm font-bold">
            <span className="text-emerald-600">{formatMontant(maCaisse.totalEntrees)}</span>
            <span className="text-slate-400"> / </span>
            <span className="text-rose-600">{formatMontant(maCaisse.totalSorties)}</span>
          </div>
          <div className="text-xs text-slate-500">{maCaisse.nombreOperations} op.</div>
        </div>
        <div className="card">
          <div className="text-xs text-slate-500">Fermeture théorique</div>
          <div className="mt-1 text-lg font-bold text-brand-700">
            {formatMontant(maCaisse.soldeFermetureTheorique)}
          </div>
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
                  <th className="px-5 py-3">Clôture</th>
                  <th className="px-5 py-3 text-right">Ops</th>
                  <th className="px-5 py-3 text-right">Ouverture</th>
                  <th className="px-5 py-3 text-right">Fermeture th.</th>
                  <th className="px-5 py-3 text-right">Compté</th>
                  <th className="px-5 py-3">Écart</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {arretsPerso.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <div className="font-medium">
                        {formatDate((a.journee ?? dateClotureArret(a).slice(0, 10)) + 'T12:00:00')}
                      </div>
                      {arretClotureEnRetard(a) && (
                        <span className="badge mt-1 bg-amber-100 text-amber-800">En retard</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-slate-600">
                      <div className="text-sm">{formatDateHeure(dateClotureArret(a))}</div>
                      {a.valideParNom && (
                        <div className="text-xs text-slate-400">par {a.valideParNom}</div>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">{a.nombreOperations}</td>
                    <td className="px-5 py-3 text-right">{formatMontant(a.soldeOuverture ?? 0)}</td>
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
