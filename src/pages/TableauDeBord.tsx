import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  HandCoins,
  PiggyBank,
  Scale,
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
import { MODULE_CREDITS_ACTIF } from '../config'
import { useStore } from '../store'
import { TYPES_SORTIE, LIBELLES_CARNET, situationCredit, situationsCycles } from '../metier'
import type { TypeCarnet } from '../types'
import { formatDate, formatMontant } from '../utils'
import { EnTetePage } from '../components/ui'

const MOIS_COURTS = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'juil', 'août', 'sep', 'oct', 'nov', 'déc']

export default function TableauDeBord() {
  const { data, employeConnecte, estCaissier, agenceFiltreOperations } = useStore()

  const txVisibles = useMemo(() => {
    let tx = data.transactions
    if (agenceFiltreOperations) tx = tx.filter((t) => t.agenceId === agenceFiltreOperations)
    else if (estCaissier && employeConnecte) tx = tx.filter((t) => t.operateurId === employeConnecte.id)
    return tx
  }, [data.transactions, agenceFiltreOperations, estCaissier, employeConnecte])

  const arretsVisibles = useMemo(() => {
    let arrets = data.arretsCaisse
    if (agenceFiltreOperations) arrets = arrets.filter((a) => a.agenceId === agenceFiltreOperations)
    else if (estCaissier && employeConnecte) arrets = arrets.filter((a) => a.employeId === employeConnecte.id)
    return arrets
  }, [data.arretsCaisse, agenceFiltreOperations, estCaissier, employeConnecte])

  const stats = useMemo(() => {
    const clients = agenceFiltreOperations
      ? data.clients.filter((c) => c.agenceId === agenceFiltreOperations)
      : data.clients
    const clientsActifs = clients.filter((c) => c.actif).length
    const clientIds = new Set(clients.map((c) => c.id))
    const comptes = agenceFiltreOperations
      ? data.comptes.filter((c) => clientIds.has(c.clientId))
      : data.comptes
    const totalComptes = comptes.reduce((s, c) => s + c.solde, 0)
    const carnets = agenceFiltreOperations
      ? data.carnets.filter((c) => c.agenceId === agenceFiltreOperations)
      : data.carnets
    const encoursTontine = carnets
      .filter((c) => c.actif)
      .reduce((s, carnet) => {
        const cycles = situationsCycles(carnet, data.mises)
        return s + cycles.reduce((x, et) => x + et.nets * carnet.mise, 0)
      }, 0)
    const creditsActifs = data.credits.filter((c) => c.statut === 'en_cours' || c.statut === 'en_retard')
    const encoursCredits = creditsActifs.reduce(
      (s, c) => s + situationCredit(c, data.remboursements).resteAPayer,
      0,
    )
    const creditsEnRetard = data.credits.filter((c) => c.statut === 'en_retard').length
    const demandesEnAttente = data.credits.filter((c) => c.statut === 'en_attente').length
    return {
      clientsActifs,
      totalComptes,
      encoursTontine,
      encoursCredits,
      creditsEnRetard,
      demandesEnAttente,
      comptesParType: [
        {
          cle: 'courant',
          label: 'Compte courant',
          nombre: comptes.filter((c) => c.type === 'courant').length,
          lien: '/comptes',
          couleur: 'bg-emerald-50 text-emerald-800 ring-emerald-100',
        },
        {
          cle: 'epargne',
          label: 'Compte épargne',
          nombre: comptes.filter((c) => c.type === 'epargne').length,
          lien: '/comptes',
          couleur: 'bg-teal-50 text-teal-800 ring-teal-100',
        },
        ...(Object.keys(LIBELLES_CARNET) as TypeCarnet[]).map((type) => ({
          cle: type,
          label: LIBELLES_CARNET[type],
          nombre: carnets.filter((c) => c.actif && c.typeCarnet === type).length,
          lien: '/tontines',
          couleur:
            type === 'tontine'
              ? 'bg-amber-50 text-amber-900 ring-amber-100'
              : type === 'carte_tous'
                ? 'bg-sky-50 text-sky-900 ring-sky-100'
                : type === 'carte_enfants'
                  ? 'bg-violet-50 text-violet-900 ring-violet-100'
                  : 'bg-slate-100 text-slate-800 ring-slate-200',
        })),
      ],
    }
  }, [data, agenceFiltreOperations])

  const infoCaisseMois = useMemo(() => {
    const maintenant = new Date()
    const annee = maintenant.getFullYear()
    const mois = maintenant.getMonth()
    let depots = 0
    let retraits = 0
    txVisibles.forEach((t) => {
      const dt = new Date(t.date)
      if (dt.getFullYear() !== annee || dt.getMonth() !== mois) return
      if (TYPES_SORTIE.includes(t.type)) retraits += t.montant
      else depots += t.montant
    })
    let manquant = 0
    let surplus = 0
    arretsVisibles.forEach((a) => {
      const dt = new Date(a.date)
      if (dt.getFullYear() !== annee || dt.getMonth() !== mois) return
      if (a.ecart < 0) manquant += Math.abs(a.ecart)
      else if (a.ecart > 0) surplus += a.ecart
    })
    return {
      depots,
      retraits,
      manquant,
      surplus,
      labelMois: `${MOIS_COURTS[mois]} ${annee}`,
    }
  }, [txVisibles, arretsVisibles])

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
    txVisibles.forEach((t) => {
      const dt = new Date(t.date)
      const ligne = mois.find((m) => m.cle === `${dt.getFullYear()}-${dt.getMonth()}`)
      if (!ligne) return
      if (TYPES_SORTIE.includes(t.type)) ligne.sorties += t.montant
      else ligne.entrees += t.montant
    })
    return mois
  }, [txVisibles])

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

  const dernieresTransactions = txVisibles.slice(0, 7)

  const cartes = [
    {
      label: 'Clients actifs',
      valeur: String(stats.clientsActifs),
      icone: Users,
      couleur: 'bg-sky-100 text-sky-600',
      lien: '/clients',
    },
    {
      label: 'Encours tontine & cartes',
      valeur: formatMontant(stats.encoursTontine),
      icone: HandCoins,
      couleur: 'bg-amber-100 text-amber-600',
      lien: '/tontines',
    },
    {
      label: 'Encours des comptes',
      valeur: formatMontant(stats.totalComptes),
      icone: PiggyBank,
      couleur: 'bg-emerald-100 text-emerald-600',
      lien: '/comptes',
    },
    ...(MODULE_CREDITS_ACTIF
      ? [
          {
            label: 'Encours crédits',
            valeur: formatMontant(Math.round(stats.encoursCredits)),
            icone: Banknote,
            couleur: 'bg-violet-100 text-violet-600',
            lien: '/credits',
          },
        ]
      : []),
  ]

  return (
    <div>
      <EnTetePage
        titre={`Bonjour, ${employeConnecte?.nomComplet.split(' ')[0] ?? ''}`}
        sousTitre={`Vue d'ensemble au ${formatDate(new Date().toISOString())}`}
      />

      {MODULE_CREDITS_ACTIF && (stats.creditsEnRetard > 0 || stats.demandesEnAttente > 0) && (
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

      <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${MODULE_CREDITS_ACTIF ? 'xl:grid-cols-4' : 'xl:grid-cols-3'}`}>
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

      <div className="card mt-6">
        <h3 className="mb-4 font-semibold text-slate-900">Nombre de comptes par type</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {stats.comptesParType.map((t) => (
            <Link
              key={t.cle}
              to={t.lien}
              className={`rounded-xl px-4 py-3 ring-1 transition hover:shadow-sm ${t.couleur}`}
            >
              <div className="text-2xl font-bold tabular-nums">{t.nombre}</div>
              <div className="mt-0.5 text-xs font-medium leading-snug opacity-80">{t.label}</div>
            </Link>
          ))}
        </div>
      </div>

      <div className="card mt-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Scale className="h-5 w-5 text-brand-600" />
            <h3 className="font-semibold text-slate-900">
              Caisse — {infoCaisseMois.labelMois}
            </h3>
          </div>
          <Link to="/caisse" className="text-sm font-medium text-brand-600 hover:text-brand-700">
            Voir la caisse
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl bg-emerald-50 px-4 py-3 ring-1 ring-emerald-100">
            <div className="text-xs font-medium uppercase tracking-wide text-emerald-700">Dépôts du mois</div>
            <div className="mt-1 text-lg font-bold text-emerald-800">{formatMontant(infoCaisseMois.depots)}</div>
          </div>
          <div className="rounded-xl bg-rose-50 px-4 py-3 ring-1 ring-rose-100">
            <div className="text-xs font-medium uppercase tracking-wide text-rose-700">Retraits du mois</div>
            <div className="mt-1 text-lg font-bold text-rose-800">{formatMontant(infoCaisseMois.retraits)}</div>
          </div>
          <div className="rounded-xl bg-amber-50 px-4 py-3 ring-1 ring-amber-100">
            <div className="text-xs font-medium uppercase tracking-wide text-amber-700">Manquant</div>
            <div className="mt-1 text-lg font-bold text-amber-900">{formatMontant(infoCaisseMois.manquant)}</div>
            <div className="mt-0.5 text-xs text-amber-700/80">Écarts négatifs (arrêts)</div>
          </div>
          <div className="rounded-xl bg-sky-50 px-4 py-3 ring-1 ring-sky-100">
            <div className="text-xs font-medium uppercase tracking-wide text-sky-700">Surplus</div>
            <div className="mt-1 text-lg font-bold text-sky-900">{formatMontant(infoCaisseMois.surplus)}</div>
            <div className="mt-0.5 text-xs text-sky-700/80">Écarts positifs (arrêts)</div>
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className={`card ${MODULE_CREDITS_ACTIF ? 'xl:col-span-2' : 'xl:col-span-3'}`}>
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

        {MODULE_CREDITS_ACTIF && (
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
        )}
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
