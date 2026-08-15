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
import { CYCLES_PAR_CARNET, MOIS_MIN_RETRAIT_CARTE } from '../types'
import {
  CARNETS_RETRAIT_6_MOIS,
  LIBELLES_CARNET,
  calculerMisesDepuisMontant,
  carreauxNets,
  eligibiliteRetraitCarnet,
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
    encaisserCotisation,
    retraitCycle,
    basculerVerrouCarnet,
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
  const peutOperer = aDroit('operer_comptes')
  const peutVerrouiller = aDroit('verrouiller_comptes')

  const cycles = useMemo(
    () => (carnet ? situationsCycles(carnet, data.mises) : []),
    [carnet, data.mises],
  )

  const payeesActuel = carnet ? carreauxNets(carnet, data.mises) : 0
  const moisActuel = carnet ? moisDuCycle(carnet, carnet.cycleActuel) : null
  const eligibilite = carnet ? eligibiliteRetraitCarnet(carnet, data.mises) : { autorise: true }
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
    const resultat = encaisserCotisation(carnet.id, montant)
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
    const resultat = retraitCycle(carnet.id, cycle, n)
    setRetraitSur(null)
    setNbCarreaux('1')
    setErreur('')
    if (resultat) {
      await alerter('Retrait échoué', resultat)
      return
    }
    await alerter(
      'Retrait effectué',
      `Retrait ${total ? 'total' : 'partiel'} de ${formatMontant(montant)} (${n} carreau${n > 1 ? 'x' : ''}) — ${retraitSur.moisLabel} — ${client.prenom} ${client.nom} (carnet ${carnet.numero}).`,
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
        sousTitre={`${LIBELLES_CARNET[carnet.typeCarnet]} — ${client.prenom} ${client.nom} (${client.codeClient})`}
        action={
          <div className="flex flex-wrap gap-2">
            {peutOperer && payeesActuel < carnet.misesParCycle && (
              <button
                className="btn-primary"
                disabled={carnet.verrouille}
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
                  if (ok) basculerVerrouCarnet(carnet.id)
                }}
              >
                {carnet.verrouille ? <LockOpen className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
              </button>
            )}
          </div>
        }
      />

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
          À {carnet.misesParCycle} carreaux, le compte passe automatiquement au mois suivant. Les retraits se font sur les
          cycles passés.
        </p>
        {CARNETS_RETRAIT_6_MOIS.includes(carnet.typeCarnet) && !eligibilite.autorise && eligibilite.dateDeblocage && (
          <p className="mt-2 rounded-xl bg-amber-50 p-2.5 text-xs text-amber-800">
            Retrait après {MOIS_MIN_RETRAIT_CARTE} mois : possible à partir du {formatDate(eligibilite.dateDeblocage)}.
          </p>
        )}
      </div>

      {/* Historique des cycles / mois */}
      <div className="card !p-0 overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="font-semibold text-slate-900">Mois (cycles) et état</h3>
          <p className="text-xs text-slate-500">
            Chaque cycle correspond à un mois. Un mois soldé (retrait total hors P.C) apparaît grisé. P.C = 1 carreau
            pour {NOM_APPLICATION}.
          </p>
        </div>
        <div className="divide-y divide-slate-100">
          {[...cycles].reverse().map((et) => (
            <div
              key={et.cycle}
              className={`flex flex-wrap items-center justify-between gap-3 px-5 py-4 ${
                et.grise ? 'bg-slate-100/80' : et.estActuel ? 'bg-brand-50/40' : 'bg-white'
              } ${et.grise ? 'text-slate-500' : ''}`}
            >
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
                  Déposé {et.deposes}/{carnet.misesParCycle} · retiré {et.retires} · reste{' '}
                  {et.retirables} carreau{et.retirables > 1 ? 'x' : ''} ({formatMontant(et.montantRetirable)})
                </p>
              </div>
              {peutOperer &&
                !et.estActuel &&
                et.retirables > 0 &&
                eligibilite.autorise &&
                !carnet.verrouille && (
                  <div className="flex gap-2">
                    <button
                      className="btn-secondary !py-1.5 text-xs"
                      onClick={() => {
                        setRetraitSur(et)
                        setNbCarreaux('1')
                        setErreur('')
                      }}
                    >
                      <ArrowUpFromLine className="h-3.5 w-3.5" />
                      Retrait partiel
                    </button>
                    <button
                      className="btn-primary !py-1.5 text-xs"
                      onClick={async () => {
                        const ok = await confirmer({
                          titre: `Retrait total — ${et.moisLabel}`,
                          message: `Retirer ${formatMontant(et.montantRetirable)} (${et.retirables} carreaux hors P.C) pour ${client.prenom} ${client.nom} (${et.moisLabel}) ?\nLe cycle sera ensuite grisé.`,
                          labelValider: 'Retrait total',
                        })
                        if (!ok) return
                        const resultat = retraitCycle(carnet.id, et.cycle, et.retirables)
                        if (resultat) await alerter('Retrait échoué', resultat)
                        else
                          await alerter(
                            'Retrait effectué',
                            `Retrait total de ${formatMontant(et.montantRetirable)} sur ${et.moisLabel} — carnet ${carnet.numero}.`,
                          )
                      }}
                    >
                      Retrait total
                    </button>
                  </div>
                )}
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
            <div className="rounded-xl bg-slate-50 p-3 text-sm">
              Disponibles (hors P.C) : <span className="font-bold">{retraitSur.retirables}</span> — max{' '}
              {formatMontant(retraitSur.montantRetirable)}
            </div>
            <div>
              <label className="label">Nombre de carreaux *</label>
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
            <div className="rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-800">
              Montant : {formatMontant(carnet.mise * (Number(nbCarreaux) || 0))}
            </div>
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
