import { useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  Banknote,
  CalendarDays,
  CheckCircle2,
  Scale,
} from 'lucide-react'
import { LIBELLES_ROLE, useStore } from '../store'
import {
  LIBELLES_TYPE,
  TYPES_SORTIE,
  aujourdHuiIso,
  situationCaisse,
  type SituationCaisse,
} from '../metier'
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

export default function DetailCaisse() {
  const { employeId } = useParams()
  const {
    data,
    estAdmin,
    estChefAgence,
    employeConnecte,
    agenceFiltreOperations,
    arreterCaisse,
  } = useStore()
  const { alerter } = useConfirmation()
  const [dateChoisie, setDateChoisie] = useState(aujourdHuiIso())
  const [modaleArret, setModaleArret] = useState(false)
  const [montantCompte, setMontantCompte] = useState('')
  const [noteArret, setNoteArret] = useState('')

  const employe = data.employes.find((e) => e.id === employeId)
  const agence = employe ? data.agences.find((a) => a.id === employe.agenceId) : undefined
  const peutArreter = estAdmin || estChefAgence

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

  const jourAArreter = situationJour?.journeesEnRetard[0] ?? aujourdHuiIso()

  const caisseAArreter = useMemo(
    () =>
      employe
        ? situationCaisse(employe.id, data.transactions, data.arretsCaisse, jourAArreter)
        : null,
    [employe, data.transactions, data.arretsCaisse, jourAArreter],
  )

  const estAujourdhui = dateChoisie === aujourdHuiIso()
  const enRetard = (situationJour?.journeesEnRetard.length ?? 0) > 0
  const arretDejaFait = !!situationJour?.cloturee && !enRetard
  const ecartPrevu =
    montantCompte === '' || !caisseAArreter
      ? null
      : Number(montantCompte) - caisseAArreter.soldeTheorique

  const validerArret = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!employe) return
    const err = arreterCaisse(
      Number(montantCompte),
      noteArret.trim() || undefined,
      jourAArreter,
      employe.id,
    )
    if (err) {
      await alerter('Arrêt impossible', err)
      return
    }
    setModaleArret(false)
    setMontantCompte('')
    setNoteArret('')
    await alerter(
      'Arrêt de caisse enregistré',
      `La caisse de ${employe.nomComplet} pour le ${formatDate(jourAArreter + 'T12:00:00')} a été clôturée.`,
    )
  }

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

  if (!situationJour || !situationFiltre || !caisseAArreter) return null

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
        action={
          peutArreter ? (
            <button
              className="btn-primary"
              disabled={arretDejaFait}
              onClick={() => {
                setMontantCompte('')
                setNoteArret('')
                setModaleArret(true)
              }}
              title={
                arretDejaFait
                  ? 'Caisse du jour déjà arrêtée'
                  : `Arrêter la caisse du ${jourAArreter}`
              }
            >
              <Scale className="h-4 w-4" />
              {enRetard
                ? `Arrêter le ${formatDate(jourAArreter + 'T12:00:00')}`
                : arretDejaFait
                  ? 'Caisse du jour arrêtée'
                  : 'Arrêt de caisse du jour'}
            </button>
          ) : undefined
        }
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
            {situationJour.arretDuJour.valideParNom && (
              <> — par {situationJour.arretDuJour.valideParNom}</>
            )}
          </p>
        )}
      </div>

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
            {situationFiltre.arretDuJour.valideParNom && (
              <span className="text-slate-500">
                {' '}
                — par {situationFiltre.arretDuJour.valideParNom}
              </span>
            )}
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

      {peutArreter && (
        <Modale
          titre={`Arrêt de caisse — ${employe.nomComplet} — ${formatDate(jourAArreter + 'T12:00:00')}`}
          ouverte={modaleArret}
          onFermer={() => setModaleArret(false)}
        >
          <form onSubmit={validerArret} className="space-y-4">
            <p className="text-sm text-slate-600">
              {enRetard
                ? 'Clôture d’une journée en retard. Saisissez les espèces comptées pour cette journée.'
                : 'Clôture de la caisse du jour. Saisissez les espèces comptées.'}
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
              <input
                className="input"
                value={noteArret}
                onChange={(e) => setNoteArret(e.target.value)}
              />
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
      )}
    </div>
  )
}
