import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import {
  ArrowLeftRight,
  Banknote,
  FileBarChart,
  HandCoins,
  LayoutDashboard,
  Landmark,
  LogOut,
  Menu,
  PiggyBank,
  RefreshCw,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react'
import { LIBELLES_ROLE, useStore } from '../store'

export default function Layout() {
  const [menuOuvert, setMenuOuvert] = useState(false)
  const { utilisateurConnecte, deconnexion, estAdmin, reinitialiserDemo } = useStore()

  const liens = [
    { to: '/', label: 'Tableau de bord', icon: LayoutDashboard },
    { to: '/clients', label: 'Clients', icon: Users },
    { to: '/tontines', label: 'Tontine', icon: HandCoins },
    { to: '/epargne', label: 'Épargne', icon: PiggyBank },
    { to: '/credits', label: 'Crédits', icon: Banknote },
    { to: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
    { to: '/rapports', label: 'Rapports', icon: FileBarChart },
    ...(estAdmin ? [{ to: '/utilisateurs', label: 'Utilisateurs', icon: ShieldCheck }] : []),
  ]

  const navigation = (
    <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3">
      {liens.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          onClick={() => setMenuOuvert(false)}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition ${
              isActive
                ? 'bg-brand-600 text-white shadow-sm'
                : 'text-slate-300 hover:bg-white/10 hover:text-white'
            }`
          }
        >
          <Icon className="h-5 w-5 shrink-0" />
          {label}
        </NavLink>
      ))}
    </nav>
  )

  const entete = (
    <div className="flex items-center gap-3 px-6 py-6">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500 text-white">
        <Landmark className="h-6 w-6" />
      </div>
      <div>
        <div className="text-base font-bold text-white">MicroFinance Pro</div>
        <div className="text-xs text-slate-400">Gestion de microfinance</div>
      </div>
    </div>
  )

  const piedDePage = utilisateurConnecte && (
    <div className="border-t border-white/10 px-4 py-4">
      <div className="mb-2 px-2">
        <div className="text-sm font-semibold text-white">{utilisateurConnecte.nomComplet}</div>
        <div className="text-xs text-brand-300">{LIBELLES_ROLE[utilisateurConnecte.role]}</div>
      </div>
      <button
        onClick={deconnexion}
        className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-sm text-slate-300 transition hover:bg-white/10 hover:text-white"
      >
        <LogOut className="h-4 w-4" />
        Se déconnecter
      </button>
      <button
        onClick={() => {
          if (confirm('Réinitialiser toutes les données avec le jeu de démonstration ?')) {
            reinitialiserDemo()
          }
        }}
        className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-xs text-slate-500 transition hover:text-slate-300"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Réinitialiser les données de démo
      </button>
    </div>
  )

  return (
    <div className="min-h-screen lg:flex">
      {/* Sidebar bureau */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col bg-slate-900 lg:flex print:hidden">
        {entete}
        {navigation}
        {piedDePage}
      </aside>

      {/* Barre mobile */}
      <div className="sticky top-0 z-30 flex items-center justify-between bg-slate-900 px-4 py-3 lg:hidden print:hidden">
        <div className="flex items-center gap-2 text-white">
          <Landmark className="h-6 w-6 text-brand-400" />
          <span className="font-bold">MicroFinance Pro</span>
        </div>
        <button
          onClick={() => setMenuOuvert(true)}
          className="rounded-lg p-2 text-slate-300 hover:bg-white/10"
          aria-label="Ouvrir le menu"
        >
          <Menu className="h-6 w-6" />
        </button>
      </div>

      {/* Menu mobile */}
      {menuOuvert && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMenuOuvert(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col bg-slate-900">
            <div className="flex items-center justify-between pr-4">
              {entete}
              <button
                onClick={() => setMenuOuvert(false)}
                className="rounded-lg p-2 text-slate-300 hover:bg-white/10"
                aria-label="Fermer le menu"
              >
                <X className="h-6 w-6" />
              </button>
            </div>
            {navigation}
            {piedDePage}
          </div>
        </div>
      )}

      {/* Contenu */}
      <main className="flex-1 lg:ml-64 print:ml-0">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-10">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
