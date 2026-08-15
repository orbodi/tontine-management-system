import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Plus, Search } from 'lucide-react'
import { useStore } from '../store'
import type { Client, Sexe } from '../types'
import { formatDate } from '../utils'
import { Avatar, EnTetePage, EtatVide, Modale } from '../components/ui'
import { useConfirmation } from '../components/Confirmation'

interface FormulaireClient {
  zoneId: string
  nom: string
  prenom: string
  telephone: string
  email: string
  sexe: Sexe
  profession: string
  adresse: string
  pieceIdentite: string
}

const formulaireVide: FormulaireClient = {
  zoneId: '',
  nom: '',
  prenom: '',
  telephone: '',
  email: '',
  sexe: 'F',
  profession: '',
  adresse: '',
  pieceIdentite: '',
}

export default function Clients() {
  const { data, estCaissier, estAdmin, employeConnecte, ajouterClient, modifierClient } = useStore()
  const { alerter } = useConfirmation()
  const [recherche, setRecherche] = useState('')
  const [modaleOuverte, setModaleOuverte] = useState(false)
  const [clientEnEdition, setClientEnEdition] = useState<Client | null>(null)
  const [form, setForm] = useState<FormulaireClient>(formulaireVide)
  const [erreur, setErreur] = useState('')

  const zonesDisponibles = useMemo(() => {
    const zones = data.zones.filter((z) => z.actif)
    if (estAdmin) return zones
    return zones.filter((z) => z.agenceId === employeConnecte?.agenceId)
  }, [data.zones, estAdmin, employeConnecte?.agenceId])

  const clientsFiltres = useMemo(() => {
    const q = recherche.trim().toLowerCase()
    return data.clients
      .filter(
        (c) =>
          !q ||
          `${c.prenom} ${c.nom}`.toLowerCase().includes(q) ||
          c.codeClient.toLowerCase().includes(q) ||
          c.telephone.replace(/\s/g, '').includes(q.replace(/\s/g, '')) ||
          (c.profession ?? '').toLowerCase().includes(q),
      )
      .sort((a, b) => a.codeClient.localeCompare(b.codeClient))
  }, [data.clients, recherche])

  const ouvrirCreation = () => {
    setClientEnEdition(null)
    setForm({ ...formulaireVide, zoneId: zonesDisponibles[0]?.id ?? '' })
    setErreur('')
    setModaleOuverte(true)
  }

  const ouvrirEdition = (c: Client) => {
    if (estCaissier) return
    setClientEnEdition(c)
    setForm({
      zoneId: c.zoneId,
      nom: c.nom,
      prenom: c.prenom,
      telephone: c.telephone,
      email: c.email ?? '',
      sexe: c.sexe,
      profession: c.profession ?? '',
      adresse: c.adresse ?? '',
      pieceIdentite: c.pieceIdentite ?? '',
    })
    setErreur('')
    setModaleOuverte(true)
  }

  const enregistrer = async (e: React.FormEvent) => {
    e.preventDefault()
    const patch = {
      nom: form.nom.trim(),
      prenom: form.prenom.trim(),
      telephone: form.telephone.trim(),
      email: form.email.trim() || undefined,
      sexe: form.sexe,
      profession: form.profession.trim() || undefined,
      adresse: form.adresse.trim() || undefined,
      pieceIdentite: form.pieceIdentite.trim() || undefined,
    }
    if (clientEnEdition) {
      const err = modifierClient(clientEnEdition.id, patch)
      if (err) {
        setErreur(err)
        return
      }
      setModaleOuverte(false)
      setErreur('')
      await alerter(
        'Client modifié',
        `Les informations de ${patch.prenom} ${patch.nom} (${clientEnEdition.codeClient}) ont été mises à jour avec succès.`,
      )
      return
    }
    if (!form.zoneId) {
      setErreur('Choisissez une zone.')
      return
    }
    const cree = ajouterClient({ ...patch, zoneId: form.zoneId })
    if (!cree) {
      setErreur('Impossible d’ajouter le client (zone inactive ou introuvable).')
      return
    }
    setModaleOuverte(false)
    setErreur('')
    await alerter(
      'Client ajouté',
      `Le client ${cree.prenom} ${cree.nom} a été ajouté avec succès.\nNuméro client : ${cree.codeClient}`,
    )
  }

  const champ =
    (cle: keyof FormulaireClient) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [cle]: e.target.value }))

  return (
    <div>
      <EnTetePage
        titre="Clients"
        sousTitre={`${data.clients.length} client${data.clients.length > 1 ? 's' : ''} enregistré${data.clients.length > 1 ? 's' : ''}`}
        action={
          <button className="btn-primary" onClick={ouvrirCreation}>
            <Plus className="h-4 w-4" />
            Nouveau client
          </button>
        }
      />

      <div className="relative mb-6 max-w-md">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          className="input pl-10"
          placeholder="Rechercher par nom, ID client, téléphone…"
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
        />
      </div>

      {clientsFiltres.length === 0 ? (
        <EtatVide titre="Aucun client trouvé" description="Modifiez votre recherche ou ajoutez un nouveau client." />
      ) : (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3.5">ID</th>
                <th className="px-5 py-3.5">Client</th>
                <th className="px-5 py-3.5">Zone</th>
                <th className="px-5 py-3.5">Téléphone</th>
                <th className="px-5 py-3.5">Profession</th>
                <th className="px-5 py-3.5">Inscrit le</th>
                <th className="px-5 py-3.5">Statut</th>
                <th className="px-5 py-3.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {clientsFiltres.map((c) => (
                <tr key={c.id} className="transition hover:bg-slate-50">
                  <td className="px-5 py-3 font-mono text-xs font-semibold tabular-nums tracking-wide text-brand-700">
                    {c.codeClient}
                  </td>
                  <td className="px-5 py-3">
                    <Link to={`/clients/${c.id}`} className="flex items-center gap-3">
                      <Avatar nom={c.nom} prenom={c.prenom} />
                      <span className="font-medium text-slate-900">
                        {c.prenom} {c.nom}
                      </span>
                    </Link>
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-slate-600">
                    {(() => {
                      const z = data.zones.find((x) => x.id === c.zoneId)
                      return z ? z.code : '—'
                    })()}
                  </td>
                  <td className="px-5 py-3 text-slate-600">{c.telephone}</td>
                  <td className="px-5 py-3 text-slate-600">{c.profession ?? '—'}</td>
                  <td className="px-5 py-3 text-slate-600">{formatDate(c.dateInscription)}</td>
                  <td className="px-5 py-3">
                    <span className={`badge ${c.actif ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                      {c.actif ? 'Actif' : 'Inactif'}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {!estCaissier && (
                        <button
                          className="text-xs font-medium text-slate-500 hover:text-brand-600"
                          onClick={() => ouvrirEdition(c)}
                        >
                          Modifier
                        </button>
                      )}
                      <Link to={`/clients/${c.id}`} className="text-brand-600 hover:text-brand-700" title="Voir la fiche">
                        <ChevronRight className="h-4 w-4" />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modale
        titre={clientEnEdition ? `Modifier ${clientEnEdition.codeClient}` : 'Nouveau client'}
        ouverte={modaleOuverte}
        onFermer={() => setModaleOuverte(false)}
      >
        <form onSubmit={enregistrer} className="space-y-4">
          {!clientEnEdition && (
            <div>
              <label className="label">Zone *</label>
              <select
                className="input"
                required
                value={form.zoneId}
                onChange={champ('zoneId')}
              >
                <option value="">— Choisir —</option>
                {zonesDisponibles.map((z) => {
                  const agence = data.agences.find((a) => a.id === z.agenceId)
                  return (
                    <option key={z.id} value={z.id}>
                      {z.code} — {z.nom ?? 'Zone'} ({agence?.nom ?? 'Agence'})
                    </option>
                  )
                })}
              </select>
              <p className="mt-1 text-xs text-slate-500">
                Le n° de carnet héritera du n° de zone (ex. 010001).
              </p>
            </div>
          )}
          {clientEnEdition && (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Zone :{' '}
              <span className="font-mono font-semibold text-brand-700">
                {data.zones.find((z) => z.id === clientEnEdition.zoneId)?.code ?? '—'}
              </span>{' '}
              (non modifiable — détermine le n° de carnet)
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Prénom *</label>
              <input className="input" required value={form.prenom} onChange={champ('prenom')} />
            </div>
            <div>
              <label className="label">Nom *</label>
              <input className="input" required value={form.nom} onChange={champ('nom')} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Téléphone *</label>
              <input className="input" required value={form.telephone} onChange={champ('telephone')} placeholder="+225 07 00 00 00 00" />
            </div>
            <div>
              <label className="label">Sexe</label>
              <select className="input" value={form.sexe} onChange={champ('sexe')}>
                <option value="F">Femme</option>
                <option value="M">Homme</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label">Pièce d'identité</label>
            <input className="input" value={form.pieceIdentite} onChange={champ('pieceIdentite')} placeholder="ex. CNI C123456789" />
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" value={form.email} onChange={champ('email')} />
          </div>
          <div>
            <label className="label">Profession</label>
            <input className="input" value={form.profession} onChange={champ('profession')} />
          </div>
          <div>
            <label className="label">Adresse</label>
            <input className="input" value={form.adresse} onChange={champ('adresse')} />
          </div>
          {erreur && <p className="text-sm font-medium text-rose-600">{erreur}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setModaleOuverte(false)}>
              Annuler
            </button>
            <button type="submit" className="btn-primary">
              {clientEnEdition ? 'Enregistrer' : 'Ajouter le client'}
            </button>
          </div>
        </form>
      </Modale>
    </div>
  )
}
