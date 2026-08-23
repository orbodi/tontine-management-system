import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpFromLine,
  Lock,
  LockOpen,
} from 'lucide-react'
import { NOM_APPLICATION } from '../config'
import { useStore } from '../store'
import { CYCLES_PAR_CARNET } from '../types'
import {
  aujourdHuiIso,
  CARNETS_RETRAIT_6_MOIS,
  LIBELLES_CARNET,
  calculerMisesDepuisMontant,
  carreauxNets,
  eligibiliteRetraitCarnet,
  journeeZoneDuJour,
  moisDuCycle,
  situationsCycles,
  type EtatCycle,
} from '../metier'
import { formatDate, formatMontant } from '../utils'
import { Avatar, EnTetePage, Modale } from '../components/ui'
import { useConfirmation } from '../components/Confirmation'

export default function DetailTontine() {
  const { id } = useParams()
  const {
    data,
    aDroit,
    estAdmin,
    encaisserCotisation,
    retraitCycle,
    basculerVerrouCarnet,
    basculerRetraitCarnetAdmin,
  } = useStore()
  const { confirmer, alerter } = useConfirmation()

  const [modaleDepot, setModaleDepot] = useState(false)
  const [montantDepot, setMontantDepot] = useState('')
  const [recapDepot, setRecapDepot] = useState(false)
  const [retraitSur, setRetraitSur] = useState<EtatCycle | null>(null)
  const [nbCarreaux, setNbCarreaux] = useState('1')
  const [erreur, setErreur] = useState('')

  const carnet = data.carnets.find((c) => c.id === id)
  const client = carnet ? data.clients.find((c) => c.id === carnet.clientId) : undefined
  const zone = carnet ? data.zones.find((z) => z.id === carnet.zoneId) : undefined
  const peutOperer = aDroit('operer_comptes')
  const peutVerrouiller = aDroit('verrouiller_comptes')

  const journeeCollecte = carnet
    ? journeeZoneDuJour(data.journeesCompteZone, carnet.zoneId, aujourdHuiIso())
    : undefined
  const collecteOuverte = !!journeeCollecte && !journeeCollecte.cloturee
  const collecteCloturee = !!journeeCollecte?.cloturee

  const cycles = useMemo(
    () => (carnet ? situationsCycles(carnet, data.mises) : []),
    [carnet, data.mises],
  )

  const payeesActuel = carnet ? carreauxNets(carnet, data.mises) : 0
  const moisActuel = carnet ? moisDuCycle(carnet, carnet.cycleActuel) : null
  const eligibilite = carnet ? eligibiliteRetraitCarnet(carnet, data.mises) : { autorise: true }
  const carteRestreinte = carnet ? CARNETS_RETRAIT_6_MOIS.includes(carnet.typeCarnet) : false
  const retraitAutorise = eligibilite.autorise && !carnet?.verrouille
  const calcDepot = carnet
    ? calculerMisesDepuisMontant(Number(montantDepot) || 0, carnet.mise)
    : null

  if (!carnet || !client) {
    return (
      <div>
        <Link to="/tontines" className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-brand-600 hover:text-brand-700">
          <ArrowLeft className="h-4 w-4" />
          Retour aux carnets
        </Link>
        <p className="text-slate-600">Carnet introuvable.</p>
      </div>
    )
  }

  const ouvrirRecapDepot = (e: React.FormEvent) => {
    e.preventDefault()
    if (!collecteOuverte) {
      setErreur(
        collecteCloturee
          ? 'La collecte de cette zone est déjà clôturée pour aujourd’hui.'
          : 'Saisissez d’abord le montant réel collecté sur le compte zone.',
      )
      return
    }
    if (!calcDepot?.ok) {
      setErreur(calcDepot && !calcDepot.ok ? calcDepot.erreur : 'Montant invalide.')
      return
    }
    const restants = carnet.misesParCycle - payeesActuel
    if (calcDepot.nombreMises > restants) {
      setErreur(`Seulement ${restants} carreau(x) restant(s) sur ce cycle.`)
      return
    }
    setErreur('')
    setRecapDepot(true)
  }

  const validerDepot = async () => {
    const montant = Number(montantDepot)
    const avant = carnet.cycleActuel
    const resultat = await encaisserCotisation(carnet.id, montant)
    setRecapDepot(false)
    setModaleDepot(false)
    setMontantDepot('')
    setErreur('')
    if (resultat) {
      await alerter('Dépôt échoué', resultat)
      return
    }
    const apres = data.carnets.find((c) => c.id === carnet.id)?.cycleActuel
    // Note: data may not have updated yet in closure — message generic with auto-pass hint
    await alerter(
      'Dépôt effectué',
      `Le dépôt de ${formatMontant(montant)} a été enregistré pour ${client.prenom} ${client.nom} (carnet ${carnet.numero}).` +
        (payeesActuel + (calcDepot?.ok ? calcDepot.nombreMises : 0) >= carnet.misesParCycle
          ? `\n\n${moisDuCycle(carnet, avant).label} complet : passage automatique au mois suivant.`
          : ''),
    )
    void apres
  }

  const validerRetrait = async (total: boolean) => {
    if (!retraitSur) return
    const n = total ? retraitSur.retirables : Number(nbCarreaux)
    const montant = carnet.mise * n
    const cycle = retraitSur.cycle
    const moisLabel = retraitSur.moisLabel
    const retiresApres = retraitSur.retires + n
    const disponiblesApres = Math.max(0, retraitSur.retirables - n)
    const montantDispoApres = disponiblesApres * carnet.mise
    const resultat = await retraitCycle(carnet.id, cycle, n)
    setRetraitSur(null)
    setNbCarreaux('1')
    setErreur('')
    if (resultat) {
      await alerter('Retrait échoué', resultat)
      return
    }
    await alerter(
      'Retrait effectué',
      `Retrait ${total ? 'total' : 'partiel'} de ${formatMontant(montant)} (${n} mise${n > 1 ? 's' : ''}) — ${moisLabel}.\n\n` +
        `Mises retirées : ${retiresApres}\n` +
        `Mises disponibles : ${disponiblesApres}\n` +
        `Montant disponible : ${formatMontant(montantDispoApres)}`,
    )
  }

  return (
    <div>
      <Link to="/tontines" className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-brand-600 hover:text-brand-700">
        <ArrowLeft className="h-4 w-4" />
        Retour aux carnets
      </Link>

      <EnTetePage
        titre={`Carnet ${carnet.numero}`}
        sousTitre={`${LIBELLES_CARNET[carnet.typeCarnet]} — ${client.prenom} ${client.nom} (${client.codeClient}) — ${data.agences.find((a) => a.id === carnet.agenceId)?.nom ?? 'Agence'} · Zone ${data.zones.find((z) => z.id === carnet.zoneId)?.code ?? '—'}`}
        action={
          <div className="flex flex-wrap gap-2">
            {peutOperer && (
              <button
                className="btn-primary"
                disabled={carnet.verrouille || !collecteOuverte}
                title={
                  carnet.verrouille
                    ? 'Carnet verrouillé'
                    : !collecteOuverte
                      ? 'Saisissez d’abord le montant réel collecté sur le compte zone'
                      : payeesActuel >= carnet.misesParCycle
                        ? 'Mois complet : le prochain dépôt passera au mois suivant'
                        : undefined
                }
                onClick={() => {
                  setMontantDepot('')
                  setErreur('')
                  setModaleDepot(true)
                }}
              >
                <ArrowDownToLine className="h-4 w-4" />
                Dépôt
              </button>
            )}
            {peutVerrouiller && (
              <button
                className="btn-secondary"
                onClick={async () => {
                  const ok = await confirmer({
                    titre: carnet.verrouille ? 'Déverrouiller' : 'Verrouiller',
                    message: carnet.verrouille
                      ? `Déverrouiller le carnet ${carnet.numero} ?`
                      : `Verrouiller le carnet ${carnet.numero} ?`,
                    labelValider: carnet.verrouille ? 'Déverrouiller' : 'Verrouiller',
                    danger: !carnet.verrouille,
                  })
                  if (ok) await basculerVerrouCarnet(carnet.id)
                }}
              >
                {carnet.verrouille ? <LockOpen className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
              </button>
            )}
            {estAdmin && carteRestreinte && (
              <button
                className={carnet.retraitActiveParAdmin ? 'btn-secondary' : 'btn-primary'}
                onClick={async () => {
                  const activer = !carnet.retraitActiveParAdmin
                  const ok = await confirmer({
                    titre: activer ? 'Activer les retraits' : 'Désactiver les retraits',
                    message: activer
                      ? `Autoriser les retraits partiels et totaux sur le carnet ${carnet.numero} (${LIBELLES_CARNET[carnet.typeCarnet]}) ?`
                      : `Désactiver les retraits sur le carnet ${carnet.numero} ? Les boutons resteront visibles mais grisés.`,
                    labelValider: activer ? 'Activer' : 'Désactiver',
                    danger: !activer,
                  })
                  if (!ok) return
                  const err = await basculerRetraitCarnetAdmin(carnet.id)
                  if (err) await alerter('Action impossible', err)
                  else
                    await alerter(
                      activer ? 'Retraits activés' : 'Retraits désactivés',
                      activer
                        ? 'Les caissiers peuvent maintenant effectuer des retraits sur ce carnet.'
                        : 'Les retraits sont de nouveau bloqués (boutons grisés).',
                    )
                }}
              >
                {carnet.retraitActiveParAdmin ? 'Désactiver retraits' : 'Activer retraits'}
              </button>
            )}
          </div>
        }
      />

      {peutOperer && !collecteOuverte && (
        <div
          className={`mb-6 rounded-xl px-4 py-3 text-sm ring-1 ${
            collecteCloturee
              ? 'bg-slate-50 text-slate-700 ring-slate-200'
              : 'bg-amber-50 text-amber-950 ring-amber-200'
          }`}
        >
          {collecteCloturee ? (
            <p>
              La collecte tontine de la zone {zone?.code ?? '—'} est <strong>clôturée</strong> pour
              aujourd’hui — plus de dépôt possible.
            </p>
          ) : (
            <>
              <p className="font-semibold">Montant réel collecté requis</p>
              <p className="mt-1">
                Avant tout dépôt sur ce carnet, saisissez le montant réellement collecté pour la zone{' '}
                <strong>{zone?.code ?? '—'}</strong>
                {zone?.nom ? ` (${zone.nom})` : ''}.
              </p>
              <Link
                to={`/zones/${carnet.zoneId}/compte`}
                className="mt-2 inline-flex text-sm font-semibold text-brand-700 hover:text-brand-800"
              >
                Aller saisir le montant réel →
              </Link>
            </>
          )}
        </div>
      )}

      {peutOperer && collecteOuverte && (
        <div className="mb-6 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900 ring-1 ring-emerald-200">
          Collecte zone {zone?.code ?? '—'} ouverte — réel saisi :{' '}
          <strong>{formatMontant(journeeCollecte!.montantReel)}</strong>
          <Link
            to={`/zones/${carnet.zoneId}/compte`}
            className="ml-2 font-semibold text-brand-700 hover:text-brand-800"
          >
            Voir le compte zone
          </Link>
        </div>
      )}

      <div className="mb-6 flex flex-wrap items-center gap-4">
        <Avatar nom={client.nom} prenom={client.prenom} taille="lg" />
        <div>
          <Link to={`/clients/${client.id}`} className="font-semibold text-slate-900 hover:text-brand-700">
            {client.prenom} {client.nom}
          </Link>
          <p className="text-sm text-slate-500">
            Mise {formatMontant(carnet.mise)} — ouvert le {formatDate(carnet.dateOuverture)}
          </p>
          {carnet.verrouille && (
            <span className="mt-1 inline-flex items-center rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-medium text-rose-700">
              <Lock className="mr-1 h-3 w-3" />
              Verrouillé
            </span>
          )}
          {carteRestreinte && (
            <span
              className={`mt-1 ml-2 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                carnet.retraitActiveParAdmin
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-slate-200 text-slate-600'
              }`}
            >
              Retraits {carnet.retraitActiveParAdmin ? 'activés (admin)' : 'non activés'}
            </span>
          )}
        </div>
      </div>

      {/* Cycle en cours */}
      <div className="card mb-6">
        <h3 className="mb-3 font-semibold text-slate-900">
          Mois en cours — {moisActuel?.label}{' '}
          <span className="font-normal text-slate-500">
            (cycle {carnet.cycleActuel}/{CYCLES_PAR_CARNET})
          </span>
        </h3>
        <div className="mb-2 flex justify-between text-sm text-slate-600">
          <span>
            <span className="font-bold text-slate-900">{payeesActuel}</span> / {carnet.misesParCycle} carreaux
          </span>
          <span>Collecté : {formatMontant(Math.max(0, payeesActuel) * carnet.mise)}</span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-brand-500"
            style={{ width: `${Math.min(100, (payeesActuel / carnet.misesParCycle) * 100)}%` }}
          />
        </div>
        <p className="mt-3 text-xs text-slate-500">
          À {carnet.misesParCycle} carreaux, le compte passe automatiquement au mois suivant. Un retrait partiel
          est possible sur le mois en cours ; le retrait total reste réservé aux mois passés.
        </p>
        {carteRestreinte && !eligibilite.autorise && (
          <p className="mt-2 rounded-xl bg-amber-50 p-2.5 text-xs text-amber-800">
            Retraits grisés : seul l’administrateur peut les activer
            {eligibilite.dateDeblocage
              ? ` (délai indicatif 6 mois : ${formatDate(eligibilite.dateDeblocage)})`
              : ''}
            .
          </p>
        )}
      </div>

      {/* Historique des cycles / mois */}
      <div className="card !p-0 overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="font-semibold text-slate-900">Mois (cycles) et état</h3>
          <p className="text-xs text-slate-500">
            Chaque cycle correspond à un mois. Un mois soldé (retrait total hors P.C) apparaît grisé. P.C = 1 carreau
            pour {NOM_APPLICATION}. Retrait partiel possible aussi sur le mois en cours.
          </p>
        </div>
        <div className="divide-y divide-slate-100">
          {[...cycles].reverse().map((et) => (
            <div
              key={et.cycle}
              className={`px-5 py-4 ${
                et.grise ? 'bg-slate-100/80' : et.estActuel ? 'bg-brand-50/40' : 'bg-white'
              } ${et.grise ? 'text-slate-500' : ''}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-base font-bold ${et.grise ? 'text-slate-500' : 'text-slate-900'}`}>
                      {et.moisLabel}
                    </span>
                    <span className="text-xs text-slate-500">
                      (cycle {et.cycle}/{CYCLES_PAR_CARNET})
                    </span>
                    {et.estActuel && <span className="badge bg-brand-100 text-brand-700">En cours</span>}
                    {!et.estActuel && et.complet && !et.grise && (
                      <span className="badge bg-amber-100 text-amber-800">Mois passé — à retirer</span>
                    )}
                    {et.grise && <span className="badge bg-slate-200 text-slate-600">Mois soldé</span>}
                    {!et.estActuel && !et.complet && (
                      <span className="badge bg-slate-100 text-slate-600">Mois passé</span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    Cotisé : {et.deposes}/{carnet.misesParCycle} mises
                  </p>
                </div>
                {peutOperer && et.retirables > 0 && (
                    <div className="flex flex-col items-end gap-1">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="btn-secondary !py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
                          disabled={!retraitAutorise}
                          title={
                            !retraitAutorise
                              ? carnet.verrouille
                                ? 'Carnet verrouillé'
                                : 'Retrait non activé par l’administrateur'
                              : 'Retrait partiel'
                          }
                          onClick={() => {
                            if (!retraitAutorise) return
                            setRetraitSur(et)
                            setNbCarreaux('1')
                            setErreur('')
                          }}
                        >
                          <ArrowUpFromLine className="h-3.5 w-3.5" />
                          Retrait partiel
                        </button>
                        {!et.estActuel && (
                          <button
                            type="button"
                            className="btn-primary !py-1.5 text-xs disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
                            disabled={!retraitAutorise}
                            title={
                              !retraitAutorise
                                ? carnet.verrouille
                                  ? 'Carnet verrouillé'
                                  : 'Retrait non activé par l’administrateur'
                                : 'Retrait total'
                            }
                            onClick={async () => {
                              if (!retraitAutorise) return
                              const ok = await confirmer({
                                titre: `Retrait total — ${et.moisLabel}`,
                                message:
                                  `Retirer ${formatMontant(et.montantRetirable)} (${et.retirables} mises hors P.C) pour ${client.prenom} ${client.nom} (${et.moisLabel}) ?\n` +
                                  `Mises déjà retirées : ${et.retires}\n` +
                                  `Mises disponibles : ${et.retirables}\n` +
                                  `Montant disponible : ${formatMontant(et.montantRetirable)}\n\n` +
                                  `Le cycle sera ensuite grisé.`,
                                labelValider: 'Retrait total',
                              })
                              if (!ok) return
                              const n = et.retirables
                              const montant = et.montantRetirable
                              const resultat = await retraitCycle(carnet.id, et.cycle, n)
                              if (resultat) await alerter('Retrait échoué', resultat)
                              else
                                await alerter(
                                  'Retrait effectué',
                                  `Retrait total de ${formatMontant(montant)} (${n} mise${n > 1 ? 's' : ''}) — ${et.moisLabel}.\n\n` +
                                    `Mises retirées : ${et.retires + n}\n` +
                                    `Mises disponibles : 0\n` +
                                    `Montant disponible : ${formatMontant(0)}`,
                                )
                            }}
                          >
                            Retrait total
                          </button>
                        )}
                      </div>
                      {!retraitAutorise && carteRestreinte && (
                        <span className="text-[10px] text-slate-500">En attente d’activation admin</span>
                      )}
                    </div>
                  )}
              </div>

              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div
                  className={`rounded-lg px-3 py-2 ring-1 ${
                    et.grise ? 'bg-slate-50 ring-slate-200' : 'bg-rose-50/80 ring-rose-100'
                  }`}
                >
                  <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Mises retirées
                  </div>
                  <div className={`text-lg font-bold tabular-nums ${et.grise ? 'text-slate-500' : 'text-rose-800'}`}>
                    {et.retires}
                  </div>
                </div>
                <div
                  className={`rounded-lg px-3 py-2 ring-1 ${
                    et.grise ? 'bg-slate-50 ring-slate-200' : 'bg-amber-50/80 ring-amber-100'
                  }`}
                >
                  <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Mises disponibles
                  </div>
                  <div className={`text-lg font-bold tabular-nums ${et.grise ? 'text-slate-500' : 'text-amber-900'}`}>
                    {et.retirables}
                  </div>
                  <div className="text-[10px] text-slate-500">hors P.C</div>
                </div>
                <div
                  className={`rounded-lg px-3 py-2 ring-1 ${
                    et.grise ? 'bg-slate-50 ring-slate-200' : 'bg-emerald-50/80 ring-emerald-100'
                  }`}
                >
                  <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Montant disponible
                  </div>
                  <div className={`text-lg font-bold tabular-nums ${et.grise ? 'text-slate-500' : 'text-emerald-800'}`}>
                    {formatMontant(et.montantRetirable)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Modale dépôt */}
      <Modale
        titre={`Dépôt — ${client.prenom} ${client.nom}`}
        ouverte={modaleDepot && !recapDepot}
        onFermer={() => setModaleDepot(false)}
      >
        <form onSubmit={ouvrirRecapDepot} className="space-y-4">
          <div className="rounded-xl bg-slate-50 p-3 text-sm">
            Mise : <span className="font-bold">{formatMontant(carnet.mise)}</span> — carreaux :{' '}
            <span className="font-bold">
              {payeesActuel}/{carnet.misesParCycle}
            </span>
          </div>
          <div>
            <label className="label">Montant du dépôt (FCFA) *</label>
            <input
              className="input"
              type="number"
              min={carnet.mise}
              step={carnet.mise}
              required
              autoFocus
              value={montantDepot}
              onChange={(e) => setMontantDepot(e.target.value)}
            />
            <p className="mt-1 text-xs text-slate-400">Multiple de la mise.</p>
          </div>
          {erreur && <p className="text-sm font-medium text-rose-600">{erreur}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setModaleDepot(false)}>
              Annuler
            </button>
            <button type="submit" className="btn-primary">
              Vérifier
            </button>
          </div>
        </form>
      </Modale>

      <Modale titre="Confirmer le dépôt" ouverte={recapDepot} onFermer={() => setRecapDepot(false)}>
        {calcDepot?.ok && (
          <div className="space-y-4">
            <div className="rounded-xl bg-brand-50 p-4 text-sm text-brand-900">
              <div className="flex justify-between">
                <span>Montant du dépôt</span>
                <span className="font-bold">{formatMontant(Number(montantDepot))}</span>
              </div>
              <div className="mt-2 flex justify-between border-t border-brand-200 pt-2">
                <span>Carreaux</span>
                <span className="text-lg font-bold">{calcDepot.nombreMises}</span>
              </div>
              {payeesActuel === 0 && (
                <p className="mt-2 text-xs text-amber-800">
                  Dont 1 P.C ({formatMontant(carnet.mise)}) pour {NOM_APPLICATION}.
                </p>
              )}
              {payeesActuel + calcDepot.nombreMises >= carnet.misesParCycle && (
                <p className="mt-2 text-xs font-medium text-brand-800">
                  Ce dépôt complète le cycle : passage automatique au mois suivant.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setRecapDepot(false)}>
                Modifier
              </button>
              <button type="button" className="btn-primary" onClick={validerDepot}>
                Valider le dépôt
              </button>
            </div>
          </div>
        )}
      </Modale>

      {/* Modale retrait partiel */}
      <Modale
        titre={retraitSur ? `Retrait partiel — ${retraitSur.moisLabel}` : ''}
        ouverte={retraitSur !== null}
        onFermer={() => setRetraitSur(null)}
      >
        {retraitSur && (
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              await validerRetrait(false)
            }}
            className="space-y-4"
          >
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-rose-50 px-2 py-2.5 ring-1 ring-rose-100">
                <div className="text-[10px] font-medium uppercase text-slate-500">Retirées</div>
                <div className="text-base font-bold text-rose-800">{retraitSur.retires}</div>
              </div>
              <div className="rounded-xl bg-amber-50 px-2 py-2.5 ring-1 ring-amber-100">
                <div className="text-[10px] font-medium uppercase text-slate-500">Disponibles</div>
                <div className="text-base font-bold text-amber-900">{retraitSur.retirables}</div>
              </div>
              <div className="rounded-xl bg-emerald-50 px-2 py-2.5 ring-1 ring-emerald-100">
                <div className="text-[10px] font-medium uppercase text-slate-500">Montant dispo.</div>
                <div className="text-sm font-bold text-emerald-800">
                  {formatMontant(retraitSur.montantRetirable)}
                </div>
              </div>
            </div>
            <div>
              <label className="label">Nombre de mises à retirer *</label>
              <input
                className="input"
                type="number"
                min={1}
                max={retraitSur.retirables}
                required
                value={nbCarreaux}
                onChange={(e) => setNbCarreaux(e.target.value)}
              />
            </div>
            {(() => {
              const n = Number(nbCarreaux) || 0
              const dispoApres = Math.max(0, retraitSur.retirables - n)
              return (
                <div className="rounded-xl bg-slate-50 p-3 text-sm space-y-1.5">
                  <div className="flex justify-between font-semibold text-rose-800">
                    <span>Montant du retrait</span>
                    <span>{formatMontant(carnet.mise * n)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600 border-t border-slate-200 pt-1.5">
                    <span>Mises retirées après</span>
                    <span className="font-bold text-slate-900">{retraitSur.retires + n}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Mises disponibles après</span>
                    <span className="font-bold text-slate-900">{dispoApres}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Montant disponible après</span>
                    <span className="font-bold text-emerald-700">{formatMontant(dispoApres * carnet.mise)}</span>
                  </div>
                </div>
              )
            })()}
            {erreur && <p className="text-sm font-medium text-rose-600">{erreur}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setRetraitSur(null)}>
                Annuler
              </button>
              <button type="submit" className="btn-primary">
                Valider le retrait
              </button>
            </div>
          </form>
        )}
      </Modale>
    </div>
  )
}
