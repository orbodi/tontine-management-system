import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  HandCoins,
  PiggyBank,
  TriangleAlert,
  Users,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useStore } from '../store'
import { situationCredit } from '../metier'
import { formatDate, formatMontant } from '../utils'
import { EnTetePage } from '../components/ui'
import { TYPES_SORTIE } from './Transactions'

const MOIS_COURTS = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'juil', 'août', 'sep', 'oct', 'nov', 'déc']

export default function TableauDeBord() {
  const { data, utilisateurConnecte } = useStore()

  const stats = useMemo(() => {
    const clientsActifs = data.clients.filter((c) => c.actif).length
    const totalEpargne = data.comptes.reduce((s, c) => s + c.solde, 0)
    const encoursTontine = data.carnets
      .filter((c) => c.actif)
      .reduce((s, carnet) => {
        const mises = data.mises
          .filter((m) => m.carnetId === carnet.id && m.cycle === carnet.cycleActuel)
          .reduce((x, m) => x + m.nombreMises, 0)
        return s + mises * carnet.mise
      }, 0)
    const creditsActifs = data.credits.filter((c) => c.statut === 'en_cours' || c.statut === 'en_retard')
    const encoursCredits = creditsActifs.reduce(
      (s, c) => s + situationCredit(c, data.remboursements).resteAPayer,
      0,
    )
    const creditsEnRetard = data.credits.filter((c) => c.statut === 'en_retard').length
    const demandesEnAttente = data.credits.filter((c) => c.statut === 'en_attente').length
    return { clientsActifs, totalEpargne, encoursTontine, encoursCredits, creditsEnRetard, demandesEnAttente }
  }, [data])

  const fluxMensuels = useMemo(() => {
    const mois: { cle: string; label: string; entrees: number; sorties: number }[] = []
    const d = new Date()
    for (let i = 5; i >= 0; i--) {
      const m = new Date(d.getFullYear(), d.getMonth() - i, 1)
      mois.push({
        cle: `${m.getFullYear()}-${m.getMonth()}`,
        label: MOIS_COURTS[m.getMonth()],
        entrees: 0,
        sorties: 0,
      })
    }
    data.transactions.forEach((t) => {
      const dt = new Date(t.date)
      const ligne = mois.find((m) => m.cle === `${dt.getFullYear()}-${dt.getMonth()}`)
      if (!ligne) return
      if (TYPES_SORTIE.includes(t.type)) ligne.sorties += t.montant
      else ligne.entrees += t.montant
    })
    return mois
  }, [data.transactions])

  const repartitionCredits = useMemo(() => {
    const compte = { en_cours: 0, en_retard: 0, rembourse: 0, en_attente: 0, rejete: 0 }
    data.credits.forEach((c) => {
      compte[c.statut]++
    })
    return [
      { nom: 'En cours', valeur: compte.en_cours, couleur: '#0ea5e9' },
      { nom: 'En retard', valeur: compte.en_retard, couleur: '#f43f5e' },
      { nom: 'Remboursés', valeur: compte.rembourse, couleur: '#21b57c' },
      { nom: 'En attente', valeur: compte.en_attente, couleur: '#f59e0b' },
      { nom: 'Rejetés', valeur: compte.rejete, couleur: '#94a3b8' },
    ].filter((x) => x.valeur > 0)
  }, [data.credits])

  const dernieresTransactions = data.transactions.slice(0, 7)

  const cartes = [
    {
      label: 'Clients actifs',
      valeur: String(stats.clientsActifs),
      icone: Users,
      couleur: 'bg-sky-100 text-sky-600',
      lien: '/clients',
    },
    {
      label: 'Encours tontine',
      valeur: formatMontant(stats.encoursTontine),
      icone: HandCoins,
      couleur: 'bg-amber-100 text-amber-600',
      lien: '/tontines',
    },
    {
      label: 'Encours épargne',
      valeur: formatMontant(stats.totalEpargne),
      icone: PiggyBank,
      couleur: 'bg-emerald-100 text-emerald-600',
      lien: '/epargne',
    },
    {
      label: 'Encours crédits',
      valeur: formatMontant(Math.round(stats.encoursCredits)),
      icone: Banknote,
      couleur: 'bg-violet-100 text-violet-600',
      lien: '/credits',
    },
  ]

  return (
    <div>
      <EnTetePage
        titre={`Bonjour, ${utilisateurConnecte?.nomComplet.split(' ')[0] ?? ''}`}
        sousTitre={`Vue d'ensemble au ${formatDate(new Date().toISOString())}`}
      />

      {(stats.creditsEnRetard > 0 || stats.demandesEnAttente > 0) && (
        <div className="mb-6 flex flex-wrap gap-3">
          {stats.creditsEnRetard > 0 && (
            <Link
              to="/credits"
              className="flex items-center gap-2 rounded-xl bg-rose-50 px-4 py-2.5 text-sm font-medium text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-100"
            >
              <TriangleAlert className="h-4 w-4" />
              {stats.creditsEnRetard} crédit{stats.creditsEnRetard > 1 ? 's' : ''} en retard de paiement
            </Link>
          )}
          {stats.demandesEnAttente > 0 && (
            <Link
              to="/credits"
              className="flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-700 ring-1 ring-amber-200 transition hover:bg-amber-100"
            >
              <Banknote className="h-4 w-4" />
              {stats.demandesEnAttente} demande{stats.demandesEnAttente > 1 ? 's' : ''} de crédit à traiter
            </Link>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cartes.map((c) => (
          <Link key={c.label} to={c.lien} className="card transition hover:shadow-md">
            <div className="flex items-center gap-4">
              <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${c.couleur}`}>
                <c.icone className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-xl font-bold text-slate-900">{c.valeur}</div>
                <div className="text-sm text-slate-500">{c.label}</div>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="card xl:col-span-2">
          <h3 className="mb-4 font-semibold text-slate-900">Flux de caisse (6 derniers mois)</h3>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={fluxMensuels}>
              <defs>
                <linearGradient id="gradEntrees" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#21b57c" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#21b57c" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradSorties" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#f43f5e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => (v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
              />
              <Tooltip formatter={(v: number) => formatMontant(v)} />
              <Area type="monotone" dataKey="entrees" name="Entrées" stroke="#21b57c" strokeWidth={2.5} fill="url(#gradEntrees)" />
              <Area type="monotone" dataKey="sorties" name="Sorties" stroke="#f43f5e" strokeWidth={2.5} fill="url(#gradSorties)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h3 className="mb-4 font-semibold text-slate-900">Portefeuille de crédits</h3>
          {repartitionCredits.length === 0 ? (
            <p className="text-sm text-slate-500">Aucun crédit enregistré.</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={repartitionCredits} dataKey="valeur" nameKey="nom" innerRadius={55} outerRadius={85} paddingAngle={3}>
                    {repartitionCredits.map((e) => (
                      <Cell key={e.nom} fill={e.couleur} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 space-y-1.5">
                {repartitionCredits.map((e) => (
                  <div key={e.nom} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-slate-600">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: e.couleur }} />
                      {e.nom}
                    </span>
                    <span className="font-semibold text-slate-900">{e.valeur}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="card mt-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold text-slate-900">Dernières transactions</h3>
          <Link to="/transactions" className="text-sm font-medium text-brand-600 hover:text-brand-700">
            Tout voir
          </Link>
        </div>
        <div className="divide-y divide-slate-100">
          {dernieresTransactions.map((t) => {
            const sortie = TYPES_SORTIE.includes(t.type)
            return (
              <div key={t.id} className="flex items-center gap-3 py-3">
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                    sortie ? 'bg-rose-100 text-rose-600' : 'bg-emerald-100 text-emerald-600'
                  }`}
                >
                  {sortie ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{t.description}</p>
                  <p className="text-xs text-slate-500">
                    {formatDate(t.date)} — par {t.operateur}
                  </p>
                </div>
                <div className={`text-sm font-bold ${sortie ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {sortie ? '-' : '+'}
                  {formatMontant(t.montant)}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
