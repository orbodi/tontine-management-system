import { Link } from 'react-router-dom'
import { ChevronRight, HandCoins, Wallet } from 'lucide-react'
import { useStore } from '../store'
import { EnTetePage } from '../components/ui'

export default function AccueilClients() {
  const { data, estAdmin, employeConnecte } = useStore()
  const agenceRestreinte = !estAdmin && employeConnecte ? employeConnecte.agenceId : null

  const clientsVisibles = agenceRestreinte
    ? data.clients.filter((c) => c.agenceId === agenceRestreinte)
    : data.clients
  const idsBanque = new Set(
    data.comptes
      .filter((co) => {
        const client = data.clients.find((c) => c.id === co.clientId)
        if (!client) return false
        return !agenceRestreinte || client.agenceId === agenceRestreinte
      })
      .map((co) => co.clientId),
  )

  const clientsTontine = clientsVisibles.filter((c) => c.zoneId)
  const nbTontine = clientsTontine.length
  const nbBanque = idsBanque.size
  const nbLesDeux = clientsTontine.filter((c) => idsBanque.has(c.id)).length

  return (
    <div>
      <EnTetePage
        titre="Clients"
        sousTitre={`${nbTontine} fiche${nbTontine > 1 ? 's' : ''} · ${nbBanque} avec compte banque · ${nbLesDeux} dans les deux`}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Link
          to="/clients/tontine"
          className="card group block transition hover:border-brand-300 hover:shadow-md"
        >
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-brand-100 text-brand-700 transition group-hover:bg-brand-200">
              <HandCoins className="h-7 w-7" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold text-slate-900">Clients tontine</h2>
              <p className="mt-1 text-sm text-slate-500">
                Fiches rattachées à une zone — carnets ZZxxxx. Un client banque peut aussi figurer ici s’il a une tontine.
              </p>
              <p className="mt-3 text-sm font-medium text-slate-700">
                {nbTontine} client{nbTontine > 1 ? 's' : ''}
              </p>
            </div>
            <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-slate-300 transition group-hover:text-brand-600" />
          </div>
        </Link>

        <Link
          to="/clients/banque"
          className="card group block transition hover:border-sky-300 hover:shadow-md"
        >
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-sky-100 text-sky-700 transition group-hover:bg-sky-200">
              <Wallet className="h-7 w-7" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold text-slate-900">Clients banque</h2>
              <p className="mt-1 text-sm text-slate-500">
                Clients rattachés à une agence, avec un compte courant ou épargne. Ils peuvent aussi avoir une tontine.
              </p>
              <p className="mt-3 text-sm font-medium text-slate-700">
                {nbBanque} client{nbBanque > 1 ? 's' : ''}
              </p>
            </div>
            <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-slate-300 transition group-hover:text-sky-600" />
          </div>
        </Link>
      </div>
    </div>
  )
}
