import { useMemo, useRef, useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import {
  ArrowLeftRight,
  Banknote,
  Building2,
  Calculator,
  ClipboardList,
  Download,
  FileBarChart,
  HandCoins,
  LayoutDashboard,
  LogOut,
  MapPinned,
  Menu,
  Scale,
  ShieldCheck,
  Upload,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import { MODULE_CREDITS_ACTIF, LOGO_URL, NOM_APPLICATION, SOUS_TITRE_APPLICATION } from '../config'
import { LIBELLES_ROLE, useStore } from '../store'
import {
  aujourdHuiIso,
  messageBlocageCaisseJournaliere,
  ouvertureCaisseDuJour,
  arretCaisseDuJour,
} from '../metier'
import { useConfirmation } from './Confirmation'

export default function Layout() {
  const [menuOuvert, setMenuOuvert] = useState(false)
  const [exportEnCours, setExportEnCours] = useState(false)
  const [importEnCours, setImportEnCours] = useState(false)
  const inputImportRef = useRef<HTMLInputElement>(null)
  const {
    data,
    employeConnecte,
    deconnexion,
    estAdmin,
    estChefAgence,
    estCaissier,
    aDroit,
    agenceFiltreOperations,
    exporterSauvegardeCsv,
    importerSauvegardeCsv,
  } = useStore()
  const { alerter, confirmer } = useConfirmation()

  const agence = data.agences.find((a) => a.id === employeConnecte?.agenceId)
  const aujourdhui = aujourdHuiIso()

  const caissesSansOuvertureJour = useMemo(() => {
    return data.employes
      .filter((e) => e.actif && (e.role === 'caissier' || e.role === 'chef_agence'))
      .filter((e) => !agenceFiltreOperations || e.agenceId === agenceFiltreOperations)
      .filter((e) => {
        const ouverte = !!ouvertureCaisseDuJour(data.ouverturesCaisse ?? [], e.id, aujourdhui)
        const cloturee = !!arretCaisseDuJour(data.arretsCaisse, e.id, aujourdhui)
        return !ouverte && !cloturee
      })
      .sort((a, b) => a.nomComplet.localeCompare(b.nomComplet))
  }, [data.employes, data.ouverturesCaisse, data.arretsCaisse, agenceFiltreOperations, aujourdhui])

  const monBlocageCaisse =
    employeConnecte && (estCaissier || estChefAgence)
      ? messageBlocageCaisseJournaliere(
          employeConnecte.id,
          data.transactions,
          data.arretsCaisse,
          data.ouverturesCaisse ?? [],
        )
      : null

  const afficherAlerteCaisse =
    !!monBlocageCaisse || ((estAdmin || estChefAgence) && caissesSansOuvertureJour.length > 0)

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
    ...(estAdmin || aDroit('gerer_comptabilite') || aDroit('voir_rapports')
      ? [{ to: '/comptabilite', label: 'Comptabilité', icon: Calculator }]
      : []),
    ...(estAdmin ? [{ to: '/audit', label: 'Audit', icon: ClipboardList }] : []),
  ]

  const exporter = async () => {
    setExportEnCours(true)
    try {
      await exporterSauvegardeCsv()
      await alerter('Export terminé', 'La sauvegarde CSV (fichier ZIP) a été téléchargée.')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Impossible de générer la sauvegarde.'
      await alerter('Export impossible', msg)
    } finally {
      setExportEnCours(false)
    }
  }

  const surFichierImport = async (fichier: File | undefined) => {
    if (!fichier) return
    const ok = await confirmer({
      titre: 'Importer une sauvegarde',
      message:
        'Cette opération remplace toutes les données actuelles par le contenu du fichier. Continuer ?',
      labelValider: 'Importer',
      danger: true,
    })
    if (!ok) return
    setImportEnCours(true)
    try {
      const err = await importerSauvegardeCsv(fichier)
      if (err) await alerter('Import impossible', err)
      else await alerter('Import terminé', 'Les données ont été restaurées depuis la sauvegarde CSV.')
    } catch {
      await alerter('Import impossible', 'Le fichier n’a pas pu être importé.')
    } finally {
      setImportEnCours(false)
      if (inputImportRef.current) inputImportRef.current.value = ''
    }
  }

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
      {estAdmin && (
        <>
          <button
            type="button"
            disabled={exportEnCours || importEnCours}
            onClick={() => {
              setMenuOuvert(false)
              void exporter()
            }}
            className="flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
          >
            <Download className="h-5 w-5 shrink-0" />
            {exportEnCours ? 'Export…' : 'Sauvegarder (CSV)'}
          </button>
          <button
            type="button"
            disabled={exportEnCours || importEnCours}
            onClick={() => {
              setMenuOuvert(false)
              inputImportRef.current?.click()
            }}
            className="flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
          >
            <Upload className="h-5 w-5 shrink-0" />
            {importEnCours ? 'Import…' : 'Importer (CSV)'}
          </button>
          <input
            ref={inputImportRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => void surFichierImport(e.target.files?.[0])}
          />
        </>
      )}
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
        onClick={async () => {
          await deconnexion()
        }}
        className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-sm text-slate-300 transition hover:bg-white/10 hover:text-white"
      >
        <LogOut className="h-4 w-4" />
        Se déconnecter
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
          {afficherAlerteCaisse && (
            <div className="mb-6 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-950 ring-1 ring-amber-200 print:hidden">
              <p className="font-semibold">Ouverture de journée de caisse requise</p>
              <p className="mt-1">
                Les dépôts tontine, opérations de compte et autres encaissements ne sont possibles
                pour un caissier (ou chef d’agence) qu’après ouverture de sa journée de caisse par
                l’admin ou le chef d’agence.
              </p>
              {monBlocageCaisse && (
                <p className="mt-2 font-medium text-rose-800">{monBlocageCaisse}</p>
              )}
              {(estAdmin || estChefAgence) && caissesSansOuvertureJour.length > 0 && (
                <p className="mt-2">
                  Caisse(s) non ouverte(s) aujourd’hui ({aujourdhui}) :{' '}
                  <strong>
                    {caissesSansOuvertureJour.map((e) => e.nomComplet).join(', ')}
                  </strong>
                </p>
              )}
              <Link
                to="/caisse"
                className="mt-2 inline-flex font-semibold text-brand-700 hover:text-brand-800"
              >
                {estAdmin || estChefAgence ? 'Ouvrir les caisses →' : 'Voir ma caisse →'}
              </Link>
            </div>
          )}
          <Outlet />
        </div>
      </main>
    </div>
  )
}
