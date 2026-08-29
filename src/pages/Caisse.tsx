import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownRight, ArrowUpRight, ChevronRight } from 'lucide-react'
import { useStore } from '../store'
import {
  LIBELLES_TYPE,
  TYPES_SORTIE,
  aujourdHuiIso,
  compteCaisseAgence,
  compteCaissePourEmploye,
  situationCaisse,
  type SituationCaisse,
} from '../metier'
import type { Employe } from '../types'
import { formatDate, formatDateHeure, formatMontant, texteAlerteCompteOuvert, texteConfirmationOuvertureCompte } from '../utils'
import { Avatar, EnTetePage, EtatVide, Modale } from '../components/ui'
import { TableauArretsCaisse } from '../components/TableauArretsCaisse'
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
  const {
    data,
    estAdmin,
    agenceFiltreOperations,
    employeConnecte,
    validerOuvertureCompte,
    refuserOuvertureCompte,
  } = useStore()
  const { confirmer, alerter } = useConfirmation()
  const [dateJournal, setDateJournal] = useState(aujourdHuiIso())
  const [filtreStatut, setFiltreStatut] = useState<
    'tous' | 'a_arreter' | 'retard' | 'arretee' | 'non_ouverte'
  >('tous')

  const mesDemandesAValider = useMemo(
    () =>
      employeConnecte
        ? (data.demandesOuvertureCompte ?? []).filter(
            (d) => d.statut === 'en_attente' && d.caissierId === employeConnecte.id,
          )
        : [],
    [data.demandesOuvertureCompte, employeConnecte],
  )

  const caisses = useMemo(() => {
    return data.agences
      .filter((a) => a.actif)
      .filter((a) => !agenceFiltreOperations || a.id === agenceFiltreOperations)
      .map((agence) => {
        const compte = compteCaisseAgence(data.comptesCaisse, agence.id)
        const titulaire =
          data.employes.find((e) => e.id === compte?.employeId && e.actif) ??
          data.employes.find((e) => e.actif && e.role === 'caissier' && e.agenceId === agence.id)
        if (!titulaire) return null
        return {
          agence,
          employe: titulaire,
          situation: situationCaisse(
            titulaire.id,
            data.transactions,
            data.arretsCaisse,
            dateJournal,
            data.comptesCaisse,
            data.mouvementsCompteCaisse,
            data.ouverturesCaisse ?? [],
            data.employes,
          ),
        }
      })
      .filter((row): row is NonNullable<typeof row> => row != null)
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
        return a.agence.nom.localeCompare(b.agence.nom)
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

  const arretsAgence = useMemo(() => {
    let arrets = data.arretsCaisse
    if (agenceFiltreOperations) {
      arrets = arrets.filter((a) => a.agenceId === agenceFiltreOperations)
    }
    return arrets
  }, [data.arretsCaisse, agenceFiltreOperations])

  return (
    <div>
      <EnTetePage
        titre="Suivi des caisses"
        sousTitre={
          estAdmin
            ? 'Vue globale — une caisse par agence, arrêt validé par l’admin ou le chef d’agence'
            : 'Caisse de votre agence — vous validez les arrêts'
        }
      />

      {mesDemandesAValider.length > 0 && (
        <div className="card mb-6 border-amber-200 bg-amber-50/40">
          <h3 className="mb-1 font-semibold text-slate-900">
            Ouvertures assignées à votre caisse ({mesDemandesAValider.length})
          </h3>
          <p className="mb-4 text-xs text-slate-600">
            Validez après encaissement de la part sociale et du droit d’adhésion (sauf client ancien).
          </p>
          <div className="space-y-3">
            {mesDemandesAValider.map((d) => {
              const client = data.clients.find((c) => c.id === d.clientId)
              const total = d.partSociale + d.droitAdhesion
              return (
                <div
                  key={d.id}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-white px-4 py-3 text-sm ring-1 ring-amber-100"
                >
                  <div>
                    <p className="font-semibold text-slate-900">
                      {client ? `${client.prenom} ${client.nom}` : 'Client'} —{' '}
                      {d.type === 'epargne' ? 'épargne' : 'courant'}
                      {d.promotion ? ' (promo)' : ''}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {d.demandeurNom} — {formatDateHeure(d.dateDemande)} —{' '}
                      {total <= 0 ? 'aucun frais (ancien)' : `total ${formatMontant(total)}`}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn-primary !py-2 text-xs"
                      onClick={async () => {
                        const ok = await confirmer({
                          titre: 'Valider l’ouverture',
                          message: texteConfirmationOuvertureCompte(total),
                          labelValider: 'Valider et créer',
                        })
                        if (!ok) return
                        const err = await validerOuvertureCompte(d.id)
                        if (err) await alerter('Validation impossible', err)
                        else await alerter('Compte ouvert', texteAlerteCompteOuvert(total))
                      }}
                    >
                      Valider
                    </button>
                    <button
                      type="button"
                      className="btn-secondary !py-2 text-xs"
                      onClick={async () => {
                        const ok = await confirmer({
                          titre: 'Refuser la demande',
                          message: 'Refuser cette demande d’ouverture ?',
                          labelValider: 'Refuser',
                          danger: true,
                        })
                        if (!ok) return
                        const err = await refuserOuvertureCompte(d.id, 'Refusée en caisse')
                        if (err) await alerter('Refus impossible', err)
                      }}
                    >
                      Refuser
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

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
              caisses.reduce((s, { agence }) => {
                const c = compteCaisseAgence(data.comptesCaisse, agence.id)
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
        <EtatVide titre="Aucune caisse" description="Aucune agence avec caissier ne correspond au filtre." />
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
                      {agence?.nom ?? 'Agence'}
                    </span>
                    <BadgeStatutCaisse situation={situation} />
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Caissier : {employe.nomComplet}
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    <div>
                      <div className="text-slate-500">Compte caisse</div>
                      <div className="font-bold text-brand-700">
                        {formatMontant(compteCaisseAgence(data.comptesCaisse, agence?.id ?? '')?.solde ?? 0)}
                      </div>
                    </div>
                    {situation.ouverte || situation.cloturee ? (
                      <>
                        <div>
                          <div className="text-slate-500">Ouverture</div>
                          <div className="font-semibold text-slate-800">
                            {formatMontant(situation.soldeOuverture)}
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-500">Entrées / sorties</div>
                          <div className="font-semibold">
                            <span className="text-emerald-600">
                              {formatMontant(situation.totalEntrees)}
                            </span>
                            {' / '}
                            <span className="text-rose-600">
                              {formatMontant(situation.totalSorties)}
                            </span>
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-500">Fermeture th.</div>
                          <div className="font-bold text-slate-800">
                            {formatMontant(situation.soldeFermetureTheorique)}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="col-span-1 sm:col-span-3">
                        <div className="text-slate-500">État du jour</div>
                        <div className="font-semibold text-slate-600">Journée non ouverte</div>
                      </div>
                    )}
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

      <TableauArretsCaisse
        arrets={arretsAgence}
        titre="Arrêts de caisse"
        afficherCaissier
      />
    </div>
  )
}

/** Vue caissier : consultation de sa caisse (l’arrêt est fait par admin / chef). */
function VueCaisseCaissier({ employe }: { employe: Employe }) {
  const { data, validerOuvertureCompte, refuserOuvertureCompte } = useStore()
  const { confirmer, alerter } = useConfirmation()
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
        data.employes,
      ),
    [
      employe.id,
      data.transactions,
      data.arretsCaisse,
      data.comptesCaisse,
      data.mouvementsCompteCaisse,
      data.ouverturesCaisse,
      data.employes,
    ],
  )

  const monCompte = useMemo(
    () => compteCaissePourEmploye(data.comptesCaisse, employe.id, data.employes),
    [data.comptesCaisse, data.employes, employe.id],
  )

  const arretsPerso = useMemo(
    () => data.arretsCaisse.filter((a) => a.agenceId === employe.agenceId),
    [data.arretsCaisse, employe.agenceId],
  )

  const demandesAValider = useMemo(
    () =>
      (data.demandesOuvertureCompte ?? [])
        .filter((d) => d.statut === 'en_attente' && d.caissierId === employe.id)
        .sort((a, b) => a.dateDemande.localeCompare(b.dateDemande)),
    [data.demandesOuvertureCompte, employe.id],
  )

  return (
    <div>
      <EnTetePage
        titre={`Caisse de l’agence`}
        sousTitre={`Consultation — ${data.agences.find((a) => a.id === employe.agenceId)?.nom ?? 'agence'} — opérations de la caisse unique`}
      />

      {demandesAValider.length > 0 && (
        <div className="card mb-6 border-amber-200 bg-amber-50/40">
          <h3 className="mb-1 font-semibold text-slate-900">
            Ouvertures de compte à valider ({demandesAValider.length})
          </h3>
          <p className="mb-4 text-xs text-slate-600">
            Encaisser part sociale + droit d’adhésion (sauf client ancien), puis valider. Le compte n’existe qu’après
            validation.
          </p>
          <div className="space-y-3">
            {demandesAValider.map((d) => {
              const client = data.clients.find((c) => c.id === d.clientId)
              const total = d.partSociale + d.droitAdhesion
              return (
                <div
                  key={d.id}
                  className="rounded-xl bg-white px-4 py-3 text-sm ring-1 ring-amber-100"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-900">
                        {client ? `${client.prenom} ${client.nom}` : 'Client'} — compte{' '}
                        {d.type === 'epargne' ? 'épargne' : 'courant'}
                        {d.promotion ? ' (promo)' : ''}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Demandé par {d.demandeurNom} — {formatDateHeure(d.dateDemande)}
                      </p>
                      <ul className="mt-2 space-y-0.5 text-xs text-slate-700">
                        {total <= 0 ? (
                          <li className="font-semibold text-amber-800">Aucun frais (client ancien)</li>
                        ) : (
                          <>
                            <li>Part sociale : {formatMontant(d.partSociale)}</li>
                            <li>Droit d’adhésion : {formatMontant(d.droitAdhesion)}</li>
                            <li className="font-semibold">Total à encaisser : {formatMontant(total)}</li>
                          </>
                        )}
                      </ul>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn-primary !py-2 text-xs"
                        onClick={async () => {
                          const ok = await confirmer({
                            titre: 'Valider l’ouverture',
                            message: texteConfirmationOuvertureCompte(total),
                            labelValider: 'Valider et créer',
                          })
                          if (!ok) return
                          const err = await validerOuvertureCompte(d.id)
                          if (err) await alerter('Validation impossible', err)
                          else await alerter('Compte ouvert', texteAlerteCompteOuvert(total))
                        }}
                      >
                        Valider
                      </button>
                      <button
                        type="button"
                        className="btn-secondary !py-2 text-xs"
                        onClick={async () => {
                          const ok = await confirmer({
                            titre: 'Refuser la demande',
                            message: 'Refuser cette demande d’ouverture de compte ?',
                            labelValider: 'Refuser',
                            danger: true,
                          })
                          if (!ok) return
                          const err = await refuserOuvertureCompte(d.id, 'Refusée en caisse')
                          if (err) await alerter('Refus impossible', err)
                        }}
                      >
                        Refuser
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

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
      {maCaisse.journeesEnRetard.length > 0 && (
        <div className="mb-6 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
          <p className="font-semibold">Journée(s) précédente(s) non clôturée(s)</p>
          <p className="mt-1">
            {maCaisse.journeesEnRetard.map((j) => formatDate(j + 'T12:00:00')).join(', ')}. La
            journée en cours peut être ouverte et utilisée ; demandez la clôture des jours
            précédents à l’admin ou au chef d’agence.
          </p>
        </div>
      )}

      {!maCaisse.ouverte && (
        <div className="mb-6 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700 ring-1 ring-slate-200">
          Journée non ouverte — l’admin ou le chef d’agence doit saisir le montant d’ouverture avant
          vos opérations.
        </div>
      )}

      {maCaisse.ouverte && !maCaisse.cloturee && (
        <div className="mb-6 rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-800 ring-1 ring-sky-200">
          Journée ouverte — solde d’ouverture {formatMontant(maCaisse.soldeOuverture)}
          {maCaisse.ouvertureDuJour?.ouvertParNom && (
            <span> (par {maCaisse.ouvertureDuJour.ouvertParNom})</span>
          )}
        </div>
      )}

      {maCaisse.cloturee && maCaisse.arretDuJour && (
        <div className="mb-6 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 ring-1 ring-emerald-200">
          Caisse du jour arrêtée — écart <BadgeEcart ecart={maCaisse.arretDuJour.ecart} />
          {maCaisse.arretDuJour.valideParNom && (
            <span className="text-emerald-700"> — par {maCaisse.arretDuJour.valideParNom}</span>
          )}
        </div>
      )}

      {(maCaisse.ouverte || maCaisse.cloturee) && (
        <>
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
        </>
      )}

      <TableauArretsCaisse arrets={arretsPerso} titre="Historique des arrêts" />

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
