import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Banknote,
  BellRing,
  HandCoins,
  PiggyBank,
  Plus,
  UserCheck,
  UserX,
  Wallet,
} from 'lucide-react'
import { MODULE_CREDITS_ACTIF, NOM_APPLICATION } from '../config'
import { useStore } from '../store'
import {
  CARNETS_RETRAIT_6_MOIS,
  LIBELLES_CARNET,
  TYPES_SORTIE,
  moisDuCycle,
  situationCredit,
  situationsCycles,
} from '../metier'
import {
  PRIX_CARNET,
  type FrequenceMise,
  type TypeCarnet,
  type TypeCompte,
} from '../types'
import { formatDate, formatDateHeure, formatMontant, numeroCarnet } from '../utils'
import { Avatar, BadgeStatutCredit, BoutonsMessage, EnTetePage, Modale } from '../components/ui'
import { useConfirmation } from '../components/Confirmation'

const LIBELLES_FREQUENCE: Record<FrequenceMise, string> = {
  journaliere: 'Journalière',
  hebdomadaire: 'Hebdomadaire',
}

export default function DetailClient() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data, aDroit, estCaissier, basculerActifClient, ouvrirCarnet, ouvrirCompte } = useStore()
  const { alerter } = useConfirmation()
  const [modaleMessage, setModaleMessage] = useState(false)
  const [texteMessage, setTexteMessage] = useState('')
  const [modaleCarnet, setModaleCarnet] = useState(false)
  const [modaleCompte, setModaleCompte] = useState(false)
  const [typeCarnet, setTypeCarnet] = useState<TypeCarnet>('tontine')
  const [mise, setMise] = useState('')
  const [frequence, setFrequence] = useState<FrequenceMise>('journaliere')
  const [typeCompte, setTypeCompte] = useState<TypeCompte>('courant')
  const [erreur, setErreur] = useState('')

  const client = data.clients.find((c) => c.id === id)
  const peutOperer = aDroit('operer_comptes')

  const activite = useMemo(() => {
    if (!client) return null
    const carnets = data.carnets.filter((c) => c.clientId === client.id)
    const comptes = data.comptes.filter((c) => c.clientId === client.id)
    const credits = data.credits.filter((c) => c.clientId === client.id)
    const transactions = data.transactions.filter((t) => t.clientId === client.id)

    const soldeTontine = carnets.reduce((s, carnet) => {
      const cycles = situationsCycles(carnet, data.mises)
      return s + cycles.reduce((x, et) => x + et.nets * carnet.mise, 0)
    }, 0)
    const soldeEpargne = comptes.reduce((s, c) => s + c.solde, 0)
    const detteCredits = credits
      .filter((c) => c.statut === 'en_cours' || c.statut === 'en_retard')
      .reduce((s, c) => s + situationCredit(c, data.remboursements).resteAPayer, 0)

    return { carnets, comptes, credits, transactions, soldeTontine, soldeEpargne, detteCredits }
  }, [client, data])

  if (!client || !activite) {
    return (
      <div>
        <Link to="/clients" className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-brand-600 hover:text-brand-700">
          <ArrowLeft className="h-4 w-4" />
          Retour aux clients
        </Link>
        <p className="text-slate-600">Client introuvable.</p>
      </div>
    )
  }

  const aCarnetActif = activite.carnets.some((c) => c.actif)
  const aCourant = activite.comptes.some((c) => c.type === 'courant')
  const aEpargne = activite.comptes.some((c) => c.type === 'epargne')
  const peutOuvrirCarnet = peutOperer && client.actif && !aCarnetActif
  const peutOuvrirCompte = peutOperer && !estCaissier && client.actif && (!aCourant || !aEpargne)

  const creditEnRetard = MODULE_CREDITS_ACTIF
    ? activite.credits.find((c) => c.statut === 'en_retard')
    : undefined

  const ouvrirModaleMessage = () => {
    let texte = `Bonjour ${client.prenom} ${client.nom}, `
    if (creditEnRetard) {
      const sit = situationCredit(creditEnRetard, data.remboursements)
      texte += `nous vous rappelons que votre crédit ${creditEnRetard.numero} présente un retard de paiement. Reste à payer : ${formatMontant(sit.resteAPayer)} (mensualité : ${formatMontant(sit.mensualite)}). Merci de passer à l'agence. ${NOM_APPLICATION}`
    } else {
      texte += `votre situation chez ${NOM_APPLICATION} : épargne ${formatMontant(activite.soldeEpargne)}, tontine en cours ${formatMontant(activite.soldeTontine)}. Merci de votre confiance.`
    }
    setTexteMessage(texte)
    setModaleMessage(true)
  }

  const creerCarnet = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!client.agenceId || !client.zoneId) {
      setErreur('Le client doit être rattaché à une agence et une zone.')
      return
    }
    const resultat = ouvrirCarnet(client.id, typeCarnet, Number(mise), frequence)
    if ('erreur' in resultat) {
      setErreur(resultat.erreur)
      await alerter('Ouverture impossible', resultat.erreur)
      return
    }
    const agence = data.agences.find((a) => a.id === client.agenceId)
    const zone = data.zones.find((z) => z.id === client.zoneId)
    setModaleCarnet(false)
    setMise('')
    setErreur('')
    await alerter(
      'Carnet ouvert',
      `Le carnet ${resultat.numero} (${LIBELLES_CARNET[typeCarnet]}) a été ouvert pour ${client.prenom} ${client.nom}.\nAgence : ${agence?.nom ?? '—'}\nZone : ${zone?.code ?? '—'}`,
    )
    navigate(`/tontines/${resultat.id}`)
  }

  const creerCompte = async (e: React.FormEvent) => {
    e.preventDefault()
    const resultat = ouvrirCompte(client.id, typeCompte)
    if ('erreur' in resultat) {
      setErreur(resultat.erreur)
      await alerter('Ouverture impossible', resultat.erreur)
      return
    }
    setModaleCompte(false)
    setErreur('')
    await alerter(
      'Compte ouvert',
      `Le compte ${resultat.numero} (${typeCompte === 'courant' ? 'courant' : 'épargne'}) a été ouvert pour ${client.prenom} ${client.nom}.`,
    )
  }

  return (
    <div>
      <Link to="/clients" className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-brand-600 hover:text-brand-700">
        <ArrowLeft className="h-4 w-4" />
        Retour aux clients
      </Link>

      <EnTetePage
        titre={`${client.prenom} ${client.nom}`}
        sousTitre={`${client.codeClient} — ${client.profession ?? 'Profession non renseignée'}`}
        action={
          <div className="flex flex-wrap gap-2">
            {peutOuvrirCarnet && (
              <button
                className="btn-primary"
                onClick={() => {
                  setErreur('')
                  setMise('')
                  setTypeCarnet('tontine')
                  setModaleCarnet(true)
                }}
              >
                <HandCoins className="h-4 w-4" />
                Ouvrir carnet tontine
              </button>
            )}
            {peutOuvrirCompte && (
              <button
                className="btn-secondary"
                onClick={() => {
                  setErreur('')
                  setTypeCompte(!aCourant ? 'courant' : 'epargne')
                  setModaleCompte(true)
                }}
              >
                <Wallet className="h-4 w-4" />
                Ouvrir un compte
              </button>
            )}
            <button className="btn-secondary" onClick={ouvrirModaleMessage}>
              <BellRing className="h-4 w-4" />
              Notifier
            </button>
            <button className="btn-secondary" onClick={() => basculerActifClient(client.id)}>
              {client.actif ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
              {client.actif ? 'Désactiver' : 'Réactiver'}
            </button>
          </div>
        }
      />

      {/* Fiche d'identité */}
      <div className="card mb-6">
        <div className="flex flex-wrap items-start gap-5">
          <Avatar nom={client.nom} prenom={client.prenom} taille="lg" />
          <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
            <div>
              <dt className="text-xs text-slate-500">Agence</dt>
              <dd className="font-medium text-slate-900">
                {data.agences.find((a) => a.id === client.agenceId)
                  ? `${data.agences.find((a) => a.id === client.agenceId)!.code} — ${data.agences.find((a) => a.id === client.agenceId)!.nom}`
                  : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Zone</dt>
              <dd className="font-medium text-slate-900">
                {(() => {
                  const z = data.zones.find((x) => x.id === client.zoneId)
                  return z ? `${z.code}${z.nom ? ` — ${z.nom}` : ''}` : '—'
                })()}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Téléphone</dt>
              <dd className="font-medium text-slate-900">{client.telephone}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Email</dt>
              <dd className="font-medium text-slate-900">{client.email ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Pièce d'identité</dt>
              <dd className="font-medium text-slate-900">{client.pieceIdentite ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Adresse</dt>
              <dd className="font-medium text-slate-900">{client.adresse ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Inscrit le</dt>
              <dd className="font-medium text-slate-900">{formatDate(client.dateInscription)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Statut</dt>
              <dd>
                <span className={`badge ${client.actif ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                  {client.actif ? 'Actif' : 'Inactif'}
                </span>
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Synthèse financière */}
      <div className={`mb-6 grid grid-cols-1 gap-4 ${MODULE_CREDITS_ACTIF ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
        <div className="card flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
            <HandCoins className="h-6 w-6" />
          </div>
          <div>
            <div className="text-lg font-bold text-slate-900">{formatMontant(activite.soldeTontine)}</div>
            <div className="text-sm text-slate-500">Tontine / cartes</div>
          </div>
        </div>
        <div className="card flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600">
            <PiggyBank className="h-6 w-6" />
          </div>
          <div>
            <div className="text-lg font-bold text-slate-900">{formatMontant(activite.soldeEpargne)}</div>
            <div className="text-sm text-slate-500">Comptes (courant + épargne)</div>
          </div>
        </div>
        {MODULE_CREDITS_ACTIF && (
          <div className="card flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-100 text-violet-600">
              <Banknote className="h-6 w-6" />
            </div>
            <div>
              <div className="text-lg font-bold text-slate-900">{formatMontant(activite.detteCredits)}</div>
              <div className="text-sm text-slate-500">Crédits restant dus</div>
            </div>
          </div>
        )}
      </div>

      <div className={`grid grid-cols-1 gap-6 ${MODULE_CREDITS_ACTIF ? 'xl:grid-cols-2' : ''}`}>
        {MODULE_CREDITS_ACTIF && (
          <div className="card">
            <h3 className="mb-4 font-semibold text-slate-900">Crédits</h3>
            {activite.credits.length === 0 ? (
              <p className="text-sm text-slate-500">Aucun crédit.</p>
            ) : (
              <div className="space-y-3">
                {activite.credits.map((c) => {
                  const sit = situationCredit(c, data.remboursements)
                  return (
                    <div key={c.id} className="rounded-xl border border-slate-200 p-3">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-semibold text-brand-700">{c.numero}</span>
                        <BadgeStatutCredit statut={c.statut} />
                      </div>
                      <div className="mt-1 text-sm font-semibold text-slate-900">
                        {formatMontant(c.montant)} sur {c.dureeMois} mois — {c.motif ?? 'Sans motif'}
                      </div>
                      {(c.statut === 'en_cours' || c.statut === 'en_retard') && (
                        <div className="mt-1 text-xs text-slate-500">
                          Payé {formatMontant(sit.dejaPaye)} / {formatMontant(sit.totalDu)} — reste{' '}
                          <span className="font-semibold text-slate-700">{formatMontant(sit.resteAPayer)}</span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Comptes et carnets */}
        <div className="card">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold text-slate-900">Comptes et carnets</h3>
            <div className="flex flex-wrap gap-2">
              {peutOuvrirCarnet && (
                <button
                  type="button"
                  className="btn-primary !py-1.5 text-xs"
                  onClick={() => {
                    setErreur('')
                    setMise('')
                    setModaleCarnet(true)
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Carnet tontine
                </button>
              )}
              {peutOuvrirCompte && (
                <button
                  type="button"
                  className="btn-secondary !py-1.5 text-xs"
                  onClick={() => {
                    setErreur('')
                    setTypeCompte(!aCourant ? 'courant' : 'epargne')
                    setModaleCompte(true)
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Compte
                </button>
              )}
            </div>
          </div>
          <div className="space-y-3">
            {activite.comptes.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-xl border border-slate-200 p-3 text-sm">
                <div>
                  <span className="font-mono text-xs font-semibold text-brand-700">{c.numero}</span>
                  <span className="ml-2 text-slate-600">
                    {c.type === 'courant' ? 'Compte courant' : 'Compte épargne'}
                  </span>
                  {c.verrouille && <span className="badge ml-2 bg-rose-100 text-rose-700">Verrouillé</span>}
                </div>
                <span className="font-bold text-slate-900">{formatMontant(c.solde)}</span>
              </div>
            ))}
            {activite.carnets.map((carnet) => {
              const cycles = situationsCycles(carnet, data.mises)
              const actuel = cycles.find((c) => c.estActuel)
              const mois = moisDuCycle(carnet, carnet.cycleActuel)
              const mises = actuel?.nets ?? 0
              return (
                <Link
                  key={carnet.id}
                  to={`/tontines/${carnet.id}`}
                  className="block rounded-xl border border-slate-200 p-3 text-sm transition hover:border-brand-300 hover:bg-brand-50/30"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">
                      <span className="font-mono text-xs font-semibold text-brand-700">{carnet.numero}</span>{' '}
                      {LIBELLES_CARNET[carnet.typeCarnet]} — mise {formatMontant(carnet.mise)} — {mois.label} (
                      {carnet.cycleActuel}/12)
                      {carnet.verrouille && <span className="badge ml-2 bg-rose-100 text-rose-700">Verrouillé</span>}
                    </span>
                    <span className="font-bold text-slate-900">
                      {mises}/{carnet.misesParCycle}
                    </span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-brand-500"
                      style={{ width: `${(mises / carnet.misesParCycle) * 100}%` }}
                    />
                  </div>
                </Link>
              )
            })}
            {activite.comptes.length === 0 && activite.carnets.length === 0 && (
              <p className="text-sm text-slate-500">Aucun compte ni carnet. Utilisez les raccourcis ci-dessus pour en créer.</p>
            )}
          </div>
        </div>
      </div>

      {/* Historique */}
      <div className="card mt-6">
        <h3 className="mb-4 font-semibold text-slate-900">
          Historique des opérations ({activite.transactions.length})
        </h3>
        {activite.transactions.length === 0 ? (
          <p className="text-sm text-slate-500">Aucune opération.</p>
        ) : (
          <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
            {activite.transactions.map((t) => {
              const sortie = TYPES_SORTIE.includes(t.type)
              return (
                <div key={t.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-800">{t.description}</p>
                    <p className="text-xs text-slate-500">
                      {formatDateHeure(t.date)} — par {t.operateur}
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
        )}
      </div>

      {/* Modale carnet tontine */}
      <Modale
        titre={`Ouvrir un carnet — ${client.prenom} ${client.nom}`}
        ouverte={modaleCarnet}
        onFermer={() => setModaleCarnet(false)}
      >
        <form onSubmit={creerCarnet} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Agence *</label>
              <input
                className="input bg-slate-50"
                readOnly
                required
                value={
                  data.agences.find((a) => a.id === client.agenceId)
                    ? `${data.agences.find((a) => a.id === client.agenceId)!.nom}`
                    : ''
                }
              />
            </div>
            <div>
              <label className="label">Zone *</label>
              <input
                className="input bg-slate-50 font-mono"
                readOnly
                required
                value={
                  (() => {
                    const z = data.zones.find((x) => x.id === client.zoneId)
                    return z ? `${z.code}${z.nom ? ` — ${z.nom}` : ''}` : ''
                  })()
                }
              />
            </div>
          </div>
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            N° carnet prévu :{' '}
            <span className="font-mono font-bold text-brand-700">
              {(() => {
                const z = data.zones.find((x) => x.id === client.zoneId)
                return z ? numeroCarnet(z.code, client.ordreZone) : '—'
              })()}
            </span>
          </p>
          <div>
            <label className="label">Type *</label>
            <select className="input" value={typeCarnet} onChange={(e) => setTypeCarnet(e.target.value as TypeCarnet)}>
              <option value="tontine">Tontine</option>
              <option value="carte_tous">Carte pour tous</option>
              <option value="carte_enfants">Carte pour enfants</option>
              <option value="carte_bloquee">Carte bloquée</option>
            </select>
            {CARNETS_RETRAIT_6_MOIS.includes(typeCarnet) && (
              <p className="mt-1 text-xs text-amber-700">
                Retraits grisés jusqu’à activation par l’administrateur (délai indicatif 6 mois).
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Mise (FCFA) *</label>
              <input className="input" type="number" min={100} required value={mise} onChange={(e) => setMise(e.target.value)} />
            </div>
            <div>
              <label className="label">Fréquence *</label>
              <select className="input" value={frequence} onChange={(e) => setFrequence(e.target.value as FrequenceMise)}>
                <option value="journaliere">{LIBELLES_FREQUENCE.journaliere}</option>
                <option value="hebdomadaire">{LIBELLES_FREQUENCE.hebdomadaire}</option>
              </select>
            </div>
          </div>
          <div className="rounded-xl bg-brand-50 p-3 text-sm text-brand-800">
            Carnet {formatMontant(PRIX_CARNET)} — 31 carreaux × 12 mois.
          </div>
          {erreur && <p className="text-sm font-medium text-rose-600">{erreur}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setModaleCarnet(false)}>
              Annuler
            </button>
            <button type="submit" className="btn-primary">
              Ouvrir le carnet
            </button>
          </div>
        </form>
      </Modale>

      {/* Modale compte courant / épargne */}
      <Modale
        titre={`Ouvrir un compte — ${client.prenom} ${client.nom}`}
        ouverte={modaleCompte}
        onFermer={() => setModaleCompte(false)}
      >
        <form onSubmit={creerCompte} className="space-y-4">
          <div>
            <label className="label">Type de compte *</label>
            <select className="input" value={typeCompte} onChange={(e) => setTypeCompte(e.target.value as TypeCompte)}>
              {!aCourant && <option value="courant">Compte courant (n° Bxxxx)</option>}
              {!aEpargne && <option value="epargne">Compte épargne (n° Bxxxx)</option>}
            </select>
          </div>
          {erreur && <p className="text-sm font-medium text-rose-600">{erreur}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setModaleCompte(false)}>
              Annuler
            </button>
            <button type="submit" className="btn-primary">
              <Wallet className="h-4 w-4" />
              Ouvrir le compte
            </button>
          </div>
        </form>
      </Modale>

      {/* Modale notification */}
      <Modale titre="Notifier le client" ouverte={modaleMessage} onFermer={() => setModaleMessage(false)}>
        <div className="space-y-4">
          <div>
            <label className="label">Message (modifiable)</label>
            <textarea
              className="input min-h-32"
              value={texteMessage}
              onChange={(e) => setTexteMessage(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Envoyer via</label>
            <BoutonsMessage telephone={client.telephone} message={texteMessage} />
          </div>
          <p className="text-xs text-slate-400">
            Le message s'ouvre dans votre application SMS ou WhatsApp avec le texte pré-rempli.
          </p>
        </div>
      </Modale>
    </div>
  )
}
