import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, HandCoins, Plus, Search } from 'lucide-react'
import { useStore } from '../store'
import type { CarnetTontine, FrequenceMise } from '../types'
import { formatDate, formatMontant } from '../utils'
import { Avatar, EnTetePage, EtatVide, Modale } from '../components/ui'

const LIBELLES_FREQUENCE: Record<FrequenceMise, string> = {
  journaliere: 'Journalière',
  hebdomadaire: 'Hebdomadaire',
}

export default function Tontines() {
  const { data, ouvrirCarnet, encaisserMises, cloturerCycle } = useStore()
  const [recherche, setRecherche] = useState('')
  const [modaleOuverture, setModaleOuverture] = useState(false)
  const [clientChoisi, setClientChoisi] = useState('')
  const [mise, setMise] = useState('')
  const [frequence, setFrequence] = useState<FrequenceMise>('journaliere')
  const [misesParCycle, setMisesParCycle] = useState('31')
  const [encaissement, setEncaissement] = useState<CarnetTontine | null>(null)
  const [nbMises, setNbMises] = useState('1')

  const clientDuCarnet = (c: CarnetTontine) => data.clients.find((x) => x.id === c.clientId)

  const misesPayees = (carnet: CarnetTontine) =>
    data.mises
      .filter((m) => m.carnetId === carnet.id && m.cycle === carnet.cycleActuel)
      .reduce((s, m) => s + m.nombreMises, 0)

  const carnetsFiltres = useMemo(() => {
    const q = recherche.trim().toLowerCase()
    return data.carnets
      .filter((c) => c.actif)
      .filter((c) => {
        const client = clientDuCarnet(c)
        return !q || (client && `${client.prenom} ${client.nom} ${client.codeClient}`.toLowerCase().includes(q))
      })
  }, [data.carnets, data.clients, recherche])

  const clientsSansCarnet = data.clients.filter(
    (c) => c.actif && !data.carnets.some((k) => k.actif && k.clientId === c.id),
  )

  const encoursTotal = data.carnets
    .filter((c) => c.actif)
    .reduce((s, c) => s + misesPayees(c) * c.mise, 0)

  const creerCarnet = (e: React.FormEvent) => {
    e.preventDefault()
    ouvrirCarnet(clientChoisi, Number(mise), frequence, Number(misesParCycle))
    setModaleOuverture(false)
    setClientChoisi('')
    setMise('')
    setMisesParCycle('31')
  }

  const validerEncaissement = (e: React.FormEvent) => {
    e.preventDefault()
    if (!encaissement) return
    encaisserMises(encaissement.id, Number(nbMises))
    setEncaissement(null)
    setNbMises('1')
  }

  return (
    <div>
      <EnTetePage
        titre="Tontine individuelle"
        sousTitre={`${data.carnets.filter((c) => c.actif).length} carnets actifs — encours total : ${formatMontant(encoursTotal)}`}
        action={
          <button className="btn-primary" onClick={() => setModaleOuverture(true)} disabled={clientsSansCarnet.length === 0}>
            <Plus className="h-4 w-4" />
            Ouvrir un carnet
          </button>
        }
      />

      <div className="relative mb-6 max-w-md">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          className="input pl-10"
          placeholder="Rechercher un client…"
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
        />
      </div>

      {carnetsFiltres.length === 0 ? (
        <EtatVide titre="Aucun carnet de tontine" description="Ouvrez un carnet pour un client." />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {carnetsFiltres.map((carnet) => {
            const client = clientDuCarnet(carnet)
            if (!client) return null
            const payees = misesPayees(carnet)
            const complet = payees >= carnet.misesParCycle
            const solde = payees * carnet.mise
            return (
              <div key={carnet.id} className={`card ${complet ? 'ring-2 ring-brand-400' : ''}`}>
                <div className="flex items-center gap-3">
                  <Avatar nom={client.nom} prenom={client.prenom} taille="lg" />
                  <div className="min-w-0 flex-1">
                    <Link to={`/clients/${client.id}`} className="truncate font-semibold text-slate-900 hover:text-brand-700">
                      {client.prenom} {client.nom}
                    </Link>
                    <p className="text-xs text-slate-500">
                      {client.codeClient} — ouvert le {formatDate(carnet.dateOuverture)}
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
                      Cycle {carnet.cycleActuel} — <span className="font-semibold text-slate-700">{payees}/{carnet.misesParCycle}</span> mises
                    </span>
                    <span>
                      Collecté : <span className="font-semibold text-slate-700">{formatMontant(solde)}</span>
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full transition-all ${complet ? 'bg-brand-500' : 'bg-brand-400'}`}
                      style={{ width: `${Math.min(100, (payees / carnet.misesParCycle) * 100)}%` }}
                    />
                  </div>
                </div>

                <div className="mt-4 flex gap-2">
                  {!complet && (
                    <button
                      className="btn-primary flex-1 !py-2 text-xs"
                      onClick={() => {
                        setEncaissement(carnet)
                        setNbMises('1')
                      }}
                    >
                      <HandCoins className="h-4 w-4" />
                      Encaisser des mises
                    </button>
                  )}
                  {payees > 0 && (
                    <button
                      className={`${complet ? 'btn-primary' : 'btn-secondary'} flex-1 !py-2 text-xs`}
                      onClick={() => {
                        const remise = solde - carnet.mise
                        if (
                          confirm(
                            `Clôturer le cycle ${carnet.cycleActuel} de ${client.prenom} ${client.nom} ?\n\nCollecté : ${formatMontant(solde)} (${payees} mises)\nCommission (1 mise) : ${formatMontant(carnet.mise)}\nÀ remettre au client : ${formatMontant(remise)}`,
                          )
                        ) {
                          cloturerCycle(carnet.id)
                        }
                      }}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Clôturer le cycle
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Ouverture de carnet */}
      <Modale titre="Ouvrir un carnet de tontine" ouverte={modaleOuverture} onFermer={() => setModaleOuverture(false)}>
        <form onSubmit={creerCarnet} className="space-y-4">
          <div>
            <label className="label">Client *</label>
            <select className="input" required value={clientChoisi} onChange={(e) => setClientChoisi(e.target.value)}>
              <option value="">— Choisir un client —</option>
              {clientsSansCarnet.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.codeClient} — {c.prenom} {c.nom}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Montant de la mise (FCFA) *</label>
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
          <div>
            <label className="label">Mises par cycle *</label>
            <input
              className="input"
              type="number"
              min={5}
              max={100}
              required
              value={misesParCycle}
              onChange={(e) => setMisesParCycle(e.target.value)}
            />
            <p className="mt-1 text-xs text-slate-400">
              À la clôture du cycle, une mise est retenue comme commission de l'établissement.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setModaleOuverture(false)}>
              Annuler
            </button>
            <button type="submit" className="btn-primary">Ouvrir le carnet</button>
          </div>
        </form>
      </Modale>

      {/* Encaissement */}
      <Modale
        titre={
          encaissement
            ? `Encaisser — ${clientDuCarnet(encaissement)?.prenom ?? ''} ${clientDuCarnet(encaissement)?.nom ?? ''}`
            : ''
        }
        ouverte={encaissement !== null}
        onFermer={() => setEncaissement(null)}
      >
        {encaissement && (
          <form onSubmit={validerEncaissement} className="space-y-4">
            <div className="rounded-xl bg-slate-50 p-3 text-sm">
              Mise : <span className="font-bold">{formatMontant(encaissement.mise)}</span> — déjà payées :{' '}
              <span className="font-bold">
                {misesPayees(encaissement)}/{encaissement.misesParCycle}
              </span>
            </div>
            <div>
              <label className="label">Nombre de mises *</label>
              <input
                className="input"
                type="number"
                min={1}
                max={encaissement.misesParCycle - misesPayees(encaissement)}
                required
                autoFocus
                value={nbMises}
                onChange={(e) => setNbMises(e.target.value)}
              />
            </div>
            <div className="rounded-xl bg-brand-50 p-3 text-sm font-semibold text-brand-800">
              Total à encaisser : {formatMontant(encaissement.mise * (Number(nbMises) || 0))}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setEncaissement(null)}>
                Annuler
              </button>
              <button type="submit" className="btn-primary">Encaisser</button>
            </div>
          </form>
        )}
      </Modale>
    </div>
  )
}
