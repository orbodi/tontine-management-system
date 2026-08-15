import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Lock, Plus, Search } from 'lucide-react'
import { useStore } from '../store'
import {
  CYCLES_PAR_CARNET,
  MOIS_MIN_RETRAIT_CARTE,
  PRIX_CARNET,
  type FrequenceMise,
  type TypeCarnet,
} from '../types'
import {
  CARNETS_RETRAIT_6_MOIS,
  LIBELLES_CARNET,
  carreauxNets,
  moisDuCycle,
  situationsCycles,
} from '../metier'
import { formatMontant } from '../utils'
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
  carte_bloquee: 'bg-rose-100 text-rose-700',
}

export default function Tontines() {
  const { data, aDroit, ouvrirCarnet } = useStore()
  const { alerter } = useConfirmation()
  const [recherche, setRecherche] = useState('')
  const [typeFiltre, setTypeFiltre] = useState<'tous' | TypeCarnet>('tous')
  const [modaleOuverture, setModaleOuverture] = useState(false)
  const [clientChoisi, setClientChoisi] = useState('')
  const [typeNouveauCarnet, setTypeNouveauCarnet] = useState<TypeCarnet>('tontine')
  const [mise, setMise] = useState('')
  const [frequence, setFrequence] = useState<FrequenceMise>('journaliere')
  const [erreur, setErreur] = useState('')

  const peutOperer = aDroit('operer_comptes')

  const clientsSansCarnet = useMemo(
    () => data.clients.filter((c) => c.actif && !data.carnets.some((k) => k.actif && k.clientId === c.id)),
    [data.clients, data.carnets],
  )

  const carnetsFiltres = useMemo(() => {
    const q = recherche.trim().toLowerCase()
    return data.carnets
      .filter((c) => c.actif)
      .filter((c) => typeFiltre === 'tous' || c.typeCarnet === typeFiltre)
      .filter((c) => {
        const client = data.clients.find((x) => x.id === c.clientId)
        return (
          !q ||
          c.numero.toLowerCase().includes(q) ||
          (client && `${client.prenom} ${client.nom} ${client.codeClient}`.toLowerCase().includes(q))
        )
      })
      .sort((a, b) => a.numero.localeCompare(b.numero))
  }, [data.carnets, data.clients, recherche, typeFiltre])

  const encoursTotal = data.carnets
    .filter((c) => c.actif)
    .reduce((s, c) => {
      const cycles = situationsCycles(c, data.mises)
      return s + cycles.reduce((x, et) => x + et.nets * c.mise, 0)
    }, 0)

  const creerCarnet = async (e: React.FormEvent) => {
    e.preventDefault()
    const resultat = ouvrirCarnet(clientChoisi, typeNouveauCarnet, Number(mise), frequence)
    if ('erreur' in resultat) {
      setErreur(resultat.erreur)
      await alerter('Ouverture impossible', resultat.erreur)
      return
    }
    setModaleOuverture(false)
    setClientChoisi('')
    setMise('')
    setErreur('')
    await alerter('Carnet ouvert', `Le carnet ${resultat.numero} a été ouvert avec succès.`)
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
            return (
              <Link
                key={carnet.id}
                to={`/tontines/${carnet.id}`}
                className={`card group flex items-center gap-3 transition hover:shadow-md hover:ring-2 hover:ring-brand-200 ${
                  carnet.verrouille ? 'opacity-90 ring-2 ring-rose-200' : ''
                }`}
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
                    {carnet.verrouille && (
                      <span className="badge bg-rose-100 text-rose-700">
                        <Lock className="mr-1 h-3 w-3" />
                        Verrouillé
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 font-mono text-xs font-semibold text-brand-700">{carnet.numero}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {mois.label} ({carnet.cycleActuel}/{CYCLES_PAR_CARNET}) —{' '}
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
                <ChevronRight className="h-5 w-5 shrink-0 text-slate-300 transition group-hover:text-brand-600" />
              </Link>
            )
          })}
        </div>
      )}

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
              <label className="label">Fréquence *</label>
              <select className="input" value={frequence} onChange={(e) => setFrequence(e.target.value as FrequenceMise)}>
                <option value="journaliere">{LIBELLES_FREQUENCE.journaliere}</option>
                <option value="hebdomadaire">{LIBELLES_FREQUENCE.hebdomadaire}</option>
              </select>
            </div>
          </div>
          <div className="rounded-xl bg-brand-50 p-3 text-sm text-brand-800">
            31 carreaux × 12 cycles — carnet {formatMontant(PRIX_CARNET)}. À 31 carreaux, passage auto au mois suivant.
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
    </div>
  )
}
