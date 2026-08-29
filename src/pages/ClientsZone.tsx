import { useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronRight, Plus, Search } from 'lucide-react'
import { useStore } from '../store'
import type { Client } from '../types'
import { formatDate, afficherNumeroClient } from '../utils'
import { Avatar, EnTetePage, EtatVide, Modale } from '../components/ui'
import { ModaleClient, formulaireClientVide, type FormulaireClient } from '../components/ModaleClient'
import { useConfirmation } from '../components/Confirmation'

export default function ClientsZone() {
  const { zoneId } = useParams<{ zoneId: string }>()
  const navigate = useNavigate()
  const { data, estCaissier, estAdmin, aDroit, ajouterClient, modifierClient } = useStore()
  const { alerter, confirmer } = useConfirmation()
  const peutGererClients = estAdmin || aDroit('gerer_clients')

  const zone = data.zones.find((z) => z.id === zoneId)
  const agence = zone ? data.agences.find((a) => a.id === zone.agenceId) : undefined

  const [recherche, setRecherche] = useState('')
  const [modaleOuverte, setModaleOuverte] = useState(false)
  const [clientEnEdition, setClientEnEdition] = useState<Client | null>(null)
  const [form, setForm] = useState<FormulaireClient>(formulaireClientVide)
  const [erreur, setErreur] = useState('')

  const clientsFiltres = useMemo(() => {
    if (!zoneId) return []
    const q = recherche.trim().toLowerCase()
    return data.clients
      .filter((c) => c.zoneId === zoneId)
      .filter(
        (c) =>
          !q ||
          `${c.prenom} ${c.nom}`.toLowerCase().includes(q) ||
          (c.codeClient ?? '').toLowerCase().includes(q) ||
          afficherNumeroClient(c.codeClient).includes(q) ||
          c.telephone.replace(/\s/g, '').includes(q.replace(/\s/g, '')) ||
          (c.profession ?? '').toLowerCase().includes(q),
      )
      .sort((a, b) => (a.codeClient ?? '').localeCompare(b.codeClient ?? ''))
  }, [data.clients, zoneId, recherche])

  if (!zone) {
    return <Navigate to="/clients/tontine" replace />
  }

  const ouvrirCreation = () => {
    setClientEnEdition(null)
    setForm({
      ...formulaireClientVide,
      agenceId: zone.agenceId,
      zoneId: zone.id,
    })
    setErreur('')
    setModaleOuverte(true)
  }

  const ouvrirEdition = (c: Client) => {
    if (estCaissier) return
    setClientEnEdition(c)
    setForm({
      agenceId: c.agenceId,
      zoneId: c.zoneId ?? '',
      nom: c.nom,
      prenom: c.prenom,
      telephone: c.telephone,
      email: c.email ?? '',
      sexe: c.sexe,
      profession: c.profession ?? '',
      adresse: c.adresse ?? '',
      pieceIdentite: c.pieceIdentite ?? '',
      origineTontine: c.origineTontine === 'ancien' ? 'ancien' : 'nouveau',
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
      origineTontine: form.origineTontine,
    }
    if (clientEnEdition) {
      if (!form.zoneId) {
        setErreur('Choisissez une zone.')
        return
      }
      const zoneCible = data.zones.find((z) => z.id === form.zoneId)
      if (!zoneCible || zoneCible.agenceId !== form.agenceId) {
        setErreur('La zone doit appartenir à l’agence sélectionnée.')
        return
      }
      const zoneChangee = form.zoneId !== clientEnEdition.zoneId
      if (zoneChangee) {
        const ok = await confirmer({
          titre: 'Changer de zone',
          message:
            `Transférer ${patch.prenom} ${patch.nom} vers la zone ${zoneCible.code} ?\n\n` +
            `Un nouveau n° client (prochain rang de la zone ${zoneCible.code}) sera attribué. ` +
            `Tous les carnets tontine prendront ce numéro.`,
          labelValider: 'Transférer',
        })
        if (!ok) return
      }
      const res = await modifierClient(clientEnEdition.id, {
        ...patch,
        zoneId: form.zoneId,
      })
      if (res.erreur) {
        setErreur(res.erreur)
        return
      }
      setModaleOuverte(false)
      setErreur('')
      const numeroAffiche = afficherNumeroClient(res.codeClient ?? clientEnEdition.codeClient)
      await alerter(
        'Client modifié',
        zoneChangee
          ? `${patch.prenom} ${patch.nom} a été transféré vers la zone ${zoneCible.code} (n° ${numeroAffiche}, carnet ${res.codeClient ?? '—'}).\nTous les carnets tontine ont été réalignés sur ce numéro.`
          : `Les informations de ${patch.prenom} ${patch.nom} (n° ${numeroAffiche}) ont été mises à jour.`,
      )
      if (zoneChangee && form.zoneId !== zoneId) {
        navigate(`/clients/zone/${form.zoneId}`)
      }
      return
    }
    const cree = await ajouterClient({ ...patch, zoneId: zone.id })
    if (!cree) {
      setErreur('Impossible d’ajouter le client (zone inactive ou introuvable).')
      return
    }
    setModaleOuverte(false)
    setErreur('')
    await alerter('Client ajouté', `Le client ${patch.prenom} ${patch.nom} a été ajouté à la zone ${zone.code}.`)
  }

  return (
    <div>
      <Link
        to="/clients/tontine"
        className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-brand-600 hover:text-brand-700"
      >
        <ArrowLeft className="h-4 w-4" />
        Retour aux zones
      </Link>

      <EnTetePage
        titre={`Zone ${zone.code}${zone.nom ? ` — ${zone.nom}` : ''}`}
        sousTitre={`${agence?.nom ?? 'Agence'} · ${clientsFiltres.length} client${clientsFiltres.length > 1 ? 's' : ''} · carnets ${zone.code}xxxx`}
        action={
          peutGererClients ? (
            <button className="btn-primary" onClick={ouvrirCreation} disabled={!zone.actif}>
              <Plus className="h-4 w-4" />
              Nouveau client
            </button>
          ) : undefined
        }
      />

      {!zone.actif && (
        <div className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-950 ring-1 ring-amber-200">
          Cette zone est inactive — vous ne pouvez pas y ajouter de client.
        </div>
      )}

      <div className="relative mb-6 max-w-md">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          className="input pl-10"
          placeholder="Rechercher dans cette zone…"
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
        />
      </div>

      {clientsFiltres.length === 0 ? (
        <EtatVide
          titre="Aucun client dans cette zone"
          description={
            peutGererClients && zone.actif
              ? 'Ajoutez le premier client de la zone.'
              : 'Aucun client ne correspond à votre recherche.'
          }
        />
      ) : (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3.5">N° Client</th>
                <th className="px-5 py-3.5">Zone</th>
                <th className="px-5 py-3.5">Client</th>
                <th className="px-5 py-3.5">Téléphone</th>
                <th className="px-5 py-3.5">Profession</th>
                <th className="px-5 py-3.5">Inscrit le</th>
                <th className="px-5 py-3.5">Statut</th>
                <th className="px-5 py-3.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {clientsFiltres.map((c) => {
                const zoneClient = data.zones.find((z) => z.id === c.zoneId) ?? zone
                return (
                <tr key={c.id} className="transition hover:bg-slate-50">
                  <td className="px-5 py-3 font-mono text-xs font-semibold tabular-nums tracking-wide text-brand-700">
                    <div>{afficherNumeroClient(c.codeClient)}</div>
                    <div className="font-normal text-slate-400">{c.codeClient}</div>
                  </td>
                  <td className="px-5 py-3 font-mono text-xs font-semibold tabular-nums text-slate-700">
                    {zoneClient.code}
                    {zoneClient.nom ? <span className="ml-1 font-sans font-normal text-slate-500">— {zoneClient.nom}</span> : null}
                  </td>
                  <td className="px-5 py-3">
                    <Link to={`/clients/${c.id}`} className="flex items-center gap-3">
                      <Avatar nom={c.nom} prenom={c.prenom} />
                      <span className="font-medium text-slate-900">
                        {c.prenom} {c.nom}
                      </span>
                      {c.origineTontine === 'ancien' && (
                        <span className="badge ml-2 bg-amber-100 text-amber-800">Ancien</span>
                      )}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-slate-600">{c.telephone}</td>
                  <td className="px-5 py-3 text-slate-600">{c.profession ?? '—'}</td>
                  <td className="px-5 py-3 text-slate-600">{formatDate(c.dateInscription)}</td>
                  <td className="px-5 py-3">
                    <span
                      className={`badge ${c.actif ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}
                    >
                      {c.actif ? 'Actif' : 'Inactif'}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {!estCaissier && peutGererClients && (
                        <button
                          className="text-xs font-medium text-slate-500 hover:text-brand-600"
                          onClick={() => ouvrirEdition(c)}
                        >
                          Modifier
                        </button>
                      )}
                      <Link
                        to={`/clients/${c.id}`}
                        className="text-brand-600 hover:text-brand-700"
                        title="Voir la fiche"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Link>
                    </div>
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modale
        titre={
          clientEnEdition
            ? `Modifier ${afficherNumeroClient(clientEnEdition.codeClient)}`
            : `Nouveau client — zone ${zone.code}`
        }
        ouverte={modaleOuverte}
        onFermer={() => setModaleOuverte(false)}
      >
        <ModaleClient
          onFermer={() => setModaleOuverte(false)}
          clientEnEdition={clientEnEdition}
          form={form}
          setForm={setForm}
          erreur={erreur}
          zoneVerrouillee={!clientEnEdition}
          onSubmit={enregistrer}
        />
      </Modale>
    </div>
  )
}
