import { useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { ArrowLeft, Banknote, DoorOpen, Pencil, RotateCcw, Scale, Snowflake, Undo2 } from 'lucide-react'
import { useStore } from '../store'
import {
  aujourdHuiIso,
  compteCaissePourEmploye,
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
    annulerOuvertureJourneeCaisse,
    arreterCaisse,
    annulerClotureCaisse,
    alimenterCompteCaisse,
    gelerCompteCaisse,
    regulariserCumulCompteCaisse,
    corrigerJourneeCaisse,
    rouvrirJourneeCaisse,
  } = useStore()
  const { alerter, confirmer } = useConfirmation()
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
  const [modaleGel, setModaleGel] = useState(false)
  const [motifGel, setMotifGel] = useState('')
  const [confirmationGel, setConfirmationGel] = useState('')
  const [erreurGel, setErreurGel] = useState('')
  const [jourCibleCloture, setJourCibleCloture] = useState(aujourdHuiIso)
  // Correction admin d'une journée (ouverture et / ou montant compté)
  const [correction, setCorrection] = useState<{
    journee: string
    ouverture: number
    /** Présents si la journée est clôturée. */
    compte?: number
    theorique?: number
  } | null>(null)
  const [corrOuverture, setCorrOuverture] = useState('')
  const [corrCompte, setCorrCompte] = useState('')
  const [corrMotif, setCorrMotif] = useState('')
  const [corrErreur, setCorrErreur] = useState('')
  const [corrEnvoi, setCorrEnvoi] = useState(false)
  // Réouverture d'une journée clôturée (complément de saisie)
  const [reouverture, setReouverture] = useState<string | null>(null)
  const [reouvMotif, setReouvMotif] = useState('')
  const [reouvErreur, setReouvErreur] = useState('')
  const [reouvEnvoi, setReouvEnvoi] = useState(false)

  const employe = data.employes.find((e) => e.id === employeId)
  const titulaireCaisse =
    employe?.role === 'chef_agence'
      ? data.employes.find(
          (e) => e.actif && e.role === 'caissier' && e.agenceId === employe.agenceId,
        )
      : employe
  const agence = titulaireCaisse
    ? data.agences.find((a) => a.id === titulaireCaisse.agenceId)
    : undefined
  const peutGerer = estAdmin || estChefAgence

  const compteCaisse = titulaireCaisse
    ? compteCaissePourEmploye(data.comptesCaisse, titulaireCaisse.id, data.employes)
    : undefined

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
            data.employes,
          )
        : null,
    [
      employe,
      data.transactions,
      data.arretsCaisse,
      data.comptesCaisse,
      data.mouvementsCompteCaisse,
      data.ouverturesCaisse,
      data.employes,
    ],
  )

  const jourOuverture = aujourdHuiIso()
  const joursRattrapage = situationJour?.journeesEnRetard ?? []

  const caisseACloturer = useMemo(
    () =>
      employe
        ? situationCaisse(
            employe.id,
            data.transactions,
            data.arretsCaisse,
            jourCibleCloture,
            data.comptesCaisse,
            data.mouvementsCompteCaisse,
            data.ouverturesCaisse ?? [],
            data.employes,
          )
        : null,
    [
      employe,
      data.transactions,
      data.arretsCaisse,
      data.comptesCaisse,
      data.mouvementsCompteCaisse,
      data.ouverturesCaisse,
      data.employes,
      jourCibleCloture,
    ],
  )

  const peutOuvrir =
    peutGerer && !!situationJour && !situationJour.ouverte && !situationJour.cloturee
  const peutCloturerAujourdhui =
    peutGerer && !!situationJour && situationJour.ouverte && !situationJour.cloturee
  /** Une journée ne peut être clôturée que si la caisse de l'agence a été ouverte à cette date. */
  const journeeCaisseOuverte = (jour: string) =>
    !!employe &&
    (data.ouverturesCaisse ?? []).some((o) => o.agenceId === employe.agenceId && o.journee === jour)
  const ouvrirModaleCloture = (jour: string) => {
    if (!employe) return
    if (!journeeCaisseOuverte(jour)) {
      void alerter(
        'Clôture impossible',
        `Aucune ouverture de caisse le ${formatDate(jour + 'T12:00:00')} : cette journée ne peut pas être clôturée.`,
      )
      return
    }
    const sit = situationCaisse(
      employe.id,
      data.transactions,
      data.arretsCaisse,
      jour,
      data.comptesCaisse,
      data.mouvementsCompteCaisse,
      data.ouverturesCaisse ?? [],
      data.employes,
    )
    setJourCibleCloture(jour)
    setMontantFermeture(String(sit.soldeFermetureTheorique))
    setNoteArret('')
    setModaleArret(true)
  }
  const ecartPrevu =
    montantFermeture === '' || !caisseACloturer
      ? null
      : Number(montantFermeture) - caisseACloturer.soldeFermetureTheorique

  const arretsHistorique = useMemo(() => {
    if (!employe) return []
    return data.arretsCaisse.filter((a) => a.agenceId === employe.agenceId)
  }, [employe, data.arretsCaisse])

  /** Admin : corriger l'ouverture (et le montant compté si la journée est clôturée). */
  const ouvrirCorrection = (journee: string) => {
    if (!employe) return
    const ouverture = (data.ouverturesCaisse ?? []).find(
      (o) => o.agenceId === employe.agenceId && o.journee === journee,
    )
    const arret = data.arretsCaisse.find((a) => a.agenceId === employe.agenceId && a.journee === journee)
    if (!ouverture) {
      void alerter('Correction impossible', `Aucune ouverture de caisse le ${formatDate(journee + 'T12:00:00')}.`)
      return
    }
    setCorrection({
      journee,
      ouverture: ouverture.soldeOuverture,
      compte: arret?.montantCompte,
      theorique: arret?.soldeTheorique,
    })
    setCorrOuverture(String(ouverture.soldeOuverture))
    setCorrCompte(arret ? String(arret.montantCompte) : '')
    setCorrMotif('')
    setCorrErreur('')
  }

  const ouvrirReouverture = (journee: string) => {
    setReouverture(journee)
    setReouvMotif('')
    setReouvErreur('')
  }

  const validerReouverture = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!employe || !reouverture) return
    if (!reouvMotif.trim()) {
      setReouvErreur('Le motif est obligatoire.')
      return
    }
    setReouvEnvoi(true)
    const err = await rouvrirJourneeCaisse(employe.id, reouverture, reouvMotif.trim())
    setReouvEnvoi(false)
    if (err) {
      setReouvErreur(err)
      return
    }
    const jour = reouverture
    setReouverture(null)
    await alerter(
      'Journée rouverte',
      `La journée du ${formatDate(jour + 'T12:00:00')} est de nouveau ouverte. Ses opérations sont conservées.\n` +
        'Faites le complément de saisie (collecte de ce jour), puis clôturez-la à nouveau avec le nouveau comptage.',
    )
  }

  const validerCorrection = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!employe || !correction) return
    const ouv = Number(corrOuverture)
    const compte = correction.compte !== undefined ? Number(corrCompte) : undefined
    if (corrOuverture === '' || !Number.isFinite(ouv) || ouv < 0) {
      setCorrErreur('Solde d’ouverture invalide.')
      return
    }
    if (compte !== undefined && (corrCompte === '' || !Number.isFinite(compte) || compte < 0)) {
      setCorrErreur('Montant compté invalide.')
      return
    }
    if (!corrMotif.trim()) {
      setCorrErreur('Le motif est obligatoire.')
      return
    }
    const montants: { soldeOuverture?: number; montantCompte?: number } = {}
    if (ouv !== correction.ouverture) montants.soldeOuverture = ouv
    if (compte !== undefined && compte !== correction.compte) montants.montantCompte = compte
    if (Object.keys(montants).length === 0) {
      setCorrErreur('Aucun changement : les montants sont identiques.')
      return
    }
    setCorrEnvoi(true)
    const err = await corrigerJourneeCaisse(employe.id, correction.journee, montants, corrMotif.trim())
    setCorrEnvoi(false)
    if (err) {
      setCorrErreur(err)
      return
    }
    setCorrection(null)
    await alerter(
      'Journée corrigée',
      `La journée du ${formatDate(correction.journee + 'T12:00:00')} a été corrigée.` +
        (correction.compte !== undefined ? ' Théorique, écart et cumuls ont été recalculés.' : '') +
        ' Les opérations du jour ne changent pas.',
    )
  }

  const validerOuverture = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!employe) return
    const montant = Number(montantOuverture)
    const err = await ouvrirJourneeCaisse(
      employe.id,
      montant,
      noteOuverture.trim() || undefined,
      jourOuverture,
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
      `Ouverture enregistrée pour ${employe.nomComplet} — ${formatDate(jourOuverture + 'T12:00:00')} — ${formatMontant(montant)}.`,
    )
  }

  const annulerOuverture = async (jour: string) => {
    if (!employe) return
    const sit = situationCaisse(
      employe.id,
      data.transactions,
      data.arretsCaisse,
      jour,
      data.comptesCaisse,
      data.mouvementsCompteCaisse,
      data.ouverturesCaisse ?? [],
      data.employes,
    )
    const nbOps = sit.nombreOperations
    const alims = (data.mouvementsCompteCaisse ?? []).filter(
      (m) =>
        m.type === 'alimentation' &&
        m.date.slice(0, 10) === jour &&
        compteCaisse &&
        m.compteCaisseId === compteCaisse.id,
    ).length
    const comptesDuJour = data.comptes.filter((c) => {
      const client = data.clients.find((x) => x.id === c.clientId)
      return client?.agenceId === employe.agenceId && c.dateOuverture.slice(0, 10) === jour
    }).length
    const lignes = [
      nbOps > 0 ? `${nbOps} opération${nbOps > 1 ? 's' : ''} de caisse (dépôts, retraits, tontine…)` : null,
      alims > 0 ? `${alims} alimentation${alims > 1 ? 's' : ''} de caisse` : null,
      comptesDuJour > 0
        ? `${comptesDuJour} compte${comptesDuJour > 1 ? 's' : ''} ouvert${comptesDuJour > 1 ? 's' : ''} ce jour (la demande redevient en attente)`
        : null,
    ].filter(Boolean)
    const ok = await confirmer({
      titre: 'Annuler l’ouverture de journée',
      message:
        `Annuler l’ouverture du ${formatDate(jour + 'T12:00:00')} ?\n\n` +
        (lignes.length
          ? `Toutes les saisies de ce jour seront reculées :\n- ${lignes.join('\n- ')}\n\n`
          : 'Aucune opération saisie : seule l’ouverture sera retirée.\n\n') +
        `Les soldes clients et carnets seront rétablis. La journée redeviendra « non ouverte ».`,
      labelValider: 'Annuler l’ouverture',
      danger: true,
    })
    if (!ok) return
    const res = await annulerOuvertureJourneeCaisse(employe.id, jour)
    if (res.erreur) {
      await alerter('Annulation impossible', res.erreur)
      return
    }
    const n = res.operationsAnnulees ?? nbOps
    await alerter(
      'Ouverture annulée',
      n > 0
        ? `La journée du ${formatDate(jour + 'T12:00:00')} a été annulée (${n} opération${n > 1 ? 's' : ''} reculée${n > 1 ? 's' : ''}). Vous pouvez la rouvrir.`
        : `La journée du ${formatDate(jour + 'T12:00:00')} n’est plus ouverte. Vous pouvez la rouvrir.`,
    )
  }

  const annulerCloture = async (jour: string) => {
    if (!employe) return
    const sit = situationCaisse(
      employe.id,
      data.transactions,
      data.arretsCaisse,
      jour,
      data.comptesCaisse,
      data.mouvementsCompteCaisse,
      data.ouverturesCaisse ?? [],
      data.employes,
    )
    const nbOps = sit.nombreOperations
    const ok = await confirmer({
      titre: 'Annuler la journée clôturée',
      message:
        `Annuler la clôture du ${formatDate(jour + 'T12:00:00')} ?\n\n` +
        `Toutes les opérations de ce jour seront reculées (dépôts, retraits, tontine, vente de carnet…). ` +
        `Les soldes clients et carnets seront rétablis. La journée redeviendra « non ouverte ».`,
      labelValider: 'Tout annuler',
      danger: true,
    })
    if (!ok) return
    const res = await annulerClotureCaisse(employe.id, jour)
    if (res.erreur) {
      await alerter('Annulation impossible', res.erreur)
      return
    }
    const n = res.operationsAnnulees ?? nbOps
    await alerter(
      'Journée annulée',
      n > 0
        ? `La journée du ${formatDate(jour + 'T12:00:00')} a été annulée (${n} opération${n > 1 ? 's' : ''} reculée${n > 1 ? 's' : ''}). Vous pouvez la rouvrir.`
        : `La journée du ${formatDate(jour + 'T12:00:00')} n’est plus clôturée ni ouverte. Vous pouvez la rouvrir.`,
    )
  }

  const validerArret = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!employe) return
    const err = await arreterCaisse(
      Number(montantFermeture),
      noteArret.trim() || undefined,
      jourCibleCloture,
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
      `La caisse de ${employe.nomComplet} pour le ${formatDate(jourCibleCloture + 'T12:00:00')} a été clôturée.`,
    )
  }

  const validerAlimentation = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!employe) return
    const montant = Number(montantAlim)
    const err = await alimenterCompteCaisse(employe.id, montant, noteAlim.trim() || undefined)
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

  const gelConfirme = confirmationGel.trim().toLowerCase() === 'je confirme'

  const validerGel = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!employe || !gelConfirme) return
    setErreurGel('')
    const motif = motifGel.trim()
    if (!motif) {
      setErreurGel('Indiquez le motif du gel.')
      return
    }
    const solde = compteCaisse?.solde ?? 0
    const err = await gelerCompteCaisse(employe.id, motif)
    if (err) {
      setErreurGel(err)
      return
    }
    setModaleGel(false)
    setMotifGel('')
    setConfirmationGel('')
    await alerter(
      'Caisse gelée',
      `Le solde du compte caisse a été remis à zéro (${formatMontant(solde)}).`,
    )
  }

  const validerRegularisation = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!employe) return
    setErreurRegulariser('')
    const err = await regulariserCumulCompteCaisse(
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

  if (employe?.role === 'chef_agence' && titulaireCaisse && titulaireCaisse.id !== employe.id) {
    return <Navigate to={`/caisse/${titulaireCaisse.id}`} replace />
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

  if (!situationJour || !caisseACloturer) return null

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
        sousTitre={`Caisse unique de l’agence${agence ? ` · ${agence.nom}` : ''} — caissier : ${employe.nomComplet}`}
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
              {estAdmin && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setMotifGel('')
                    setConfirmationGel('')
                    setErreurGel('')
                    setModaleGel(true)
                  }}
                >
                  <Snowflake className="h-4 w-4" />
                  Geler
                </button>
              )}
              {peutOuvrir && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    setMontantOuverture(
                      String(compteCaisse?.solde ?? 0),
                    )
                    setNoteOuverture('')
                    setModaleOuverture(true)
                  }}
                >
                  <DoorOpen className="h-4 w-4" />
                  Ouvrir la journée
                </button>
              )}
              {peutCloturerAujourdhui && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => ouvrirModaleCloture(jourOuverture)}
                >
                  <Scale className="h-4 w-4" />
                  Clôturer la journée
                </button>
              )}
              {peutCloturerAujourdhui && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => void annulerOuverture(jourOuverture)}
                >
                  <Undo2 className="h-4 w-4" />
                  Annuler l’ouverture
                </button>
              )}
              {estAdmin && peutCloturerAujourdhui && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => ouvrirCorrection(jourOuverture)}
                >
                  <Pencil className="h-4 w-4" />
                  Corriger l’ouverture
                </button>
              )}
              {peutGerer && situationJour?.cloturee && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => ouvrirReouverture(jourOuverture)}
                >
                  <RotateCcw className="h-4 w-4" />
                  Rouvrir la journée
                </button>
              )}
              {peutGerer && situationJour?.cloturee && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => void annulerCloture(jourOuverture)}
                >
                  <Undo2 className="h-4 w-4" />
                  Annuler la clôture
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

      {joursRattrapage.length > 0 && (
        <div className="mb-6 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
          <p className="font-semibold">Journée(s) précédente(s) non clôturée(s)</p>
          <p className="mt-1">
            {joursRattrapage.map((j) => formatDate(j + 'T12:00:00')).join(', ')}. Vous pouvez
            quand même ouvrir et travailler sur la journée en cours.
          </p>
          {peutGerer && (
            <div className="mt-2 flex flex-wrap gap-2">
              {joursRattrapage.map((j) => {
                // On ne peut clôturer qu'une journée ouverte à cette date (sinon le serveur refuse)
                const ouverte = journeeCaisseOuverte(j)
                return (
                  <div key={j} className="flex flex-wrap items-center gap-2">
                    {ouverte ? (
                      <button
                        type="button"
                        className="btn-secondary !py-1.5 text-xs"
                        onClick={() => ouvrirModaleCloture(j)}
                      >
                        Clôturer le {formatDate(j + 'T12:00:00')}
                      </button>
                    ) : (
                      <span className="text-xs text-amber-800">
                        {formatDate(j + 'T12:00:00')} : aucune ouverture de caisse ce jour-là, clôture impossible.
                      </span>
                    )}
                    {ouverte && (
                      <button
                        type="button"
                        className="btn-secondary !py-1.5 text-xs"
                        onClick={() => void annulerOuverture(j)}
                      >
                        Annuler l’ouverture du {formatDate(j + 'T12:00:00')}
                      </button>
                    )}
                    {estAdmin && ouverte && (
                      <button
                        type="button"
                        className="btn-secondary !py-1.5 text-xs"
                        onClick={() => ouvrirCorrection(j)}
                      >
                        Corriger l’ouverture du {formatDate(j + 'T12:00:00')}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
      <div className="card mb-6 flex flex-wrap items-center gap-4">
        <Avatar nom={nom} prenom={prenom} taille="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-900">
              Caisse {agence?.nom ?? employe.nomComplet}
            </h2>
            <BadgeStatutCaisse situation={situationJour} />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Caissier {employe.nomComplet}
            {employe.telephone ? ` · ${employe.telephone}` : ''}
          </p>
          {situationJour.journeesEnRetard.length > 0 && (
            <p className="mt-2 text-sm text-amber-800">
              Non clôturé :{' '}
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
          onAnnulerCloture={peutGerer ? (a) => void annulerCloture(a.journee) : undefined}
          onCorriger={estAdmin ? (a) => ouvrirCorrection(a.journee) : undefined}
          onRouvrir={peutGerer ? (a) => ouvrirReouverture(a.journee) : undefined}
        />
      </div>

      {peutGerer && (
        <Modale
          titre={`Ouverture — ${employe.nomComplet} — ${formatDate(jourOuverture + 'T12:00:00')}`}
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
          titre={`Clôture — ${employe.nomComplet} — ${formatDate(jourCibleCloture + 'T12:00:00')}`}
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
                <span className="font-semibold">{formatMontant(caisseACloturer.soldeOuverture)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Opérations</span>
                <span className="font-semibold">{caisseACloturer.nombreOperations}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Entrées</span>
                <span className="font-semibold text-emerald-600">
                  {formatMontant(caisseACloturer.totalEntrees)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Sorties</span>
                <span className="font-semibold text-rose-600">
                  {formatMontant(caisseACloturer.totalSorties)}
                </span>
              </div>
              <div className="mt-1 flex justify-between border-t border-slate-200 pt-1">
                <span className="font-semibold text-slate-700">Fermeture théorique</span>
                <span className="font-bold text-brand-700">
                  {formatMontant(caisseACloturer.soldeFermetureTheorique)}
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

      {estAdmin && (
        <Modale
          titre={`Geler la caisse — ${employe.nomComplet}`}
          ouverte={modaleGel}
          onFermer={() => setModaleGel(false)}
        >
          <form onSubmit={validerGel} className="space-y-4">
            <p className="text-sm text-slate-600">
              Remet le solde du compte caisse à zéro (retrait des espèces). Réservé à
              l’administrateur. Une journée ouverte doit d’abord être clôturée ou annulée.
            </p>
            <div className="rounded-xl bg-rose-50 p-3 text-sm ring-1 ring-rose-100">
              <div className="flex justify-between">
                <span className="text-rose-700">Solde actuel</span>
                <span className="font-bold text-rose-900">
                  {formatMontant(compteCaisse?.solde ?? 0)}
                </span>
              </div>
              <div className="mt-1 flex justify-between text-xs text-rose-700/80">
                <span>Après le gel</span>
                <span>0 FCFA</span>
              </div>
            </div>
            <div>
              <label className="label">Motif *</label>
              <input
                className="input"
                required
                autoFocus
                value={motifGel}
                onChange={(e) => setMotifGel(e.target.value)}
                placeholder="Ex. Remise en banque, inventaire, fin de période"
              />
            </div>
            <div>
              <label className="label">
                Pour confirmer, saisissez <span className="font-semibold">je confirme</span>
              </label>
              <input
                className="input"
                autoComplete="off"
                value={confirmationGel}
                onChange={(e) => setConfirmationGel(e.target.value)}
                placeholder="je confirme"
              />
            </div>
            {erreurGel && <p className="text-sm text-rose-600">{erreurGel}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setModaleGel(false)}>
                Annuler
              </button>
              <button
                type="submit"
                className="btn-primary disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
                disabled={!gelConfirme}
              >
                Valider
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
      {estAdmin && (
        <Modale
          titre={correction ? `Corriger la journée du ${formatDate(correction.journee + 'T12:00:00')}` : ''}
          ouverte={correction !== null}
          onFermer={() => setCorrection(null)}
        >
          {correction &&
            (() => {
              const ouv = Number(corrOuverture) || 0
              const deltaOuv = ouv - correction.ouverture
              const cloturee = correction.compte !== undefined
              const theoriqueApres = (correction.theorique ?? 0) + deltaOuv
              const ecartAvant = (correction.compte ?? 0) - (correction.theorique ?? 0)
              const ecartApres = (Number(corrCompte) || 0) - theoriqueApres
              const soldeActuel = compteCaisse?.solde ?? 0
              return (
                <form onSubmit={validerCorrection} className="space-y-4">
                  <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600 ring-1 ring-slate-100">
                    Les opérations du jour ne sont pas modifiées.{' '}
                    {cloturee
                      ? 'Le solde théorique, l’écart et les cumuls manquant / surplus sont recalculés.'
                      : 'Journée encore ouverte : seule l’ouverture peut être corrigée.'}{' '}
                    La correction est conservée dans l’historique.
                  </p>
                  <div className={`grid gap-3 ${cloturee ? 'sm:grid-cols-2' : ''}`}>
                    <div>
                      <label className="label">Solde d’ouverture (FCFA) *</label>
                      <input
                        className="input"
                        type="number"
                        min={0}
                        required
                        value={corrOuverture}
                        onChange={(e) => setCorrOuverture(e.target.value)}
                      />
                      <p className="mt-1 text-xs text-slate-500">Actuel : {formatMontant(correction.ouverture)}</p>
                    </div>
                    {cloturee && (
                      <div>
                        <label className="label">Montant compté à la fermeture (FCFA) *</label>
                        <input
                          className="input"
                          type="number"
                          min={0}
                          required
                          value={corrCompte}
                          onChange={(e) => setCorrCompte(e.target.value)}
                        />
                        <p className="mt-1 text-xs text-slate-500">Actuel : {formatMontant(correction.compte ?? 0)}</p>
                      </div>
                    )}
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3 text-sm ring-1 ring-slate-100">
                    {cloturee ? (
                      <>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Fermeture théorique</span>
                          <span>
                            {formatMontant(correction.theorique ?? 0)} →{' '}
                            <strong>{formatMontant(theoriqueApres)}</strong>
                          </span>
                        </div>
                        <div className="mt-1 flex justify-between">
                          <span className="text-slate-500">Écart</span>
                          <span className="flex items-center gap-1.5">
                            <BadgeEcart ecart={ecartAvant} /> → <BadgeEcart ecart={ecartApres} />
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="flex justify-between">
                        <span className="text-slate-500">Solde du compte caisse</span>
                        <span>
                          {formatMontant(soldeActuel)} → <strong>{formatMontant(soldeActuel + deltaOuv)}</strong>
                        </span>
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="label">Motif *</label>
                    <input
                      className="input"
                      required
                      maxLength={300}
                      value={corrMotif}
                      onChange={(e) => setCorrMotif(e.target.value)}
                      placeholder="Ex. erreur de saisie, recomptage"
                    />
                  </div>
                  {corrErreur && <p className="text-sm font-medium text-rose-600">{corrErreur}</p>}
                  <div className="flex justify-end gap-2">
                    <button type="button" className="btn-secondary" onClick={() => setCorrection(null)}>
                      Annuler
                    </button>
                    <button type="submit" className="btn-primary" disabled={corrEnvoi}>
                      <Pencil className="h-4 w-4" />
                      {corrEnvoi ? 'Correction…' : 'Enregistrer la correction'}
                    </button>
                  </div>
                </form>
              )
            })()}
        </Modale>
      )}
      {peutGerer && (
        <Modale
          titre={reouverture ? `Rouvrir la journée du ${formatDate(reouverture + 'T12:00:00')}` : ''}
          ouverte={reouverture !== null}
          onFermer={() => setReouverture(null)}
        >
          <form onSubmit={validerReouverture} className="space-y-4">
            <div className="rounded-xl bg-sky-50 p-3 text-sm text-sky-900 ring-1 ring-sky-100">
              La clôture est retirée (son écart sort des cumuls) mais <strong>les opérations du jour sont
              conservées</strong>. Vous pourrez faire un complément de saisie sur ce jour, puis le clôturer à
              nouveau avec un nouveau comptage.
            </div>
            <div>
              <label className="label">Motif *</label>
              <input
                className="input"
                required
                maxLength={300}
                autoFocus
                value={reouvMotif}
                onChange={(e) => setReouvMotif(e.target.value)}
                placeholder="Ex. collecte du jour apportée en retard"
              />
            </div>
            {reouvErreur && <p className="text-sm font-medium text-rose-600">{reouvErreur}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setReouverture(null)}>
                Annuler
              </button>
              <button type="submit" className="btn-primary" disabled={reouvEnvoi}>
                <RotateCcw className="h-4 w-4" />
                {reouvEnvoi ? 'Réouverture…' : 'Rouvrir la journée'}
              </button>
            </div>
          </form>
        </Modale>
      )}
    </div>
  )
}
