import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Banknote,
  BellRing,
  HandCoins,
  PiggyBank,
  Plus,
  Trash2,
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
  TYPES_CARNET,
  type FrequenceMise,
  type TypeCarnet,
  type TypeCompte,
} from '../types'
import { formatDate, formatDateHeure, formatMontant, afficherNumeroClient } from '../utils'
import { Avatar, BadgeStatutCredit, BoutonsMessage, EnTetePage, Modale } from '../components/ui'
import { useConfirmation } from '../components/Confirmation'

const LIBELLES_FREQUENCE: Record<FrequenceMise, string> = {
  journaliere: 'Journalière',
  hebdomadaire: 'Hebdomadaire',
}

export default function DetailClient() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data, aDroit, estAdmin, estCaissier, employeConnecte, basculerActifClient, supprimerClient, supprimerCompte, ouvrirCarnet, ouvrirCompte } =
    useStore()
  const { alerter, confirmer } = useConfirmation()
  const [modaleMessage, setModaleMessage] = useState(false)
  const [texteMessage, setTexteMessage] = useState('')
  const [modaleCarnet, setModaleCarnet] = useState(false)
  const [modaleCompte, setModaleCompte] = useState(false)
  const [typeCarnet, setTypeCarnet] = useState<TypeCarnet>('tontine')
  const [mise, setMise] = useState('')
  const [frequence, setFrequence] = useState<FrequenceMise>('journaliere')
  const [typeCompte, setTypeCompte] = useState<TypeCompte>('courant')
  const [promoCompte, setPromoCompte] = useState(false)
  const [caissierPourCompte, setCaissierPourCompte] = useState('')
  const [fraisCompte, setFraisCompte] = useState({
    partSociale: 5000,
    droitAdhesion: 2500,
    droitAdhesionPromo: 500,
  })
  const [erreur, setErreur] = useState('')

  const client = data.clients.find((c) => c.id === id)
  const peutOperer = aDroit('operer_comptes')

  useEffect(() => {
    void (async () => {
      try {
        const { apiFetch } = await import('../api/client')
        const p = await apiFetch<{
          partSociale: number
          droitAdhesion: number
          droitAdhesionPromo: number
        }>('/api/parametres/ouverture-compte')
        setFraisCompte(p)
      } catch {
        /* gardes les défauts */
      }
    })()
  }, [])

  const activite = useMemo(() => {
    if (!client) return null
    const carnets = data.carnets.filter((c) => c.clientId === client.id)
    const comptes = data.comptes.filter((c) => c.clientId === client.id)
    const credits = data.credits.filter((c) => c.clientId === client.id)
    const transactions = data.transactions.filter((t) => {
      if (t.clientId !== client.id) return false
      // Caissier : uniquement ses propres opérations
      if (estCaissier && employeConnecte && t.operateurId !== employeConnecte.id) return false
      return true
    })

    const soldeTontine = carnets.reduce((s, carnet) => {
      const cycles = situationsCycles(carnet, data.mises)
      return s + cycles.reduce((x, et) => x + et.nets * carnet.mise, 0)
    }, 0)
    const soldeEpargne = comptes.reduce((s, c) => s + c.solde, 0)
    const detteCredits = credits
      .filter((c) => c.statut === 'en_cours' || c.statut === 'en_retard')
      .reduce((s, c) => s + situationCredit(c, data.remboursements).resteAPayer, 0)

    return { carnets, comptes, credits, transactions, soldeTontine, soldeEpargne, detteCredits }
  }, [client, data, estCaissier, employeConnecte])

  const retourClients = client ? `/clients/zone/${client.zoneId}` : '/clients'

  if (!client || !activite) {
    return (
      <div>
        <Link to="/clients" className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-brand-600 hover:text-brand-700">
          <ArrowLeft className="h-4 w-4" />
          Retour aux zones
        </Link>
        <p className="text-slate-600">Client introuvable.</p>
      </div>
    )
  }

  const typesCarnetDejaOuverts = new Set(activite.carnets.map((c) => c.typeCarnet))
  const peutOuvrirCarnet = peutOperer && client.actif && typesCarnetDejaOuverts.size < 4
  const peutOuvrirCompte = peutOperer && !estCaissier && client.actif

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
    const resultat = await ouvrirCarnet(client.id, typeCarnet, Number(mise), frequence)
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
    if (!caissierPourCompte) {
      setErreur('Indiquez la caisse qui encaissera part sociale et droit d’adhésion.')
      return
    }
    const resultat = await ouvrirCompte(client.id, typeCompte, promoCompte, caissierPourCompte)
    if ('erreur' in resultat) {
      setErreur(resultat.erreur)
      await alerter('Demande impossible', resultat.erreur)
      return
    }
    const caissier = data.employes.find((x) => x.id === caissierPourCompte)
    setModaleCompte(false)
    setErreur('')
    setPromoCompte(false)
    setCaissierPourCompte('')
    const droit = promoCompte ? fraisCompte.droitAdhesionPromo : fraisCompte.droitAdhesion
    await alerter(
      'Demande envoyée',
      `Demande d’ouverture enregistrée pour ${client.prenom} ${client.nom}.\n` +
        `Le compte sera créé après encaissement et validation par ${caissier?.nomComplet ?? 'le caissier'}.\n` +
        `Part sociale : ${formatMontant(fraisCompte.partSociale)}\n` +
        `Droit d'adhésion : ${formatMontant(droit)}\n` +
        `Total à encaisser : ${formatMontant(fraisCompte.partSociale + droit)}`,
    )
  }

  const caissiersDisponibles = data.employes
    .filter((e) => e.actif && e.role === 'caissier')
    .filter((e) => !client.agenceId || e.agenceId === client.agenceId)
    .sort((a, b) => a.nomComplet.localeCompare(b.nomComplet))

  return (
    <div>
      <Link to={retourClients} className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-brand-600 hover:text-brand-700">
        <ArrowLeft className="h-4 w-4" />
        Retour à la zone
      </Link>

      <EnTetePage
        titre={`${client.prenom} ${client.nom}`}
        sousTitre={`${afficherNumeroClient(client.codeClient)} — ${client.profession ?? 'Profession non renseignée'}`}
        action={
          <div className="flex flex-wrap gap-2">
            {peutOuvrirCarnet && (
              <button
                className="btn-primary"
                onClick={() => {
                  setErreur('')
                  setMise('')
                  const dispo = TYPES_CARNET.find((t) => !typesCarnetDejaOuverts.has(t))
                  setTypeCarnet(dispo ?? 'tontine')
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
                  setTypeCompte('courant')
                  setPromoCompte(false)
                  setCaissierPourCompte('')
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
            <button
              className="btn-secondary"
              onClick={async () => {
                await basculerActifClient(client.id)
              }}
            >
              {client.actif ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
              {client.actif ? 'Désactiver' : 'Réactiver'}
            </button>
            {estAdmin && (
              <button
                className="btn-danger"
                onClick={async () => {
                  const ok = await confirmer({
                    titre: 'Supprimer le client',
                    message: `Supprimer définitivement ${client.prenom} ${client.nom} (n° ${afficherNumeroClient(client.codeClient)}) ? Impossible s’il a déjà des carnets, comptes ou crédits.`,
                    labelValider: 'Supprimer',
                    danger: true,
                  })
                  if (!ok) return
                  const err = await supprimerClient(client.id)
                  if (err) {
                    await alerter('Suppression impossible', err)
                    return
                  }
                  navigate(retourClients)
                }}
              >
                <Trash2 className="h-4 w-4" />
                Supprimer
              </button>
            )}
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
                    const dispo = TYPES_CARNET.find((t) => !typesCarnetDejaOuverts.has(t))
                    setTypeCarnet(dispo ?? 'tontine')
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
                    setTypeCompte('courant')
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
                <div className="flex items-center gap-3">
                  <span className="font-bold text-slate-900">{formatMontant(c.solde)}</span>
                  {estAdmin && (
                    <button
                      type="button"
                      className="btn-danger !px-2 !py-1.5 text-xs"
                      title="Supprimer le compte"
                      onClick={async () => {
                        const ok = await confirmer({
                          titre: 'Supprimer le compte',
                          message:
                            `Supprimer définitivement le compte ${c.numero} ? ` +
                            `Le solde doit être nul. Les mouvements du compte seront effacés.`,
                          labelValider: 'Supprimer',
                          danger: true,
                        })
                        if (!ok) return
                        const err = await supprimerCompte(c.id)
                        if (err) await alerter('Suppression impossible', err)
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
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
          {estCaissier ? ' — vos opérations uniquement' : ''}
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
            <span className="font-mono font-bold text-brand-700">{client.codeClient}</span>
            <span className="ml-1 text-slate-500">(identique au N° Client stocké)</span>
          </p>
          <div>
            <label className="label">Type *</label>
            <select className="input" value={typeCarnet} onChange={(e) => setTypeCarnet(e.target.value as TypeCarnet)}>
              <option value="tontine" disabled={typesCarnetDejaOuverts.has('tontine')}>
                Tontine{typesCarnetDejaOuverts.has('tontine') ? ' (déjà ouvert)' : ''}
              </option>
              <option value="carte_tous" disabled={typesCarnetDejaOuverts.has('carte_tous')}>
                Carte pour tous{typesCarnetDejaOuverts.has('carte_tous') ? ' (déjà ouvert)' : ''}
              </option>
              <option value="carte_enfants" disabled={typesCarnetDejaOuverts.has('carte_enfants')}>
                Carte pour enfants{typesCarnetDejaOuverts.has('carte_enfants') ? ' (déjà ouvert)' : ''}
              </option>
              <option value="carte_bloquee" disabled={typesCarnetDejaOuverts.has('carte_bloquee')}>
                Carte bloquée{typesCarnetDejaOuverts.has('carte_bloquee') ? ' (déjà ouvert)' : ''}
              </option>
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
              <option value="courant">Compte courant (n° Bxxxx)</option>
              <option value="epargne">Compte épargne (n° Bxxxx)</option>
            </select>
          </div>
          <label className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={promoCompte}
              onChange={(e) => setPromoCompte(e.target.checked)}
            />
            <span>
              <span className="font-medium text-slate-900">Promotion — droit d’adhésion réduit</span>
              <span className="mt-0.5 block text-xs text-slate-500">
                {formatMontant(fraisCompte.droitAdhesionPromo)} au lieu de {formatMontant(fraisCompte.droitAdhesion)}
              </span>
            </span>
          </label>
          <div>
            <label className="label">Caisse (encaissement) *</label>
            <select
              className="input"
              required
              value={caissierPourCompte}
              onChange={(e) => setCaissierPourCompte(e.target.value)}
            >
              <option value="">— Choisir le caissier —</option>
              {caissiersDisponibles.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nomComplet} ({e.role === 'chef_agence' ? 'chef agence' : 'caissier'})
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-400">
              Le compte n’est créé qu’après validation et encaissement par ce caissier.
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700">
            <p className="font-medium text-slate-900">À encaisser en caisse</p>
            <ul className="mt-2 space-y-1 text-xs">
              <li>Part sociale (microfinance) : {formatMontant(fraisCompte.partSociale)}</li>
              <li>
                Droit d’adhésion (crédité sur le compte) :{' '}
                {formatMontant(promoCompte ? fraisCompte.droitAdhesionPromo : fraisCompte.droitAdhesion)}
              </li>
              <li className="font-semibold text-slate-900">
                Total :{' '}
                {formatMontant(
                  fraisCompte.partSociale +
                    (promoCompte ? fraisCompte.droitAdhesionPromo : fraisCompte.droitAdhesion),
                )}
              </li>
            </ul>
          </div>
          {erreur && <p className="text-sm font-medium text-rose-600">{erreur}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setModaleCompte(false)}>
              Annuler
            </button>
            <button type="submit" className="btn-primary">
              <Wallet className="h-4 w-4" />
              Envoyer la demande
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
