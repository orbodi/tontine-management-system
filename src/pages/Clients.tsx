import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ChevronRight, MapPinned, Search, Users } from 'lucide-react'
import { useStore } from '../store'
import { EnTetePage, EtatVide } from '../components/ui'

export default function Clients() {
  const { data, estAdmin, employeConnecte } = useStore()
  const [recherche, setRecherche] = useState('')

  const agenceRestreinte = !estAdmin && employeConnecte ? employeConnecte.agenceId : null

  const zonesTriees = useMemo(() => {
    const q = recherche.trim().toLowerCase()
    let liste = data.zones.filter((z) => z.actif)
    if (agenceRestreinte) {
      liste = liste.filter((z) => z.agenceId === agenceRestreinte)
    }
    return liste
      .filter(
        (z) =>
          !q ||
          z.code.toLowerCase().includes(q) ||
          (z.nom ?? '').toLowerCase().includes(q) ||
          (data.agences.find((a) => a.id === z.agenceId)?.nom ?? '').toLowerCase().includes(q),
      )
      .sort((a, b) => a.code.localeCompare(b.code))
  }, [data.zones, data.agences, agenceRestreinte, recherche])

  const totalClients = (agenceRestreinte
    ? data.clients.filter((c) => c.agenceId === agenceRestreinte && c.zoneId)
    : data.clients.filter((c) => c.zoneId)
  ).length

  return (
    <div>
      <Link
        to="/clients"
        className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-brand-600 hover:text-brand-700"
      >
        <ArrowLeft className="h-4 w-4" />
        Retour aux types de clients
      </Link>

      <EnTetePage
        titre="Clients tontine"
        sousTitre={`${totalClients} client${totalClients > 1 ? 's' : ''} — parcourez par zone`}
      />

      <div className="relative mb-6 max-w-md">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          className="input pl-10"
          placeholder="Rechercher une zone…"
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
        />
      </div>

      {zonesTriees.length === 0 ? (
        <EtatVide
          titre="Aucune zone"
          description="Créez des zones dans le menu Zones avant d’y rattacher des clients."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {zonesTriees.map((z) => {
            const agence = data.agences.find((a) => a.id === z.agenceId)
            const nbClients = data.clients.filter((c) => c.zoneId === z.id).length
            const nbActifs = data.clients.filter((c) => c.zoneId === z.id && c.actif).length
            return (
              <Link
                key={z.id}
                to={`/clients/zone/${z.id}`}
                className="card group block transition hover:border-brand-300 hover:shadow-md"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-700 transition group-hover:bg-brand-200">
                    <MapPinned className="h-6 w-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-bold text-brand-700">{z.code}</span>
                      <h3 className="font-semibold text-slate-900">{z.nom ?? `Zone ${z.code}`}</h3>
                    </div>
                    {!agenceRestreinte && agence && (
                      <p className="mt-1 text-sm text-slate-500">{agence.nom}</p>
                    )}
                    <p className="mt-2 flex items-center gap-1.5 text-sm text-slate-600">
                      <Users className="h-4 w-4 text-slate-400" />
                      {nbClients} client{nbClients > 1 ? 's' : ''}
                      {nbClients > 0 && (
                        <span className="text-slate-400">
                          ({nbActifs} actif{nbActifs > 1 ? 's' : ''})
                        </span>
                      )}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">Carnets {z.code}xxxx</p>
                  </div>
                  <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-slate-300 transition group-hover:text-brand-600" />
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
