import { useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { ArrowDownRight, ArrowLeft, ArrowUpRight, CalendarDays } from 'lucide-react'
import { LIBELLES_ROLE, useStore } from '../store'
import {
  LIBELLES_TYPE,
  TYPES_SORTIE,
  aujourdHuiIso,
  situationCaisse,
  type SituationCaisse,
} from '../metier'
import { formatDate, formatDateHeure, formatMontant } from '../utils'
import { Avatar, EnTetePage, EtatVide } from '../components/ui'

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

export default function DetailCaisse() {
  const { employeId } = useParams()
  const { data, estAdmin, estChefAgence, employeConnecte, agenceFiltreOperations } = useStore()
  const [dateChoisie, setDateChoisie] = useState(aujourdHuiIso())

  const employe = data.employes.find((e) => e.id === employeId)
  const agence = employe ? data.agences.find((a) => a.id === employe.agenceId) : undefined

  const accesOk =
    !!employe &&
    (estAdmin ||
      (estChefAgence && employe.agenceId === agenceFiltreOperations) ||
      employeConnecte?.id === employe.id)

  const situationJour = useMemo(
    () =>
      employe
        ? situationCaisse(employe.id, data.transactions, data.arretsCaisse, aujourdHuiIso())
        : null,
    [employe, data.transactions, data.arretsCaisse],
  )

  const situationFiltre = useMemo(
    () =>
      employe
        ? situationCaisse(employe.id, data.transactions, data.arretsCaisse, dateChoisie)
        : null,
    [employe, data.transactions, data.arretsCaisse, dateChoisie],
  )

  const estAujourdhui = dateChoisie === aujourdHuiIso()

  if (!employeConnecte) return null

  if (!estAdmin && !estChefAgence && employeConnecte.id !== employeId) {
    return <Navigate to="/caisse" replace />
  }

  if (!employe || !accesOk) {
    return (
      <div>
        <Link to="/caisse" className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-brand-600">
          <ArrowLeft className="h-4 w-4" />
          Retour aux caisses
        </Link>
        <p className="text-slate-600">Caisse introuvable ou accès non autorisé.</p>
      </div>
    )
  }

  if (!situationJour || !situationFiltre) return null

  const [prenom, ...reste] = employe.nomComplet.split(' ')
  const nom = reste.join(' ') || prenom

  return (
    <div>
      <Link
        to="/caisse"
        className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-brand-600 hover:text-brand-700"
      >
        <ArrowLeft className="h-4 w-4" />
        Retour au suivi des caisses
      </Link>

      <EnTetePage
        titre={`Caisse — ${employe.nomComplet}`}
        sousTitre={`${LIBELLES_ROLE[employe.role]}${agence ? ` · ${agence.nom}` : ''}`}
      />

      <div className="card mb-6 flex flex-wrap items-center gap-4">
        <Avatar nom={nom} prenom={prenom} taille="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-900">{employe.nomComplet}</h2>
            <BadgeStatutCaisse situation={situationJour} />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Identifiant {employe.identifiant}
            {employe.telephone ? ` · ${employe.telephone}` : ''}
          </p>
          {situationJour.journeesEnRetard.length > 0 && (
            <p className="mt-2 text-sm text-rose-700">
              Jours en retard :{' '}
              {situationJour.journeesEnRetard.map((j) => formatDate(j + 'T12:00:00')).join(', ')}
            </p>
          )}
        </div>
      </div>

      {/* État actuel — date du jour */}
      <div className="mb-6">
        <h3 className="mb-3 font-semibold text-slate-900">
          État actuel — {formatDate(aujourdHuiIso() + 'T12:00:00')}
        </h3>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="card">
            <div className="text-xs text-slate-500">Statut</div>
            <div className="mt-1">
              <BadgeStatutCaisse situation={situationJour} />
            </div>
          </div>
          <div className="card">
            <div className="text-xs text-slate-500">Entrées</div>
            <div className="mt-1 text-lg font-bold text-emerald-600">
              {formatMontant(situationJour.totalEntrees)}
            </div>
          </div>
          <div className="card">
            <div className="text-xs text-slate-500">Sorties</div>
            <div className="mt-1 text-lg font-bold text-rose-600">
              {formatMontant(situationJour.totalSorties)}
            </div>
          </div>
          <div className="card">
            <div className="text-xs text-slate-500">Solde théorique</div>
            <div className="mt-1 text-lg font-bold text-brand-700">
              {formatMontant(situationJour.soldeTheorique)}
            </div>
            <div className="text-xs text-slate-500">{situationJour.nombreOperations} op.</div>
          </div>
        </div>
        {situationJour.arretDuJour && (
          <p className="mt-3 text-sm text-slate-600">
            Arrêt du jour validé — écart <BadgeEcart ecart={situationJour.arretDuJour.ecart} />
          </p>
        )}
      </div>

      {/* Filtre date + historique */}
      <div className="card mb-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-slate-900">État et historique par date</h3>
            <p className="text-xs text-slate-500">
              {estAujourdhui
                ? 'Affichage de la journée en cours'
                : `Affichage du ${formatDate(dateChoisie + 'T12:00:00')}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CalendarDays className="h-4 w-4 text-slate-400" />
            <label className="text-sm text-slate-600">Filtrer par date</label>
            <input
              className="input !w-auto"
              type="date"
              value={dateChoisie}
              max={aujourdHuiIso()}
              onChange={(e) => setDateChoisie(e.target.value)}
            />
            {!estAujourdhui && (
              <button
                type="button"
                className="btn-secondary !py-2 text-xs"
                onClick={() => setDateChoisie(aujourdHuiIso())}
              >
                Aujourd’hui
              </button>
            )}
          </div>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl bg-slate-50 px-3 py-2">
            <div className="text-xs text-slate-500">Statut</div>
            <div className="mt-0.5">
              <BadgeStatutCaisse situation={situationFiltre} />
            </div>
          </div>
          <div className="rounded-xl bg-emerald-50 px-3 py-2">
            <div className="text-xs text-emerald-700">Entrées</div>
            <div className="font-bold text-emerald-800">
              {formatMontant(situationFiltre.totalEntrees)}
            </div>
          </div>
          <div className="rounded-xl bg-rose-50 px-3 py-2">
            <div className="text-xs text-rose-700">Sorties</div>
            <div className="font-bold text-rose-800">
              {formatMontant(situationFiltre.totalSorties)}
            </div>
          </div>
          <div className="rounded-xl bg-brand-50 px-3 py-2">
            <div className="text-xs text-brand-700">Solde</div>
            <div className="font-bold text-brand-800">
              {formatMontant(situationFiltre.soldeTheorique)}
            </div>
          </div>
        </div>

        {situationFiltre.arretDuJour && (
          <div className="mb-4 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700">
            Arrêt enregistré le {formatDateHeure(situationFiltre.arretDuJour.date)} — compté{' '}
            {formatMontant(situationFiltre.arretDuJour.montantCompte)} — écart{' '}
            <BadgeEcart ecart={situationFiltre.arretDuJour.ecart} />
            {situationFiltre.arretDuJour.note && (
              <span className="text-slate-500"> — {situationFiltre.arretDuJour.note}</span>
            )}
          </div>
        )}

        <h4 className="mb-2 text-sm font-semibold text-slate-800">
          Historique des opérations ({situationFiltre.nombreOperations})
        </h4>
        {situationFiltre.transactions.length === 0 ? (
          <EtatVide
            titre="Aucune opération"
            description={`Pas d’opération le ${formatDate(dateChoisie + 'T12:00:00')}.`}
          />
        ) : (
          <div className="max-h-[28rem] divide-y divide-slate-100 overflow-y-auto">
            {situationFiltre.transactions.map((t) => {
              const sortie = TYPES_SORTIE.includes(t.type)
              return (
                <div key={t.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                      sortie ? 'bg-rose-100 text-rose-600' : 'bg-emerald-100 text-emerald-600'
                    }`}
                  >
                    {sortie ? (
                      <ArrowUpRight className="h-4 w-4" />
                    ) : (
                      <ArrowDownRight className="h-4 w-4" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-800">{t.description}</p>
                    <p className="text-xs text-slate-500">
                      {formatDateHeure(t.date)} — {LIBELLES_TYPE[t.type]}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 font-bold ${sortie ? 'text-rose-600' : 'text-emerald-600'}`}
                  >
                    {sortie ? '−' : '+'}
                    {formatMontant(t.montant)}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
