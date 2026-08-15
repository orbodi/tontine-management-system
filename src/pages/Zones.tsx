import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, MapPinned, Plus, Scale, Users } from 'lucide-react'
import { useStore } from '../store'
import { compteZoneDe } from '../metier'
import { EnTetePage, EtatVide, Modale, Avatar } from '../components/ui'
import { formatMontant, numeroCarnet, pad2 } from '../utils'
import type { Zone } from '../types'

export default function Zones() {
  const [searchParams] = useSearchParams()
  const filtreAgenceId = searchParams.get('agence') ?? ''
  const { data, ajouterZone, modifierZone, basculerActifZone } = useStore()
  const [modale, setModale] = useState(false)
  const [editionId, setEditionId] = useState<string | null>(null)
  const [agenceId, setAgenceId] = useState('')
  const [code, setCode] = useState('')
  const [nom, setNom] = useState('')
  const [erreur, setErreur] = useState('')
  const [zoneClients, setZoneClients] = useState<Zone | null>(null)

  const agenceFiltre = data.agences.find((a) => a.id === filtreAgenceId)

  const prochainCode = useMemo(() => {
    const nums = data.zones.map((z) => parseInt(z.code, 10)).filter((n) => !Number.isNaN(n))
    const max = nums.length ? Math.max(...nums) : 0
    return pad2(max + 1)
  }, [data.zones])

  const ouvrirCreation = () => {
    setEditionId(null)
    setAgenceId(
      filtreAgenceId ||
        data.agences.find((a) => a.actif)?.id ||
        '',
    )
    setCode(prochainCode)
    setNom('')
    setErreur('')
    setModale(true)
  }

  const ouvrirEdition = (id: string) => {
    const z = data.zones.find((x) => x.id === id)
    if (!z) return
    setEditionId(id)
    setAgenceId(z.agenceId)
    setCode(z.code)
    setNom(z.nom ?? '')
    setErreur('')
    setModale(true)
  }

  const enregistrer = (e: React.FormEvent) => {
    e.preventDefault()
    if (editionId) {
      const err = modifierZone(editionId, {
        agenceId,
        code: code.trim(),
        nom: nom.trim() || undefined,
      })
      if (err) {
        setErreur(err)
        return
      }
    } else {
      const err = ajouterZone({
        agenceId,
        code: code.trim(),
        nom: nom.trim() || undefined,
      })
      if (err) {
        setErreur(err)
        return
      }
    }
    setModale(false)
  }

  const zonesTriees = useMemo(() => {
    const liste = filtreAgenceId
      ? data.zones.filter((z) => z.agenceId === filtreAgenceId)
      : data.zones
    return [...liste].sort((a, b) => a.code.localeCompare(b.code))
  }, [data.zones, filtreAgenceId])

  const clientsDeLaZone = useMemo(() => {
    if (!zoneClients) return []
    return data.clients
      .filter((c) => c.zoneId === zoneClients.id)
      .sort((a, b) => a.ordreZone - b.ordreZone)
  }, [data.clients, zoneClients])

  return (
    <div>
      {agenceFiltre && (
        <Link
          to="/agences"
          className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Retour aux agences
        </Link>
      )}

      <EnTetePage
        titre={agenceFiltre ? `Zones — ${agenceFiltre.nom}` : 'Zones'}
        sousTitre={
          agenceFiltre
            ? `${zonesTriees.length} zone${zonesTriees.length > 1 ? 's' : ''} — carnets préfixés par le n° de zone`
            : `${data.zones.length} zone${data.zones.length > 1 ? 's' : ''} — le n° de carnet hérite du n° de zone (ex. 010001)`
        }
        action={
          <button className="btn-primary" onClick={ouvrirCreation}>
            <Plus className="h-4 w-4" />
            Nouvelle zone
          </button>
        }
      />

      {zonesTriees.length === 0 ? (
        <EtatVide
          titre="Aucune zone"
          description={
            agenceFiltre
              ? `Ajoutez une zone pour ${agenceFiltre.nom}.`
              : 'Créez une zone rattachée à une agence.'
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {zonesTriees.map((z) => {
            const agence = data.agences.find((a) => a.id === z.agenceId)
            const nbClients = data.clients.filter((c) => c.zoneId === z.id).length
            const compte = compteZoneDe(data.comptesZoneTontine, z.id)
            return (
              <div key={z.id} className="card">
                <div className="flex items-start gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-100 text-brand-700">
                    <MapPinned className="h-6 w-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-bold text-brand-700">{z.code}</span>
                      <h3 className="font-semibold text-slate-900">{z.nom ?? `Zone ${z.code}`}</h3>
                      <span
                        className={`badge ${z.actif ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}
                      >
                        {z.actif ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    {!agenceFiltre && (
                      <p className="mt-1 text-sm text-slate-500">
                        {agence ? `${agence.nom}` : 'Agence introuvable'}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-slate-500">
                      {nbClients} client{nbClients > 1 ? 's' : ''} — carnets {z.code}xxxx
                    </p>
                    {compte && (
                      <p className="mt-1 text-xs text-slate-500">
                        Compte zone — M {formatMontant(compte.cumulManquant)} · S{' '}
                        {formatMontant(compte.cumulSurplus)}
                      </p>
                    )}
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link to={`/zones/${z.id}/compte`} className="btn-primary !py-2 text-xs">
                    <Scale className="h-3.5 w-3.5" />
                    Compte zone tontine
                  </Link>
                  <button
                    className="btn-secondary !py-2 text-xs"
                    onClick={() => setZoneClients(z)}
                  >
                    <Users className="h-3.5 w-3.5" />
                    Clients ({nbClients})
                  </button>
                  <button className="btn-secondary !py-2 text-xs" onClick={() => ouvrirEdition(z.id)}>
                    Modifier
                  </button>
                  <button className="btn-secondary !py-2 text-xs" onClick={() => basculerActifZone(z.id)}>
                    {z.actif ? 'Désactiver' : 'Réactiver'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Modale
        titre={
          zoneClients
            ? `Clients — zone ${zoneClients.code}${zoneClients.nom ? ` (${zoneClients.nom})` : ''}`
            : 'Clients de la zone'
        }
        ouverte={!!zoneClients}
        onFermer={() => setZoneClients(null)}
      >
        {clientsDeLaZone.length === 0 ? (
          <EtatVide titre="Aucun client" description="Cette zone n’a pas encore de client." />
        ) : (
          <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
            {clientsDeLaZone.map((c) => (
              <Link
                key={c.id}
                to={`/clients/${c.id}`}
                onClick={() => setZoneClients(null)}
                className="flex items-center gap-3 py-3 transition hover:bg-slate-50"
              >
                <Avatar nom={c.nom} prenom={c.prenom} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-900">
                    {c.prenom} {c.nom}
                  </p>
                  <p className="text-xs text-slate-500">
                    {c.codeClient} · carnet {numeroCarnet(zoneClients!.code, c.ordreZone)}
                    {!c.actif ? ' · inactif' : ''}
                  </p>
                </div>
                <span className="text-xs text-brand-600">Voir</span>
              </Link>
            ))}
          </div>
        )}
      </Modale>

      <Modale
        titre={editionId ? 'Modifier la zone' : 'Nouvelle zone'}
        ouverte={modale}
        onFermer={() => setModale(false)}
      >
        <form onSubmit={enregistrer} className="space-y-4">
          <div>
            <label className="label">Agence *</label>
            <select
              className="input"
              required
              value={agenceId}
              onChange={(e) => setAgenceId(e.target.value)}
              disabled={!!filtreAgenceId && !editionId}
            >
              <option value="">— Choisir —</option>
              {data.agences
                .filter((a) => a.actif || a.id === agenceId)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nom}
                  </option>
                ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">N° zone (2 chiffres) *</label>
              <input
                className="input font-mono"
                required
                maxLength={2}
                pattern="[0-9]{2}"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="01"
              />
            </div>
            <div>
              <label className="label">Nom (optionnel)</label>
              <input
                className="input"
                value={nom}
                onChange={(e) => setNom(e.target.value)}
                placeholder="ex. Plateau Nord"
              />
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Le numéro de carnet d&apos;un client de cette zone sera du type {code || '01'}0001.
          </p>
          {erreur && <p className="text-sm font-medium text-rose-600">{erreur}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setModale(false)}>
              Annuler
            </button>
            <button type="submit" className="btn-primary">
              {editionId ? 'Enregistrer' : 'Créer'}
            </button>
          </div>
        </form>
      </Modale>
    </div>
  )
}
