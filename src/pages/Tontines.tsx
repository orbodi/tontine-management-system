import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Lock, Plus, Search } from 'lucide-react'
import { useStore } from '../store'
import {
  PRIX_CARNET,
  TYPES_CARNET,
  type FrequenceMise,
  type TypeCarnet,
  type TypeTransaction,
} from '../types'
import {
  CARNETS_RETRAIT_6_MOIS,
  LIBELLES_CARNET,
  LIBELLES_TYPE,
  TYPES_SORTIE,
  carreauxNets,
  estAncienClientTontine,
  libelleCycleCarnet,
  anneeCarnet,
  besoinRenouvellementCarnet,
  moisDuCycle,
  situationsCycles,
} from '../metier'
import { formatDateHeure, formatMontant, afficherNumeroClient } from '../utils'
import { Avatar, EnTetePage, EtatVide, Modale } from '../components/ui'
import { useConfirmation } from '../components/Confirmation'

const TYPES_TX_CARNET: TypeTransaction[] = [
  'vente_carnet',
  'mise_tontine',
  'retrait_tontine',
  'commission_tontine',
  'complement_mise',
]

const LIBELLES_FREQUENCE: Record<FrequenceMise, string> = {
  journaliere: 'Journalière',
  hebdomadaire: 'Hebdomadaire',
}

const STYLES_CARNET: Record<TypeCarnet, string> = {
  tontine: 'bg-amber-100 text-amber-700',
  carte_tous: 'bg-sky-100 text-sky-700',
  carte_enfants: 'bg-violet-100 text-violet-700',
  carte_bloquee: 'bg-rose-100 text-rose-700',
}

