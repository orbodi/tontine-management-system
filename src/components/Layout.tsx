import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import {
  ArrowLeftRight,
  Banknote,
  Building2,
  ClipboardList,
  FileBarChart,
  HandCoins,
  LayoutDashboard,
  LogOut,
  MapPinned,
  Menu,
  RefreshCw,
  Scale,
  ShieldCheck,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import { MODULE_CREDITS_ACTIF, LOGO_URL, NOM_APPLICATION, SOUS_TITRE_APPLICATION } from '../config'
import { LIBELLES_ROLE, useStore } from '../store'
import { useConfirmation } from './Confirmation'

export default function Layout() {
  const [menuOuvert, setMenuOuvert] = useState(false)
  const { data, employeConnecte, deconnexion, estAdmin, estChefAgence, aDroit, reinitialiserDemo } = useStore()
  const { confirmer } = useConfirmation()

  const agence = data.agences.find((a) => a.id === employeConnecte?.agenceId)

  const liens = [
    { to: '/', label: 'Tableau de bord', icon: LayoutDashboard },
    { to: '/clients', label: 'Clients', icon: Users },
    { to: '/tontines', label: 'Tontine & cartes', icon: HandCoins },
    { to: '/comptes', label: 'Comptes', icon: Wallet },
    ...(MODULE_CREDITS_ACTIF ? [{ to: '/credits', label: 'Crédits', icon: Banknote }] : []),
    { to: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
    {
      to: '/caisse',
      label: estAdmin || estChefAgence ? 'Suivi caisses' : 'Ma caisse',
      icon: Scale,
    },
    ...(aDroit('voir_rapports') ? [{ to: '/rapports', label: 'Rapports', icon: FileBarChart }] : []),
    ...(estAdmin ? [{ to: '/agences', label: 'Agences', icon: Building2 }] : []),
    ...(aDroit('gerer_zones') || aDroit('operer_comptes')
      ? [
          {
            to: '/zones',
            label: aDroit('gerer_zones') ? 'Zones' : 'Collecte tontine',
            icon: MapPinned,
          },
        ]
      : []),
    ...(estAdmin ? [{ to: '/employes', label: 'Employés', icon: ShieldCheck }] : []),
    ...(estAdmin ? [{ to: '/audit', label: 'Audit', icon: ClipboardList }] : []),
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
    <div className="shrink-0 px-4 py-4">
      <div className="overflow-hidden rounded-2xl bg-white p-2 shadow-sm">
        <img
          src={LOGO_URL}
          alt={`${SOUS_TITRE_APPLICATION} ${NOM_APPLICATION}`}
          className="mx-auto h-20 w-auto max-w-full object-contain"
        />
      </div>
    </div>
  )

  const piedDePage = employeConnecte && (
    <div className="border-t border-white/10 px-4 py-4">
      <div className="mb-2 px-2">
        <div className="text-sm font-semibold text-white">{employeConnecte.nomComplet}</div>
        <div className="text-xs text-brand-300">{LIBELLES_ROLE[employeConnecte.role]}</div>
        {agence && (
          <div className="mt-0.5 text-xs text-slate-400">
            {agence.code} — {agence.nom}
          </div>
        )}
      </div>
      <button
        onClick={deconnexion}
        className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-sm text-slate-300 transition hover:bg-white/10 hover:text-white"
      >
        <LogOut className="h-4 w-4" />
        Se déconnecter
      </button>
      <button
        onClick={async () => {
          const ok = await confirmer({
            titre: 'Réinitialiser les données',
            message: 'Réinitialiser toutes les données avec le jeu de démonstration ? Les saisies actuelles seront perdues.',
            labelValider: 'Réinitialiser',
            danger: true,
          })
          if (ok) reinitialiserDemo()
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
        <div className="flex items-center gap-2.5 text-white">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white">
            <img
              src={LOGO_URL}
              alt={NOM_APPLICATION}
              className="h-8 w-8 object-contain"
            />
          </div>
          <span className="font-bold">{NOM_APPLICATION}</span>
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
