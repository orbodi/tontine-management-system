import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpFromLine, CheckCircle2, HandCoins, Lock, LockOpen, Plus, Search } from 'lucide-react'
import { useStore } from '../store'
import {
  CYCLES_PAR_CARNET,
  MOIS_MIN_RETRAIT_CARTE,
  PRIX_CARNET,
  type CarnetTontine,
  type FrequenceMise,
  type TypeCarnet,
} from '../types'
import {
  CARNETS_RETRAIT_6_MOIS,
  LIBELLES_CARNET,
  calculerMisesDepuisMontant,
  carreauxNets,
  eligibiliteRetraitCarnet,
} from '../metier'
import { formatDate, formatMontant } from '../utils'
import { Avatar, EnTetePage, EtatVide, Modale } from '../components/ui'
import { useConfirmation } from '../components/Confirmation'

const LIBELLES_FREQUENCE: Record<FrequenceMise, string> = {
  journaliere: 'Journalière',
  hebdomadaire: 'Hebdomadaire',
}

const STYLES_CARNET: Record<TypeCarnet, string> = {
  tontine: 'bg-amber-100 text-amber-700',
  carte_tous: 'bg-sky-100 text-sky-700',
  carte_enfants: 'bg-violet-100 text-violet-700',
  carte_bloquee: 'bg-slate-200 text-slate-700',
}

