import { useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { ArrowLeft, Banknote, DoorOpen, Scale } from 'lucide-react'
import { LIBELLES_ROLE, useStore } from '../store'
import {
  aujourdHuiIso,
  compteCaisseDe,
  journeesOuvertesEnAttenteCloture,
  situationCaisse,
  type SituationCaisse,
} from '../metier'
import { formatDate, formatMontant } from '../utils'
import { Avatar, EnTetePage, Modale } from '../components/ui'
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
    regulariserCumulCompteCaisse,
  } = useStore()
  const { alerter } = useConfirmation()
  const [modaleOuverture, setModaleOuverture] = useState(false)
  const [modaleArret, setModaleArret] = useState(false)
  const [modaleAlim, setModaleAlim] = useState(false)
  const [modaleRegulariser, setModaleRegulariser] = useState(false)
  const [montantOuverture, setMontantOuverture] = useState('')
  const [noteOuverture, setNoteOuverture] = useState('')
  const [montantFermeture, setMontantFermeture] = useState('')
  const [montantAlim, setMontantAlim] = useState('')
  const [noteAlim, setNoteAlim] = useState('')
  const [noteArret, setNoteArret] = useState('')
  const [typeRegulariser, setTypeRegulariser] = useState<'manquant' | 'surplus'>('manquant')
  const [montantRegulariser, setMontantRegulariser] = useState('')
  const [motifRegulariser, setMotifRegulariser] = useState('')
  const [erreurRegulariser, setErreurRegulariser] = useState('')

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

  const arretsHistorique = useMemo(() => {
    if (!employe) return []
    return data.arretsCaisse.filter((a) => a.employeId === employe.id)
  }, [employe, data.arretsCaisse])

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

  const validerRegularisation = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!employe) return
    setErreurRegulariser('')
    const err = regulariserCumulCompteCaisse(
      employe.id,
      typeRegulariser,
      Number(montantRegulariser),
      motifRegulariser,
    )
    if (err) {
      setErreurRegulariser(err)
      return
    }
    setModaleRegulariser(false)
    setMontantRegulariser('')
    setMotifRegulariser('')
    await alerter(
      'Régularisation enregistrée',
      `Cumul ${typeRegulariser} mis à jour pour ${employe.nomComplet}.`,
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

  if (!situationJour || !caisseATraiter) return null

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

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="card border-brand-200 bg-brand-50/40">
          <div className="text-xs font-medium uppercase tracking-wide text-brand-700">
            Solde du compte caisse
          </div>
          <div className="mt-1 text-2xl font-bold text-brand-800">
            {formatMontant(compteCaisse?.solde ?? 0)}
          </div>
          {compteCaisse && (
            <p className="mt-1 text-xs text-slate-500">Compte {compteCaisse.numero}</p>
          )}
        </div>
        <div className="rounded-xl bg-rose-50 px-4 py-3 ring-1 ring-rose-100">
          <div className="text-xs font-medium uppercase text-rose-700">Cumul manquant</div>
          <div className="mt-1 text-2xl font-bold text-rose-900">
            {formatMontant(compteCaisse?.cumulManquant ?? 0)}
          </div>
        </div>
        <div className="rounded-xl bg-sky-50 px-4 py-3 ring-1 ring-sky-100">
          <div className="text-xs font-medium uppercase text-sky-700">Cumul surplus</div>
          <div className="mt-1 text-2xl font-bold text-sky-900">
            {formatMontant(compteCaisse?.cumulSurplus ?? 0)}
          </div>
        </div>
      </div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          Cumuls uniques toutes dates : chaque clôture avec écart y ajoute le manquant ou le surplus.
          {estAdmin ? ' Seul l’admin peut régulariser.' : ''}
        </p>
        {estAdmin && (
          <button
            type="button"
            className="btn-secondary !py-2 text-xs"
            onClick={() => {
              setTypeRegulariser((compteCaisse?.cumulManquant ?? 0) > 0 ? 'manquant' : 'surplus')
              setMontantRegulariser('')
              setMotifRegulariser('')
              setErreurRegulariser('')
              setModaleRegulariser(true)
            }}
          >
            Régulariser
          </button>
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
        {situationJour.ouverte || situationJour.cloturee ? (
          <>
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
          </>
        ) : (
          <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700 ring-1 ring-slate-200">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500">Statut</span>
              <BadgeStatutCaisse situation={situationJour} />
            </div>
            Journée non ouverte — l’état (ouverture, entrées, sorties, fermeture théorique) s’affiche
            après l’ouverture de la caisse.
          </div>
        )}
      </div>

      <div className="mb-6">
        <TableauArretsCaisse
          arrets={arretsHistorique}
          titre="État et historique des clôtures"
        />
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

      {estAdmin && (
        <Modale
          titre={`Régulariser — ${employe.nomComplet}`}
          ouverte={modaleRegulariser}
          onFermer={() => setModaleRegulariser(false)}
        >
          <form onSubmit={validerRegularisation} className="space-y-4">
            <p className="text-sm text-slate-600">
              Réduit le cumul manquant ou surplus (toutes dates). Le solde de caisse n’est pas modifié.
            </p>
            <div>
              <label className="label">Cumul *</label>
              <select
                className="input"
                value={typeRegulariser}
                onChange={(e) => setTypeRegulariser(e.target.value as 'manquant' | 'surplus')}
              >
                <option value="manquant">
                  Manquant ({formatMontant(compteCaisse?.cumulManquant ?? 0)})
                </option>
                <option value="surplus">
                  Surplus ({formatMontant(compteCaisse?.cumulSurplus ?? 0)})
                </option>
              </select>
            </div>
            <div>
              <label className="label">Montant à régulariser *</label>
              <input
                className="input"
                type="number"
                min={1}
                required
                autoFocus
                value={montantRegulariser}
                onChange={(e) => setMontantRegulariser(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Motif *</label>
              <input
                className="input"
                required
                value={motifRegulariser}
                onChange={(e) => setMotifRegulariser(e.target.value)}
                placeholder="Ex. Erreur de comptage corrigée"
              />
            </div>
            {erreurRegulariser && <p className="text-sm text-rose-600">{erreurRegulariser}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setModaleRegulariser(false)}
              >
                Annuler
              </button>
              <button type="submit" className="btn-primary">
                Valider la régularisation
              </button>
            </div>
          </form>
        </Modale>
      )}
    </div>
  )
}
