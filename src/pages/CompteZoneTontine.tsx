import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Calculator, Scale, Undo2 } from 'lucide-react'
import { useStore } from '../store'
import { aujourdHuiIso, compteZoneDe, depotsTontineZoneJour, journeeZoneDuJour } from '../metier'
import { formatDate, formatDateHeure, formatMontant } from '../utils'
import { EnTetePage, EtatVide, Modale } from '../components/ui'
import { useConfirmation } from '../components/Confirmation'
import type { StatutJourneeZone } from '../types'

function BadgeStatut({ statut }: { statut: StatutJourneeZone }) {
  const styles: Record<StatutJourneeZone, string> = {
    en_cours: 'bg-slate-100 text-slate-700',
    ok: 'bg-emerald-100 text-emerald-700',
    manquant: 'bg-rose-100 text-rose-700',
    surplus: 'bg-sky-100 text-sky-700',
  }
  const labels: Record<StatutJourneeZone, string> = {
    en_cours: 'En cours',
    ok: 'OK',
    manquant: 'Manquant',
    surplus: 'Surplus',
  }
  return <span className={`badge ${styles[statut]}`}>{labels[statut]}</span>
}

export default function CompteZoneTontinePage() {
  const { zoneId } = useParams()
  const {
    data,
    estAdmin,
    employeConnecte,
    saisirMontantReelZone,
    cloturerJourneeZone,
    annulerClotureJourneeZone,
    ajusterCumulCompteZone,
  } = useStore()
  const { alerter, confirmer } = useConfirmation()

  const [dateJour, setDateJour] = useState(aujourdHuiIso)
  const [montantReel, setMontantReel] = useState('')
  const [note, setNote] = useState('')
  const [modaleAjust, setModaleAjust] = useState(false)
  const [typeAjust, setTypeAjust] = useState<'manquant' | 'surplus'>('manquant')
  const [montantAjust, setMontantAjust] = useState('')
  const [motifAjust, setMotifAjust] = useState('')
  const [erreur, setErreur] = useState('')

  const zone = data.zones.find((z) => z.id === zoneId)
  const agence = zone ? data.agences.find((a) => a.id === zone.agenceId) : undefined
  const accesZoneOk =
    !!zone && (estAdmin || !employeConnecte || zone.agenceId === employeConnecte.agenceId)
  const compte = zoneId && accesZoneOk ? compteZoneDe(data.comptesZoneTontine, zoneId) : undefined
  const journee =
    zoneId && accesZoneOk ? journeeZoneDuJour(data.journeesCompteZone, zoneId, dateJour) : undefined

  const theoriqueEnCours = useMemo(() => {
    if (!zoneId || !accesZoneOk) return 0
    return depotsTontineZoneJour(zoneId, dateJour, data.clients, data.transactions)
  }, [zoneId, dateJour, data.clients, data.transactions, accesZoneOk])

  const historique = useMemo(() => {
    if (!zoneId || !accesZoneOk) return []
    return [...data.journeesCompteZone]
      .filter((j) => j.zoneId === zoneId)
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [data.journeesCompteZone, zoneId, accesZoneOk])

  const ajustements = useMemo(() => {
    if (!zoneId || !accesZoneOk) return []
    return [...data.ajustementsCompteZone]
      .filter((a) => a.zoneId === zoneId)
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [data.ajustementsCompteZone, zoneId, accesZoneOk])

  if (!zone || !zoneId || !accesZoneOk) {
    return (
      <div>
        <Link to="/zones" className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-brand-600">
          <ArrowLeft className="h-4 w-4" />
          Retour à la collecte / zones
        </Link>
        <p className="text-slate-600">
          {!zone ? 'Zone introuvable.' : 'Cette zone n’appartient pas à votre agence.'}
        </p>
      </div>
    )
  }

  const enregistrerReel = async (e: React.FormEvent) => {
    e.preventDefault()
    const err = await saisirMontantReelZone(zoneId, Number(montantReel), dateJour, note.trim() || undefined)
    if (err) {
      setErreur(err)
      await alerter('Saisie impossible', err)
      return
    }
    setErreur('')
    setMontantReel('')
    setNote('')
    await alerter(
      'Montant réel enregistré',
      `Montant réel collecté saisi pour le ${formatDate(dateJour + 'T12:00:00')}.\nSaisissez ensuite les dépôts tontine des clients, puis clôturez la journée.`,
    )
  }

  const cloturer = async () => {
    const ok = await confirmer({
      titre: 'Clôturer la journée',
      message:
        `Comparer le réel (${formatMontant(journee?.montantReel ?? 0)}) au théorique des dépôts tontine (${formatMontant(theoriqueEnCours)}) ?\n` +
        `Écart provisoire : ${formatMontant((journee?.montantReel ?? 0) - theoriqueEnCours)}\n\n` +
        `Les cumuls manquant / surplus seront mis à jour.`,
      labelValider: 'Clôturer',
    })
    if (!ok) return
    const err = await cloturerJourneeZone(zoneId, dateJour)
    if (err) {
      await alerter('Clôture impossible', err)
      return
    }
    await alerter('Journée clôturée', 'Le calcul d’écart a été enregistré dans l’historique du compte zone.')
  }

  const annulerCloture = async () => {
    if (!zoneId) return
    const ok = await confirmer({
      titre: 'Annuler la clôture',
      message:
        `Annuler la clôture du ${formatDate(dateJour + 'T12:00:00')} ?\n\n` +
        `La journée redeviendra ouverte. Le montant réel collecté est conservé. ` +
        `L’écart de cette clôture sera retiré des cumuls. Vous pourrez ajouter des dépôts puis reclôturer.`,
      labelValider: 'Annuler la clôture',
      danger: true,
    })
    if (!ok) return
    const err = await annulerClotureJourneeZone(zoneId, dateJour)
    if (err) {
      await alerter('Annulation impossible', err)
      return
    }
    await alerter('Clôture annulée', 'La journée n’est plus clôturée.')
  }

  const validerAjustement = async (e: React.FormEvent) => {
    e.preventDefault()
    const err = await ajusterCumulCompteZone(zoneId, typeAjust, Number(montantAjust), motifAjust)
    if (err) {
      setErreur(err)
      return
    }
    setModaleAjust(false)
    setMontantAjust('')
    setMotifAjust('')
    setErreur('')
    await alerter('Ajustement enregistré', `Cumul ${typeAjust} mis à jour.`)
  }

  return (
    <div>
      <Link
        to="/zones"
        className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-brand-600 hover:text-brand-700"
      >
        <ArrowLeft className="h-4 w-4" />
        Retour à la collecte / zones
      </Link>

      <EnTetePage
        titre={`Compte zone ${zone.code}`}
        sousTitre={`${zone.nom ?? 'Zone'} — ${agence?.nom ?? 'Agence'} — 1) montant réel · 2) dépôts · 3) clôture`}
        action={
          estAdmin && (
            <button className="btn-secondary" onClick={() => setModaleAjust(true)}>
              <Scale className="h-4 w-4" />
              Ajuster les cumuls
            </button>
          )
        }
      />

      <div className="mb-6 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-950 ring-1 ring-brand-100">
        <p className="font-semibold">Flux caissier</p>
        <p className="mt-1">
          Saisissez d’abord le <strong>montant réel collecté</strong>, puis les dépôts sur{' '}
          <Link to="/tontines" className="font-semibold underline">
            Tontine &amp; cartes
          </Link>{' '}
          en rattachant chaque dépôt au jour de collecte encore ouvert, puis clôturez ici.
        </p>
      </div>
      <div className="mb-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-rose-50 px-4 py-3 ring-1 ring-rose-100">
          <div className="text-xs font-medium uppercase text-rose-700">Cumul manquant</div>
          <div className="mt-1 text-xl font-bold text-rose-900">
            {formatMontant(compte?.cumulManquant ?? 0)}
          </div>
        </div>
        <div className="rounded-xl bg-sky-50 px-4 py-3 ring-1 ring-sky-100">
          <div className="text-xs font-medium uppercase text-sky-700">Cumul surplus</div>
          <div className="mt-1 text-xl font-bold text-sky-900">
            {formatMontant(compte?.cumulSurplus ?? 0)}
          </div>
        </div>
      </div>
      <p className="mb-6 text-xs text-slate-500">
        Cumuls uniques du compte zone — toutes les dates confondues. Chaque clôture journalière y ajoute
        l’écart du jour ; seul l’admin peut les ajuster.
      </p>

      <div className="card mb-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold text-slate-900">État journalier</h3>
          <input
            className="input !w-auto"
            type="date"
            value={dateJour}
            onChange={(e) => setDateJour(e.target.value)}
          />
        </div>

        {journee?.cloturee ? (
          <div className="rounded-xl bg-slate-50 p-4 text-sm space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <BadgeStatut statut={journee.statut} />
              <span className="text-slate-500">Clôturée le {formatDateHeure(journee.dateCloture!)}</span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div>
                Réel : <span className="font-bold">{formatMontant(journee.montantReel)}</span>
              </div>
              <div>
                Théorique : <span className="font-bold">{formatMontant(journee.montantTheorique)}</span>
              </div>
              <div>
                Écart :{' '}
                <span className={`font-bold ${journee.ecart < 0 ? 'text-rose-700' : journee.ecart > 0 ? 'text-sky-700' : 'text-emerald-700'}`}>
                  {journee.ecart > 0 ? '+' : ''}
                  {formatMontant(journee.ecart)}
                </span>
              </div>
            </div>
            <p className="text-xs text-slate-500">Par {journee.operateurNom}</p>
            <button type="button" className="btn-secondary mt-2" onClick={() => void annulerCloture()}>
              <Undo2 className="h-4 w-4" />
              Annuler la clôture
            </button>
          </div>
        ) : (
          <>
            {!journee && (
              <form onSubmit={enregistrerReel} className="space-y-3 border-t border-slate-100 pt-4">
                <div>
                  <label className="label">1. Montant réel collecté (FCFA) *</label>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    required
                    value={montantReel}
                    onChange={(e) => setMontantReel(e.target.value)}
                    placeholder="Ex. 150000"
                  />
                </div>
                <div>
                  <label className="label">Note (optionnel)</label>
                  <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
                </div>
                {erreur && <p className="text-sm text-rose-600">{erreur}</p>}
                <button type="submit" className="btn-primary">
                  Enregistrer le montant réel
                </button>
              </form>
            )}

            {journee && !journee.cloturee && (
              <div className="space-y-3 border-t border-slate-100 pt-4">
                <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                  <p>
                    Réel saisi : <span className="font-bold">{formatMontant(journee.montantReel)}</span> — par{' '}
                    {journee.operateurNom}
                  </p>
                  <p className="mt-1">
                    Dépôts tontine saisis ce jour (théorique en cours) :{' '}
                    <span className="font-bold">{formatMontant(theoriqueEnCours)}</span>
                  </p>
                  <p className="mt-1">
                    Écart provisoire :{' '}
                    <span className="font-bold">
                      {formatMontant(journee.montantReel - theoriqueEnCours)}
                    </span>
                  </p>
                </div>
                <p className="text-xs text-slate-500">
                  2. Continuez les dépôts tontine sur les carnets des clients de cette zone, puis clôturez.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-primary" onClick={cloturer}>
                    <Calculator className="h-4 w-4" />
                    3. Clôturer et calculer l’écart
                  </button>
                  <form
                    onSubmit={enregistrerReel}
                    className="flex flex-wrap items-end gap-2"
                  >
                    <div>
                      <label className="label">Modifier le réel</label>
                      <input
                        className="input !w-36"
                        type="number"
                        min={0}
                        required
                        value={montantReel}
                        onChange={(e) => setMontantReel(e.target.value)}
                        placeholder={String(journee.montantReel)}
                      />
                    </div>
                    <button type="submit" className="btn-secondary">
                      Mettre à jour
                    </button>
                  </form>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="card mb-6 !p-0 overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="font-semibold text-slate-900">Historique journalier</h3>
          <p className="text-xs text-slate-500">État du compte zone tontine pour chaque jour</p>
        </div>
        {historique.length === 0 ? (
          <div className="p-5">
            <EtatVide titre="Aucun jour enregistré" description="Saisissez un montant réel pour commencer." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3 text-right">Réel</th>
                  <th className="px-5 py-3 text-right">Théorique</th>
                  <th className="px-5 py-3 text-right">Écart</th>
                  <th className="px-5 py-3">Statut</th>
                  <th className="px-5 py-3">Opérateur</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {historique.map((j) => (
                  <tr
                    key={j.id}
                    className={`cursor-pointer hover:bg-slate-50 ${j.date === dateJour ? 'bg-brand-50/50' : ''}`}
                    onClick={() => setDateJour(j.date)}
                  >
                    <td className="px-5 py-3 font-medium">{formatDate(j.date + 'T12:00:00')}</td>
                    <td className="px-5 py-3 text-right">{formatMontant(j.montantReel)}</td>
                    <td className="px-5 py-3 text-right">
                      {j.cloturee ? formatMontant(j.montantTheorique) : '—'}
                    </td>
                    <td className="px-5 py-3 text-right font-semibold">
                      {j.cloturee
                        ? `${j.ecart > 0 ? '+' : ''}${formatMontant(j.ecart)}`
                        : '—'}
                    </td>
                    <td className="px-5 py-3">
                      <BadgeStatut statut={j.statut} />
                    </td>
                    <td className="px-5 py-3 text-slate-600">{j.operateurNom}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {ajustements.length > 0 && (
        <div className="card !p-0 overflow-hidden">
          <div className="border-b border-slate-200 px-5 py-4">
            <h3 className="font-semibold text-slate-900">Ajustements admin</h3>
          </div>
          <div className="divide-y divide-slate-100">
            {ajustements.map((a) => (
              <div key={a.id} className="px-5 py-3 text-sm">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-medium text-slate-900">
                    {a.type === 'manquant' ? 'Manquant' : 'Surplus'} −{formatMontant(a.montant)}
                  </span>
                  <span className="text-xs text-slate-500">{formatDateHeure(a.date)} — {a.adminNom}</span>
                </div>
                <p className="mt-0.5 text-slate-600">{a.motif}</p>
                <p className="text-xs text-slate-400">
                  Cumul {formatMontant(a.cumulAvant)} → {formatMontant(a.cumulApres)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <Modale titre="Ajuster un cumul" ouverte={modaleAjust} onFermer={() => setModaleAjust(false)}>
        <form onSubmit={validerAjustement} className="space-y-4">
          <p className="text-sm text-slate-600">
            Réservé à l’admin (ex. client oublié comptabilisé ensuite). Le cumul est réduit du montant saisi.
          </p>
          <div>
            <label className="label">Cumul *</label>
            <select
              className="input"
              value={typeAjust}
              onChange={(e) => setTypeAjust(e.target.value as 'manquant' | 'surplus')}
            >
              <option value="manquant">Manquant ({formatMontant(compte?.cumulManquant ?? 0)})</option>
              <option value="surplus">Surplus ({formatMontant(compte?.cumulSurplus ?? 0)})</option>
            </select>
          </div>
          <div>
            <label className="label">Montant à retirer du cumul *</label>
            <input
              className="input"
              type="number"
              min={1}
              required
              value={montantAjust}
              onChange={(e) => setMontantAjust(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Motif *</label>
            <textarea
              className="input min-h-20"
              required
              value={motifAjust}
              onChange={(e) => setMotifAjust(e.target.value)}
              placeholder="Ex. Client oublié saisi après coup"
            />
          </div>
          {erreur && <p className="text-sm text-rose-600">{erreur}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setModaleAjust(false)}>
              Annuler
            </button>
            <button type="submit" className="btn-primary">
              Valider l’ajustement
            </button>
          </div>
        </form>
      </Modale>
    </div>
  )
}