export default function Tontines() {
  const {
    data,
    aDroit,
    ouvrirCarnet,
    encaisserCotisation,
    retraitPartielCarnet,
    cloturerCycle,
    basculerVerrouCarnet,
  } = useStore()
  const { confirmer, alerter } = useConfirmation()
  const [recherche, setRecherche] = useState('')
  const [typeFiltre, setTypeFiltre] = useState<'tous' | TypeCarnet>('tous')
  const [modaleOuverture, setModaleOuverture] = useState(false)
  const [clientChoisi, setClientChoisi] = useState('')
  const [typeNouveauCarnet, setTypeNouveauCarnet] = useState<TypeCarnet>('tontine')
  const [mise, setMise] = useState('')
  const [frequence, setFrequence] = useState<FrequenceMise>('journaliere')
  const [encaissement, setEncaissement] = useState<CarnetTontine | null>(null)
  const [montantCotise, setMontantCotise] = useState('')
  const [recapOuvert, setRecapOuvert] = useState(false)
  const [retraitPartiel, setRetraitPartiel] = useState<CarnetTontine | null>(null)
  const [nbCarreauxRetrait, setNbCarreauxRetrait] = useState('1')
  const [cloture, setCloture] = useState<CarnetTontine | null>(null)
  const [nouvelleMise, setNouvelleMise] = useState('')
  const [erreur, setErreur] = useState('')

  const peutOperer = aDroit('operer_comptes')
  const peutVerrouiller = aDroit('verrouiller_comptes')

  const clientDuCarnet = (c: CarnetTontine) => data.clients.find((x) => x.id === c.clientId)

  const carnetsFiltres = useMemo(() => {
    const q = recherche.trim().toLowerCase()
    return data.carnets
      .filter((c) => c.actif)
      .filter((c) => typeFiltre === 'tous' || c.typeCarnet === typeFiltre)
      .filter((c) => {
        const client = clientDuCarnet(c)
        return (
          !q ||
          c.numero.includes(q) ||
          (client && `${client.prenom} ${client.nom} ${client.codeClient}`.toLowerCase().includes(q))
        )
      })
  }, [data.carnets, data.clients, recherche, typeFiltre])

  const clientsSansCarnet = data.clients.filter(
    (c) => c.actif && !data.carnets.some((k) => k.actif && k.clientId === c.id),
  )

  const encoursTotal = data.carnets
    .filter((c) => c.actif)
    .reduce((s, c) => s + Math.max(0, carreauxNets(c, data.mises)) * c.mise, 0)

  const calcRecap = encaissement
    ? calculerMisesDepuisMontant(Number(montantCotise) || 0, encaissement.mise)
    : null

  const creerCarnet = (e: React.FormEvent) => {
    e.preventDefault()
    const err = ouvrirCarnet(clientChoisi, typeNouveauCarnet, Number(mise), frequence)
    if (err) {
      setErreur(err)
      return
    }
    setModaleOuverture(false)
    setClientChoisi('')
    setMise('')
    setErreur('')
  }

  const ouvrirRecap = (e: React.FormEvent) => {
    e.preventDefault()
    if (!encaissement) return
    const calc = calculerMisesDepuisMontant(Number(montantCotise), encaissement.mise)
    if (!calc.ok) {
      setErreur(calc.erreur)
      return
    }
    const payees = carreauxNets(encaissement, data.mises)
    const restants = encaissement.misesParCycle - payees
    if (calc.nombreMises > restants) {
      setErreur(`Seulement ${restants} carreau(x) restant(s) sur ce cycle.`)
      return
    }
    setErreur('')
    setRecapOuvert(true)
  }

  const validerEncaissement = async () => {
    if (!encaissement) return
    const resultat = encaisserCotisation(encaissement.id, Number(montantCotise))
    if (resultat) {
      setErreur(resultat)
      setRecapOuvert(false)
      return
    }
    setRecapOuvert(false)
    setEncaissement(null)
    setMontantCotise('')
    setErreur('')
  }

  const filtres: { valeur: 'tous' | TypeCarnet; label: string }[] = [
    { valeur: 'tous', label: 'Tous' },
    { valeur: 'tontine', label: 'Tontine' },
    { valeur: 'carte_tous', label: 'Carte pour tous' },
    { valeur: 'carte_enfants', label: 'Carte enfants' },
    { valeur: 'carte_bloquee', label: 'Carte bloquée' },
  ]

  return (
    <div>
      <EnTetePage
        titre="Tontine et cartes"
        sousTitre={`${data.carnets.filter((c) => c.actif).length} carnets actifs — encours : ${formatMontant(encoursTotal)} — carnet ${formatMontant(PRIX_CARNET)} / 12 cycles`}
        action={
          peutOperer && (
            <button className="btn-primary" onClick={() => setModaleOuverture(true)} disabled={clientsSansCarnet.length === 0}>
              <Plus className="h-4 w-4" />
              Ouvrir un carnet
            </button>
          )
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="relative max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-10"
            placeholder="Rechercher client ou n° carnet…"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {filtres.map((f) => (
            <button
              key={f.valeur}
              onClick={() => setTypeFiltre(f.valeur)}
              className={`rounded-xl px-3.5 py-2 text-sm font-medium transition ${
                typeFiltre === f.valeur
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {carnetsFiltres.length === 0 ? (
        <EtatVide titre="Aucun carnet" />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {carnetsFiltres.map((carnet) => {
            const client = clientDuCarnet(carnet)
            if (!client) return null
            const payees = carreauxNets(carnet, data.mises)
            const complet = payees >= carnet.misesParCycle
            const solde = Math.max(0, payees) * carnet.mise
            const eligibilite = eligibiliteRetraitCarnet(carnet, data.mises)
            return (
              <div
                key={carnet.id}
                className={`card ${complet ? 'ring-2 ring-brand-400' : ''} ${carnet.verrouille ? 'opacity-90 ring-2 ring-rose-200' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <Avatar nom={client.nom} prenom={client.prenom} taille="lg" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link to={`/clients/${client.id}`} className="truncate font-semibold text-slate-900 hover:text-brand-700">
                        {client.prenom} {client.nom}
                      </Link>
                      <span className={`badge ${STYLES_CARNET[carnet.typeCarnet]}`}>
                        {LIBELLES_CARNET[carnet.typeCarnet]}
                      </span>
                      {carnet.verrouille && (
                        <span className="badge bg-rose-100 text-rose-700">
                          <Lock className="mr-1 h-3 w-3" />
                          Verrouillé
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">
                      <span className="font-mono font-semibold text-brand-700">{carnet.numero}</span> — cycle{' '}
                      {carnet.cycleActuel}/{CYCLES_PAR_CARNET} — {formatDate(carnet.dateOuverture)}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-slate-500">Mise ({LIBELLES_FREQUENCE[carnet.frequence].toLowerCase()})</div>
                    <div className="font-bold text-slate-900">{formatMontant(carnet.mise)}</div>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="mb-1 flex justify-between text-xs text-slate-500">
                    <span>
                      <span className="font-semibold text-slate-700">{payees}/{carnet.misesParCycle}</span> carreaux
                    </span>
                    <span>
                      Collecté : <span className="font-semibold text-slate-700">{formatMontant(solde)}</span>
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full ${complet ? 'bg-brand-500' : 'bg-brand-400'}`}
                      style={{ width: `${Math.min(100, (Math.max(0, payees) / carnet.misesParCycle) * 100)}%` }}
                    />
                  </div>
                </div>

                {!eligibilite.autorise && eligibilite.dateDeblocage && (
                  <p className="mt-3 rounded-xl bg-amber-50 p-2.5 text-xs text-amber-800">
                    Retrait après {MOIS_MIN_RETRAIT_CARTE} mois : possible à partir du {formatDate(eligibilite.dateDeblocage)}.
                  </p>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                  {peutOperer && !complet && (
                    <button
                      className="btn-primary flex-1 !py-2 text-xs"
                      disabled={carnet.verrouille}
                      onClick={() => {
                        setEncaissement(carnet)
                        setMontantCotise('')
                        setErreur('')
                      }}
                    >
                      <HandCoins className="h-4 w-4" />
                      Cotiser
                    </button>
                  )}
                  {peutOperer && payees > 1 && (
                    <button
                      className="btn-secondary flex-1 !py-2 text-xs"
                      disabled={carnet.verrouille || !eligibilite.autorise}
                      onClick={() => {
                        setRetraitPartiel(carnet)
                        setNbCarreauxRetrait('1')
                        setErreur('')
                      }}
                    >
                      <ArrowUpFromLine className="h-4 w-4" />
                      Retrait partiel
                    </button>
                  )}
                  {peutOperer && payees > 0 && (
                    <button
                      className={`${complet ? 'btn-primary' : 'btn-secondary'} flex-1 !py-2 text-xs`}
                      disabled={carnet.verrouille || !eligibilite.autorise}
                      onClick={() => {
                        setCloture(carnet)
                        setNouvelleMise(String(carnet.mise))
                        setErreur('')
                      }}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Clôturer
                    </button>
                  )}
                  {peutVerrouiller && (
                    <button
                      className="btn-secondary !px-3 !py-2 text-xs"
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
              </div>
            )
          })}
        </div>
      )}

      {/* Ouverture */}
      <Modale titre="Ouvrir un carnet" ouverte={modaleOuverture} onFermer={() => setModaleOuverture(false)}>
        <form onSubmit={creerCarnet} className="space-y-4">
          <div>
            <label className="label">Type *</label>
            <select className="input" value={typeNouveauCarnet} onChange={(e) => setTypeNouveauCarnet(e.target.value as TypeCarnet)}>
              <option value="tontine">Tontine</option>
              <option value="carte_tous">Carte pour tous</option>
              <option value="carte_enfants">Carte pour enfants</option>
              <option value="carte_bloquee">Carte bloquée</option>
            </select>
            {CARNETS_RETRAIT_6_MOIS.includes(typeNouveauCarnet) && (
              <p className="mt-1 text-xs text-amber-700">Retrait après {MOIS_MIN_RETRAIT_CARTE} mois min.</p>
            )}
          </div>
          <div>
            <label className="label">Client *</label>
            <select className="input" required value={clientChoisi} onChange={(e) => setClientChoisi(e.target.value)}>
              <option value="">— Choisir —</option>
              {clientsSansCarnet.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.codeClient} — {c.prenom} {c.nom}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Mise (FCFA) *</label>
              <input className="input" type="number" min={100} required value={mise} onChange={(e) => setMise(e.target.value)} />
            </div>
            <div>
              <label className="label">Fréquence</label>
              <select className="input" value={frequence} onChange={(e) => setFrequence(e.target.value as FrequenceMise)}>
                <option value="journaliere">Journalière</option>
                <option value="hebdomadaire">Hebdomadaire</option>
              </select>
            </div>
          </div>
          <div className="rounded-xl bg-brand-50 p-3 text-sm text-brand-800">
            31 carreaux × 12 cycles — carnet vendu {formatMontant(PRIX_CARNET)}. P.C = 1re mise.
          </div>
          {erreur && <p className="text-sm font-medium text-rose-600">{erreur}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setModaleOuverture(false)}>
              Annuler
            </button>
            <button type="submit" className="btn-primary">
              Ouvrir
            </button>
          </div>
        </form>
      </Modale>

      {/* Cotisation par montant */}
      <Modale
        titre={encaissement ? `Cotiser — ${clientDuCarnet(encaissement)?.prenom ?? ''} ${clientDuCarnet(encaissement)?.nom ?? ''}` : ''}
        ouverte={encaissement !== null && !recapOuvert}
        onFermer={() => setEncaissement(null)}
      >
        {encaissement && (
          <form onSubmit={ouvrirRecap} className="space-y-4">
            <div className="rounded-xl bg-slate-50 p-3 text-sm">
              Mise : <span className="font-bold">{formatMontant(encaissement.mise)}</span> — carreaux :{' '}
              <span className="font-bold">
                {carreauxNets(encaissement, data.mises)}/{encaissement.misesParCycle}
              </span>
            </div>
            <div>
              <label className="label">Montant cotisé (FCFA) *</label>
              <input
                className="input"
                type="number"
                min={encaissement.mise}
                step={encaissement.mise}
                required
                autoFocus
                value={montantCotise}
                onChange={(e) => setMontantCotise(e.target.value)}
              />
              <p className="mt-1 text-xs text-slate-400">Doit être un multiple de la mise.</p>
            </div>
            {erreur && <p className="text-sm font-medium text-rose-600">{erreur}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setEncaissement(null)}>
                Annuler
              </button>
              <button type="submit" className="btn-primary">
                Vérifier
              </button>
            </div>
          </form>
        )}
      </Modale>

      {/* Récap cotisation */}
      <Modale titre="Confirmer la cotisation" ouverte={recapOuvert} onFermer={() => setRecapOuvert(false)}>
        {encaissement && calcRecap?.ok && (
          <div className="space-y-4">
            <div className="rounded-xl bg-brand-50 p-4 text-sm text-brand-900">
              <div className="flex justify-between">
                <span>Montant saisi</span>
                <span className="font-bold">{formatMontant(Number(montantCotise))}</span>
              </div>
              <div className="flex justify-between">
                <span>Mise unitaire</span>
                <span className="font-bold">{formatMontant(encaissement.mise)}</span>
              </div>
              <div className="mt-2 flex justify-between border-t border-brand-200 pt-2">
                <span>Nombre de carreaux</span>
                <span className="text-lg font-bold">{calcRecap.nombreMises}</span>
              </div>
              {carreauxNets(encaissement, data.mises) === 0 && (
                <p className="mt-2 text-xs text-amber-800">
                  Dont 1 P.C ({formatMontant(encaissement.mise)}) pour la microfinance.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setRecapOuvert(false)}>
                Modifier
              </button>
              <button type="button" className="btn-primary" onClick={validerEncaissement}>
                Valider
              </button>
            </div>
          </div>
        )}
      </Modale>

      {/* Retrait partiel */}
      <Modale
        titre={retraitPartiel ? `Retrait partiel — ${retraitPartiel.numero}` : ''}
        ouverte={retraitPartiel !== null}
        onFermer={() => setRetraitPartiel(null)}
      >
        {retraitPartiel && (
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              const n = Number(nbCarreauxRetrait)
              const resultat = retraitPartielCarnet(retraitPartiel.id, n)
              if (resultat) {
                setErreur(resultat)
                return
              }
              setRetraitPartiel(null)
              setErreur('')
            }}
            className="space-y-4"
          >
            <div className="rounded-xl bg-slate-50 p-3 text-sm">
              Niveau actuel :{' '}
              <span className="font-bold">
                {carreauxNets(retraitPartiel, data.mises)}/{retraitPartiel.misesParCycle}
              </span>{' '}
              — disponibles (hors P.C) :{' '}
              <span className="font-bold">{Math.max(0, carreauxNets(retraitPartiel, data.mises) - 1)}</span>
            </div>
            <div>
              <label className="label">Nombre de carreaux à retirer *</label>
              <input
                className="input"
                type="number"
                min={1}
                max={Math.max(0, carreauxNets(retraitPartiel, data.mises) - 1)}
                required
                value={nbCarreauxRetrait}
                onChange={(e) => setNbCarreauxRetrait(e.target.value)}
              />
            </div>
            <div className="rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-800">
              Montant : {formatMontant(retraitPartiel.mise * (Number(nbCarreauxRetrait) || 0))}
            </div>
            {erreur && <p className="text-sm font-medium text-rose-600">{erreur}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setRetraitPartiel(null)}>
                Annuler
              </button>
              <button type="submit" className="btn-primary">
                Valider le retrait
              </button>
            </div>
          </form>
        )}
      </Modale>

      {/* Clôture + éventuelle nouvelle mise */}
      <Modale
        titre={cloture ? `Clôturer le cycle ${cloture.cycleActuel}/${CYCLES_PAR_CARNET}` : ''}
        ouverte={cloture !== null}
        onFermer={() => setCloture(null)}
      >
        {cloture && (
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              const client = clientDuCarnet(cloture)
              const payees = carreauxNets(cloture, data.mises)
              const remise = cloture.mise * Math.max(0, payees - 1)
              const fin = cloture.cycleActuel >= CYCLES_PAR_CARNET
              const ok = await confirmer({
                titre: fin ? 'Renouveler le carnet (12 cycles)' : 'Clôturer le cycle',
                message: fin
                  ? `Fin des 12 cycles. Remise : ${formatMontant(remise)}. Un nouveau carnet sera vendu ${formatMontant(PRIX_CARNET)}.`
                  : `Remise au client : ${formatMontant(remise)} (${payees} carreaux − 1 P.C).${nouvelleMise && Number(nouvelleMise) !== cloture.mise ? `\nNouvelle mise au cycle suivant : ${formatMontant(Number(nouvelleMise))}.` : ''}`,
                labelValider: fin ? 'Renouveler' : 'Clôturer',
              })
              if (!ok) return
              const resultat = cloturerCycle(
                cloture.id,
                Number(nouvelleMise) !== cloture.mise ? Number(nouvelleMise) : undefined,
              )
              if (resultat) await alerter('Clôture impossible', resultat)
              else {
                setCloture(null)
                if (client) {
                  /* ok */
                }
              }
            }}
            className="space-y-4"
          >
            <div className="rounded-xl bg-slate-50 p-3 text-sm">
              Collecté :{' '}
              <span className="font-bold">
                {formatMontant(Math.max(0, carreauxNets(cloture, data.mises)) * cloture.mise)}
              </span>
            </div>
            <div>
              <label className="label">
                Mise du cycle suivant (modifiable uniquement à la clôture)
              </label>
              <input
                className="input"
                type="number"
                min={100}
                required
                value={nouvelleMise}
                onChange={(e) => setNouvelleMise(e.target.value)}
              />
            </div>
            {cloture.cycleActuel >= CYCLES_PAR_CARNET && (
              <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
                12e cycle : renouvellement du carnet ({formatMontant(PRIX_CARNET)}). Le n° conserve l'ordre
                client ; le code agence suit l'agence de paiement.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setCloture(null)}>
                Annuler
              </button>
              <button type="submit" className="btn-primary">
                Continuer
              </button>
            </div>
          </form>
        )}
      </Modale>
    </div>
  )
}
