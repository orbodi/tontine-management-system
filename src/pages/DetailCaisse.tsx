import { useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  Banknote,
  CalendarDays,
  DoorOpen,
  Scale,
} from 'lucide-react'
import { LIBELLES_ROLE, useStore } from '../store'
import {
  LIBELLES_TYPE,
  TYPES_SORTIE,
  aujourdHuiIso,
  compteCaisseDe,
  dateClotureArret,
  journeesOuvertesEnAttenteCloture,
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

export default function DetailCaisse() {
  const { employeId } = useParams()
  const {
    data,
    estAdmin,
    estChefAgence,
    employeConnecte,
    agenceFiltreOperations,
    ouvrirJourneeCaisse,
    arreterCaisse,
    alimenterCompteCaisse,
  } = useStore()
  const { alerter } = useConfirmation()
  const [dateChoisie, setDateChoisie] = useState(aujourdHuiIso())
  const [modaleOuverture, setModaleOuverture] = useState(false)
  const [modaleArret, setModaleArret] = useState(false)
  const [modaleAlim, setModaleAlim] = useState(false)
  const [montantOuverture, setMontantOuverture] = useState('')
  const [noteOuverture, setNoteOuverture] = useState('')
  const [montantFermeture, setMontantFermeture] = useState('')
  const [montantAlim, setMontantAlim] = useState('')
  const [noteAlim, setNoteAlim] = useState('')
  const [noteArret, setNoteArret] = useState('')

  const employe = data.employes.find((e) => e.id === employeId)
  const agence = employe ? data.agences.find((a) => a.id === employe.agenceId) : undefined
  const peutGerer = estAdmin || estChefAgence

  const compteCaisse = employe ? compteCaisseDe(data.comptesCaisse, employe.id) : undefined

  const accesOk =
    !!employe &&
    (estAdmin ||
      (estChefAgence && employe.agenceId === agenceFiltreOperations) ||
      employeConnecte?.id === employe.id)

  const situationJour = useMemo(
    () =>
      employe
        ? situationCaisse(
            employe.id,
            data.transactions,
            data.arretsCaisse,
            aujourdHuiIso(),
            data.comptesCaisse,
            data.mouvementsCompteCaisse,
            data.ouverturesCaisse ?? [],
          )
        : null,
    [
      employe,
      data.transactions,
      data.arretsCaisse,
      data.comptesCaisse,
      data.mouvementsCompteCaisse,
      data.ouverturesCaisse,
    ],
  )

  const situationFiltre = useMemo(
    () =>
      employe
        ? situationCaisse(
            employe.id,
            data.transactions,
            data.arretsCaisse,
            dateChoisie,
            data.comptesCaisse,
            data.mouvementsCompteCaisse,
            data.ouverturesCaisse ?? [],
          )
        : null,
    [
      employe,
      data.transactions,
      data.arretsCaisse,
      data.comptesCaisse,
      data.mouvementsCompteCaisse,
      data.ouverturesCaisse,
      dateChoisie,
    ],
  )

  const jourATraiter = situationJour?.journeesEnRetard[0] ?? aujourdHuiIso()

  const caisseATraiter = useMemo(
    () =>
      employe
        ? situationCaisse(
            employe.id,
            data.transactions,
            data.arretsCaisse,
            jourATraiter,
            data.comptesCaisse,
            data.mouvementsCompteCaisse,
            data.ouverturesCaisse ?? [],
          )
        : null,
    [
      employe,
      data.transactions,
      data.arretsCaisse,
      data.comptesCaisse,
      data.mouvementsCompteCaisse,
      data.ouverturesCaisse,
      jourATraiter,
    ],
  )

  const estAujourdhui = dateChoisie === aujourdHuiIso()
  const enRetard = (situationJour?.journeesEnRetard.length ?? 0) > 0
  const joursEnAttenteCloture = employe
    ? journeesOuvertesEnAttenteCloture(
        employe.id,
        data.ouverturesCaisse ?? [],
        data.arretsCaisse,
        aujourdHuiIso(),
      )
    : []
  const doitCloturerAvantOuverture = joursEnAttenteCloture.length > 0
  const peutOuvrir =
    peutGerer &&
    !!caisseATraiter &&
    !caisseATraiter.ouverte &&
    !caisseATraiter.cloturee &&
    !doitCloturerAvantOuverture
  const peutCloturer =
    peutGerer && !!caisseATraiter && caisseATraiter.ouverte && !caisseATraiter.cloturee
  const ecartPrevu =
    montantFermeture === '' || !caisseATraiter
      ? null
      : Number(montantFermeture) - caisseATraiter.soldeFermetureTheorique

  const validerOuverture = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!employe) return
    const montant = Number(montantOuverture)
    const err = ouvrirJourneeCaisse(
      employe.id,
      montant,
      noteOuverture.trim() || undefined,
      jourATraiter,
    )
    if (err) {
      await alerter('Ouverture impossible', err)
      return
    }
    setModaleOuverture(false)
    setMontantOuverture('')
    setNoteOuverture('')
    await alerter(
      'Journée ouverte',
      `Ouverture enregistrée pour ${employe.nomComplet} — ${formatDate(jourATraiter + 'T12:00:00')} — ${formatMontant(montant)}.`,
    )
  }

  const validerArret = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!employe) return
    const err = arreterCaisse(
      Number(montantFermeture),
      noteArret.trim() || undefined,
      jourATraiter,
      employe.id,
    )
    if (err) {
      await alerter('Clôture impossible', err)
      return
    }
    setModaleArret(false)
    setMontantFermeture('')
    setNoteArret('')
    await alerter(
      'Clôture enregistrée',
      `La caisse de ${employe.nomComplet} pour le ${formatDate(jourATraiter + 'T12:00:00')} a été clôturée.`,
    )
  }

  const validerAlimentation = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!employe) return
    const montant = Number(montantAlim)
    const err = alimenterCompteCaisse(employe.id, montant, noteAlim.trim() || undefined)
    if (err) {
      await alerter('Alimentation impossible', err)
      return
    }
    setModaleAlim(false)
    setMontantAlim('')
    setNoteAlim('')
    await alerter(
      'Alimentation enregistrée',
      `Le compte caisse de ${employe.nomComplet} a été crédité de ${formatMontant(montant)}.`,
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

  if (!situationJour || !situationFiltre || !caisseATraiter) return null

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
          peutGerer ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setMontantAlim('')
                  setNoteAlim('')
                  setModaleAlim(true)
                }}
              >
                <Banknote className="h-4 w-4" />
                Alimenter
              </button>
              {peutOuvrir && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    setMontantOuverture(
                      String(compteCaisseDe(data.comptesCaisse, employe.id)?.solde ?? 0),
                    )
                    setNoteOuverture('')
                    setModaleOuverture(true)
                  }}
                >
                  <DoorOpen className="h-4 w-4" />
                  {enRetard
                    ? `Ouvrir le ${formatDate(jourATraiter + 'T12:00:00')}`
                    : 'Ouvrir la journée'}
                </button>
              )}
              {peutCloturer && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    setMontantFermeture(String(caisseATraiter.soldeFermetureTheorique))
                    setNoteArret('')
                    setModaleArret(true)
                  }}
                >
                  <Scale className="h-4 w-4" />
                  {enRetard
                    ? `Clôturer le ${formatDate(jourATraiter + 'T12:00:00')}`
                    : 'Clôturer la journée'}
                </button>
              )}
            </div>
          ) : undefined
        }
      />

      <div className="card mb-6 border-brand-200 bg-brand-50/40">
        <div className="text-xs font-medium uppercase tracking-wide text-brand-700">
          Solde du compte caisse
        </div>
        <div className="mt-1 text-3xl font-bold text-brand-800">
          {formatMontant(compteCaisse?.solde ?? 0)}
        </div>
        {compteCaisse && (
          <p className="mt-1 text-xs text-slate-500">
            Compte {compteCaisse.numero} — mis à jour automatiquement
          </p>
        )}
      </div>

      {doitCloturerAvantOuverture && (
        <div className="mb-6 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
          Impossible d’ouvrir une nouvelle journée tant que le{' '}
          {formatDate(joursEnAttenteCloture[0] + 'T12:00:00')} n’est pas clôturé.
        </div>
      )}
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
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <div className="card">
            <div className="text-xs text-slate-500">Statut</div>
            <div className="mt-1">
              <BadgeStatutCaisse situation={situationJour} />
            </div>
          </div>
          <div className="card">
            <div className="text-xs text-slate-500">Ouverture</div>
            <div className="mt-1 text-lg font-bold text-slate-800">
              {formatMontant(situationJour.soldeOuverture)}
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
            <div className="text-xs text-slate-500">Fermeture théorique</div>
            <div className="mt-1 text-lg font-bold text-brand-700">
              {formatMontant(situationJour.soldeFermetureTheorique)}
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

        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div className="rounded-xl bg-slate-50 px-3 py-2">
            <div className="text-xs text-slate-500">Statut</div>
            <div className="mt-0.5">
              <BadgeStatutCaisse situation={situationFiltre} />
            </div>
          </div>
          <div className="rounded-xl bg-slate-50 px-3 py-2">
            <div className="text-xs text-slate-500">Ouverture</div>
            <div className="font-bold text-slate-800">
              {formatMontant(situationFiltre.soldeOuverture)}
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
            <div className="text-xs text-brand-700">Fermeture th.</div>
            <div className="font-bold text-brand-800">
              {formatMontant(situationFiltre.soldeFermetureTheorique)}
            </div>
          </div>
        </div>

        {situationFiltre.arretDuJour && (
          <div className="mb-4 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700">
            Arrêt enregistré le {formatDateHeure(dateClotureArret(situationFiltre.arretDuJour))} —
            ouverture {formatMontant(situationFiltre.arretDuJour.soldeOuverture ?? 0)} — fermeture th.{' '}
            {formatMontant(situationFiltre.arretDuJour.soldeTheorique)} — compté{' '}
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

      {peutGerer && (
        <Modale
          titre={`Ouverture — ${employe.nomComplet} — ${formatDate(jourATraiter + 'T12:00:00')}`}
          ouverte={modaleOuverture}
          onFermer={() => setModaleOuverture(false)}
        >
          <form onSubmit={validerOuverture} className="space-y-4">
            <p className="text-sm text-slate-600">
              Saisissez le montant d’ouverture (espèces en caisse au début de la journée). Le solde
              du compte caisse sera aligné sur ce montant.
            </p>
            <div className="rounded-xl bg-slate-50 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Solde compte actuel</span>
                <span className="font-bold text-brand-700">
                  {formatMontant(compteCaisse?.solde ?? 0)}
                </span>
              </div>
            </div>
            <div>
              <label className="label">Montant d’ouverture (FCFA) *</label>
              <input
                className="input"
                type="number"
                min={0}
                required
                autoFocus
                value={montantOuverture}
                onChange={(e) => setMontantOuverture(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Note (optionnel)</label>
              <input
                className="input"
                value={noteOuverture}
                onChange={(e) => setNoteOuverture(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setModaleOuverture(false)}
              >
                Annuler
              </button>
              <button type="submit" className="btn-primary">
                Valider l&apos;ouverture
              </button>
            </div>
          </form>
        </Modale>
      )}

      {peutGerer && (
        <Modale
          titre={`Clôture — ${employe.nomComplet} — ${formatDate(jourATraiter + 'T12:00:00')}`}
          ouverte={modaleArret}
          onFermer={() => setModaleArret(false)}
        >
          <form onSubmit={validerArret} className="space-y-4">
            <p className="text-sm text-slate-600">
              Saisissez le montant de fermeture (espèces comptées en fin de journée).
            </p>
            <div className="rounded-xl bg-slate-50 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Solde à l’ouverture</span>
                <span className="font-semibold">{formatMontant(caisseATraiter.soldeOuverture)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Opérations</span>
                <span className="font-semibold">{caisseATraiter.nombreOperations}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Entrées</span>
                <span className="font-semibold text-emerald-600">
                  {formatMontant(caisseATraiter.totalEntrees)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Sorties</span>
                <span className="font-semibold text-rose-600">
                  {formatMontant(caisseATraiter.totalSorties)}
                </span>
              </div>
              <div className="mt-1 flex justify-between border-t border-slate-200 pt-1">
                <span className="font-semibold text-slate-700">Fermeture théorique</span>
                <span className="font-bold text-brand-700">
                  {formatMontant(caisseATraiter.soldeFermetureTheorique)}
                </span>
              </div>
            </div>
            <div>
              <label className="label">Montant de fermeture (FCFA) *</label>
              <input
                className="input"
                type="number"
                min={0}
                required
                autoFocus
                value={montantFermeture}
                onChange={(e) => setMontantFermeture(e.target.value)}
              />
            </div>
            {ecartPrevu !== null && (
              <div
                className={`rounded-xl p-3 text-sm font-semibold ${
                  ecartPrevu === 0
                    ? 'bg-emerald-50 text-emerald-700'
                    : ecartPrevu > 0
                      ? 'bg-sky-50 text-sky-700'
                      : 'bg-rose-50 text-rose-700'
                }`}
              >
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
                Valider la clôture
              </button>
            </div>
          </form>
        </Modale>
      )}

      {peutGerer && (
        <Modale
          titre={`Alimenter — ${employe.nomComplet}`}
          ouverte={modaleAlim}
          onFermer={() => setModaleAlim(false)}
        >
          <form onSubmit={validerAlimentation} className="space-y-4">
            <p className="text-sm text-slate-600">
              Créditez le compte caisse (espèces remises au caissier). Le solde est mis à jour
              immédiatement.
            </p>
            <div className="rounded-xl bg-slate-50 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Solde actuel</span>
                <span className="font-bold text-brand-700">
                  {formatMontant(compteCaisse?.solde ?? 0)}
                </span>
              </div>
              {compteCaisse && (
                <div className="mt-1 flex justify-between text-xs text-slate-500">
                  <span>N° compte</span>
                  <span>{compteCaisse.numero}</span>
                </div>
              )}
            </div>
            <div>
              <label className="label">Montant (FCFA) *</label>
              <input
                className="input"
                type="number"
                min={1}
                required
                autoFocus
                value={montantAlim}
                onChange={(e) => setMontantAlim(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Note (optionnel)</label>
              <input
                className="input"
                value={noteAlim}
                onChange={(e) => setNoteAlim(e.target.value)}
                placeholder="Ex. Fond de caisse du matin"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setModaleAlim(false)}>
                Annuler
              </button>
              <button type="submit" className="btn-primary">
                Valider l&apos;alimentation
              </button>
            </div>
          </form>
        </Modale>
      )}
    </div>
  )
}