function normaliser(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export default function Tontines() {
  const { data, aDroit, estCaissier, employeConnecte, ouvrirCarnet } = useStore()
  const { alerter } = useConfirmation()
  const [recherche, setRecherche] = useState('')
  const [typeFiltre, setTypeFiltre] = useState<'tous' | TypeCarnet>('tous')
  const [carnetSelectionneId, setCarnetSelectionneId] = useState<string | null>(null)
  const [modaleOuverture, setModaleOuverture] = useState(false)
  const [agenceChoisie, setAgenceChoisie] = useState('')
  const [zoneChoisie, setZoneChoisie] = useState('')
  const [clientChoisi, setClientChoisi] = useState('')
  const [rechercheClient, setRechercheClient] = useState('')
  const [typeNouveauCarnet, setTypeNouveauCarnet] = useState<TypeCarnet>('tontine')
  const [mise, setMise] = useState('')
  const [frequence, setFrequence] = useState<FrequenceMise>('journaliere')
  const [erreur, setErreur] = useState('')

  const peutOperer = aDroit('operer_comptes')

  const zonesAgence = useMemo(
    () =>
      data.zones
        .filter((z) => z.actif && (!agenceChoisie || z.agenceId === agenceChoisie))
        .sort((a, b) => a.code.localeCompare(b.code)),
    [data.zones, agenceChoisie],
  )

  /** Clients de la zone : liste dès qu’agence+zone sont choisies ; la saisie affine. */
  const suggestionsClients = useMemo(() => {
    if (!agenceChoisie || !zoneChoisie) return []
    const q = normaliser(rechercheClient)
    return data.clients
      .filter((c) => {
        if (!c.actif) return false
        if (c.agenceId !== agenceChoisie || c.zoneId !== zoneChoisie) return false
        if (!q) return true
        const texte = normaliser(
          `${c.codeClient} ${afficherNumeroClient(c.codeClient)} ${c.prenom} ${c.nom} ${c.telephone}`,
        )
        return texte.includes(q)
      })
      .sort((a, b) => (a.codeClient ?? '').localeCompare(b.codeClient ?? ''))
      .slice(0, q ? 15 : 30)
  }, [data.clients, agenceChoisie, zoneChoisie, rechercheClient])

  const clientSelectionne = data.clients.find((c) => c.id === clientChoisi)
  const typesCarnetClient = new Set(
    data.carnets.filter((c) => c.clientId === clientChoisi).map((c) => c.typeCarnet),
  )
  const apercuNumero = clientSelectionne?.codeClient ?? null
  const tousTypesOuverts = Boolean(clientChoisi) && typesCarnetClient.size >= TYPES_CARNET.length

  useEffect(() => {
    if (!clientChoisi) return
    const ouverts = new Set(data.carnets.filter((c) => c.clientId === clientChoisi).map((c) => c.typeCarnet))
    setTypeNouveauCarnet((prev) =>
      ouverts.has(prev) ? (TYPES_CARNET.find((t) => !ouverts.has(t)) ?? prev) : prev,
    )
  }, [clientChoisi, data.carnets])

  const libelleClient = (c: { codeClient: string; prenom: string; nom: string }) =>
    `${afficherNumeroClient(c.codeClient)} — ${c.prenom} ${c.nom}`

  const choisirClient = (id: string) => {
    const c = data.clients.find((x) => x.id === id)
    if (!c) return
    setClientChoisi(c.id)
    setRechercheClient(libelleClient(c))
    setAgenceChoisie(c.agenceId)
    setZoneChoisie(c.zoneId)
  }

  const ouvrirModale = () => {
    setAgenceChoisie(data.agences.find((a) => a.actif)?.id ?? '')
    setZoneChoisie('')
    setClientChoisi('')
    setRechercheClient('')
    setMise('')
    setTypeNouveauCarnet('tontine')
    setFrequence('journaliere')
    setErreur('')
    setModaleOuverture(true)
  }

  const carnetsFiltres = useMemo(() => {
    const q = recherche.trim().toLowerCase()
    return data.carnets
      .filter((c) => c.actif)
      .filter((c) => typeFiltre === 'tous' || c.typeCarnet === typeFiltre)
      .filter((c) => {
        const client = data.clients.find((x) => x.id === c.clientId)
        const zone = data.zones.find((z) => z.id === c.zoneId)
        const agence = data.agences.find((a) => a.id === c.agenceId)
        return (
          !q ||
          c.numero.toLowerCase().includes(q) ||
          (zone && zone.code.includes(q)) ||
          (agence && agence.nom.toLowerCase().includes(q)) ||
          (client &&
            `${client.prenom} ${client.nom} ${client.codeClient ?? ''} ${afficherNumeroClient(client.codeClient)}`
              .toLowerCase()
              .includes(q))
        )
      })
      .sort((a, b) => a.numero.localeCompare(b.numero))
  }, [data.carnets, data.clients, data.zones, data.agences, recherche, typeFiltre])

  const carnetSelectionne = carnetSelectionneId
    ? data.carnets.find((c) => c.id === carnetSelectionneId)
    : undefined
  const clientSelectionneCarnet = carnetSelectionne
    ? data.clients.find((c) => c.id === carnetSelectionne.clientId)
    : undefined

  const historiqueSelectionne = useMemo(() => {
    if (!carnetSelectionne) return []
    const numero = carnetSelectionne.numero
    const datesMises = new Set(
      data.mises.filter((m) => m.carnetId === carnetSelectionne.id).map((m) => m.date),
    )
    return [...data.transactions]
      .filter((t) => {
        if (t.clientId !== carnetSelectionne.clientId) return false
        if (!TYPES_TX_CARNET.includes(t.type)) return false
        if (estCaissier && employeConnecte && t.operateurId !== employeConnecte.id) return false
        if (t.type === 'vente_carnet' || t.type === 'retrait_tontine') {
          return t.description.includes(numero)
        }
        // Dépôts / P.C : liés au carnet via la date des mises
        return datesMises.has(t.date)
      })
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [carnetSelectionne, data.transactions, data.mises, estCaissier, employeConnecte])

  const encoursTotal = data.carnets
    .filter((c) => c.actif)
    .reduce((s, c) => {
      const cycles = situationsCycles(c, data.mises)
      return s + cycles.reduce((x, et) => x + et.nets * c.mise, 0)
    }, 0)

  const creerCarnet = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!agenceChoisie) {
      setErreur('Choisissez une agence.')
      return
    }
    if (!zoneChoisie) {
      setErreur('Choisissez une zone.')
      return
    }
    if (!clientChoisi) {
      setErreur('Sélectionnez un client dans la liste de suggestions.')
      return
    }
    const client = data.clients.find((c) => c.id === clientChoisi)
    if (!client || client.zoneId !== zoneChoisie || client.agenceId !== agenceChoisie) {
      setErreur('Le client doit appartenir à l’agence et à la zone sélectionnées.')
      return
    }
    if (typesCarnetClient.has(typeNouveauCarnet)) {
      setErreur('Ce client a déjà un carnet de ce type.')
      return
    }
    const resultat = await ouvrirCarnet(clientChoisi, typeNouveauCarnet, Number(mise), frequence)
    if ('erreur' in resultat) {
      setErreur(resultat.erreur)
      await alerter('Ouverture impossible', resultat.erreur)
      return
    }
    const agence = data.agences.find((a) => a.id === agenceChoisie)
    const zone = data.zones.find((z) => z.id === zoneChoisie)
    setModaleOuverture(false)
    setClientChoisi('')
    setRechercheClient('')
    setZoneChoisie('')
    setMise('')
    setErreur('')
    await alerter(
      'Carnet ouvert',
      `Le carnet ${resultat.numero} a été ouvert.\nAgence : ${agence?.nom ?? '—'}\nZone : ${zone?.code ?? '—'}`,
    )
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
        sousTitre={`${data.carnets.filter((c) => c.actif).length} carnets — encours : ${formatMontant(encoursTotal)} — cliquez pour ouvrir un compte`}
        action={
          peutOperer && (
            <button
              className="btn-primary"
              onClick={ouvrirModale}
              disabled={data.clients.every((c) => !c.actif)}
            >
              <Plus className="h-4 w-4" />
              Ouvrir un carnet
            </button>
          )
        }
      />

      {peutOperer && (
        <div className="mb-6 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-950 ring-1 ring-amber-200">
          <p className="font-semibold">Avant les dépôts tontine</p>
          <p className="mt-1">
            Saisissez d’abord le <strong>montant réel collecté</strong> sur le compte zone
            (journée du jour ou journée antérieure encore ouverte), puis enregistrez les dépôts
            en indiquant la collecte concernée.
          </p>
          <Link
            to="/zones"
            className="mt-2 inline-flex text-sm font-semibold text-brand-700 hover:text-brand-800"
          >
            Aller à la collecte tontine →
          </Link>
        </div>
      )}

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
        <EtatVide titre="Aucun carnet" description="Ouvrez un carnet pour commencer." />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {carnetsFiltres.map((carnet) => {
            const client = data.clients.find((c) => c.id === carnet.clientId)
            if (!client) return null
            const payees = carreauxNets(carnet, data.mises)
            const cycles = situationsCycles(carnet, data.mises)
            const mois = moisDuCycle(carnet, carnet.cycleActuel)
            const passés = cycles.filter((c) => !c.estActuel)
            const dispo = cycles.reduce((s, c) => s + c.montantRetirable, 0)
            const selectionne = carnetSelectionneId === carnet.id
            return (
              <div
                key={carnet.id}
                role="button"
                tabIndex={0}
                onClick={() =>
                  setCarnetSelectionneId((id) => (id === carnet.id ? null : carnet.id))
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setCarnetSelectionneId((id) => (id === carnet.id ? null : carnet.id))
                  }
                }}
                className={`card group flex cursor-pointer items-center gap-3 transition hover:shadow-md hover:ring-2 hover:ring-brand-200 ${
                  carnet.verrouille ? 'opacity-90 ring-2 ring-rose-200' : ''
                } ${selectionne ? 'ring-2 ring-brand-500 shadow-md' : ''}`}
              >
                <Avatar nom={client.nom} prenom={client.prenom} taille="lg" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-semibold text-slate-900 group-hover:text-brand-700">
                      {client.prenom} {client.nom}
                    </span>
                    <span className={`badge ${STYLES_CARNET[carnet.typeCarnet]}`}>
                      {LIBELLES_CARNET[carnet.typeCarnet]}
                    </span>
                    {besoinRenouvellementCarnet(carnet, data.mises, data.transactions) ? (
                      <span className="badge bg-amber-100 text-amber-800">À renouveler</span>
                    ) : anneeCarnet(carnet.cycleActuel) > 1 ? (
                      <span className="badge bg-sky-100 text-sky-800">Renouvelé</span>
                    ) : null}
                    {carnet.reprisePapier && (
                      <span className="badge bg-amber-100 text-amber-800">Papier</span>
                    )}
                    {carnet.verrouille && (
                      <span className="badge bg-rose-100 text-rose-700">
                        <Lock className="mr-1 h-3 w-3" />
                        Verrouillé
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 font-mono text-xs font-semibold text-brand-700">{carnet.numero}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {data.agences.find((a) => a.id === carnet.agenceId)?.nom ?? 'Agence'} · Zone{' '}
                    {data.zones.find((z) => z.id === carnet.zoneId)?.code ?? '—'}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {mois.label} ({libelleCycleCarnet(carnet.cycleActuel)}) —{' '}
                    <span className="font-medium text-slate-700">
                      {payees}/{carnet.misesParCycle}
                    </span>{' '}
                    carreaux
                  </p>
                  {passés.length > 0 && (
                    <p className="mt-1 text-xs text-slate-500">
                      Mois passés :{' '}
                      <span className="font-medium text-slate-700">
                        {passés.map((p) => p.moisLabel).join(', ')}
                      </span>
                    </p>
                  )}
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-brand-500"
                      style={{ width: `${Math.min(100, (payees / carnet.misesParCycle) * 100)}%` }}
                    />
                  </div>
                  {dispo > 0 && (
                    <p className="mt-1.5 text-xs font-medium text-emerald-700">
                      Retirable : {formatMontant(dispo)}
                    </p>
                  )}
                </div>
                <Link
                  to={`/tontines/${carnet.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="shrink-0 rounded-lg p-1.5 text-slate-300 transition hover:bg-brand-50 hover:text-brand-600"
                  title="Ouvrir le détail"
                >
                  <ChevronRight className="h-5 w-5" />
                </Link>
              </div>
            )
          })}
        </div>
      )}

      {carnetSelectionne && clientSelectionneCarnet && (
        <div className="card mt-6 !p-0 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div>
              <h3 className="font-semibold text-slate-900">Historique des transactions</h3>
              <p className="text-xs text-slate-500">
                {clientSelectionneCarnet.prenom} {clientSelectionneCarnet.nom} — carnet{' '}
                <span className="font-mono font-semibold text-brand-700">{carnetSelectionne.numero}</span>
              </p>
            </div>
            <Link
              to={`/tontines/${carnetSelectionne.id}`}
              className="btn-secondary !py-2 text-xs"
            >
              Ouvrir le détail
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          {historiqueSelectionne.length === 0 ? (
            <div className="p-5">
              <EtatVide titre="Aucune transaction" description="Pas encore d’opération sur ce carnet." />
            </div>
          ) : (
            <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
              {historiqueSelectionne.map((t) => {
                const sortie = TYPES_SORTIE.includes(t.type)
                return (
                  <div key={t.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-800">{t.description}</p>
                      <p className="text-xs text-slate-500">
                        {LIBELLES_TYPE[t.type]} — {formatDateHeure(t.date)} — par {t.operateur}
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
      )}

      <Modale titre="Ouvrir un carnet" ouverte={modaleOuverture} onFermer={() => setModaleOuverture(false)}>
        <form onSubmit={creerCarnet} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Agence *</label>
              <select
                className="input"
                required
                value={agenceChoisie}
                onChange={(e) => {
                  setAgenceChoisie(e.target.value)
                  setZoneChoisie('')
                  setClientChoisi('')
                  setRechercheClient('')
                }}
              >
                <option value="">— Choisir —</option>
                {data.agences
                  .filter((a) => a.actif)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nom}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="label">Zone *</label>
              <select
                className="input"
                required
                value={zoneChoisie}
                disabled={!agenceChoisie}
                onChange={(e) => {
                  setZoneChoisie(e.target.value)
                  setClientChoisi('')
                  setRechercheClient('')
                }}
              >
                <option value="">— Choisir —</option>
                {zonesAgence.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.code}
                    {z.nom ? ` — ${z.nom}` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Client *</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                className="input pl-10"
                disabled={!agenceChoisie || !zoneChoisie}
                placeholder={
                  agenceChoisie && zoneChoisie
                    ? 'Filtrer la liste (nom, prénom, n°…) — optionnel'
                    : 'Choisissez d’abord une agence et une zone'
                }
                value={rechercheClient}
                autoComplete="off"
                onChange={(e) => {
                  setRechercheClient(e.target.value)
                  setClientChoisi('')
                }}
              />
            </div>
            {!agenceChoisie || !zoneChoisie ? (
              <p className="mt-1 text-xs text-slate-400">
                Sélectionnez l’agence et la zone pour afficher les clients de la zone.
              </p>
            ) : !clientChoisi ? (
              <ul className="mt-2 max-h-52 overflow-y-auto rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
                {suggestionsClients.length === 0 ? (
                  <li className="px-3 py-2.5 text-sm text-slate-500">
                    Aucun client trouvé dans cette zone
                    {rechercheClient.trim() ? ' pour cette recherche' : ''}.
                  </li>
                ) : (
                  suggestionsClients.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition hover:bg-brand-50"
                        onClick={() => choisirClient(c.id)}
                      >
                        <Avatar nom={c.nom} prenom={c.prenom} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-slate-900">
                            <span className="font-mono text-xs font-semibold text-brand-700">{afficherNumeroClient(c.codeClient)}</span>
                            {' — '}
                            {c.prenom} {c.nom}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            ) : (
              clientSelectionne && (
                <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
                  Sélectionné : {libelleClient(clientSelectionne)}{' '}
                  <button
                    type="button"
                    className="ml-2 underline"
                    onClick={() => {
                      setClientChoisi('')
                      setRechercheClient('')
                    }}
                  >
                    Changer
                  </button>
                </p>
              )
            )}
          </div>
          {apercuNumero && (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              N° carnet prévu : <span className="font-mono font-bold text-brand-700">{apercuNumero}</span>{' '}
              (identique au N° Client stocké)
            </p>
          )}
          <div>
            <label className="label">Type *</label>
            <select className="input" value={typeNouveauCarnet} onChange={(e) => setTypeNouveauCarnet(e.target.value as TypeCarnet)}>
              <option value="tontine" disabled={typesCarnetClient.has('tontine')}>
                Tontine{typesCarnetClient.has('tontine') ? ' (déjà ouvert)' : ''}
              </option>
              <option value="carte_tous" disabled={typesCarnetClient.has('carte_tous')}>
                Carte pour tous{typesCarnetClient.has('carte_tous') ? ' (déjà ouvert)' : ''}
              </option>
              <option value="carte_enfants" disabled={typesCarnetClient.has('carte_enfants')}>
                Carte pour enfants{typesCarnetClient.has('carte_enfants') ? ' (déjà ouvert)' : ''}
              </option>
              <option value="carte_bloquee" disabled={typesCarnetClient.has('carte_bloquee')}>
                Carte bloquée{typesCarnetClient.has('carte_bloquee') ? ' (déjà ouvert)' : ''}
              </option>
            </select>
            {CARNETS_RETRAIT_6_MOIS.includes(typeNouveauCarnet) && (
              <p className="mt-1 text-xs text-amber-700">
                Retraits grisés jusqu’à activation par l’administrateur.
              </p>
            )}
            {tousTypesOuverts && (
              <p className="mt-1 text-xs font-medium text-amber-700">
                Ce client a déjà un carnet de chaque type.
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
            {estAncienClientTontine(clientSelectionne) ? (
              <>
                31 carreaux × 12 cycles — carnet offert (client ancien, pas de {formatMontant(PRIX_CARNET)}
                ). P.C. non prélevée sur le premier cycle.
              </>
            ) : (
              <>
                31 carreaux × 12 cycles — carnet {formatMontant(PRIX_CARNET)}. À 31 carreaux, passage auto au
                mois suivant.
              </>
            )}
          </div>
          {erreur && <p className="text-sm font-medium text-rose-600">{erreur}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setModaleOuverture(false)}>
              Annuler
            </button>
            <button type="submit" className="btn-primary" disabled={tousTypesOuverts}>
              Ouvrir
            </button>
          </div>
        </form>
      </Modale>
    </div>
  )
}
