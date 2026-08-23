import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { MODULE_CREDITS_ACTIF } from './config'
import { useStore } from './store'
import Connexion from './pages/Connexion'
import TableauDeBord from './pages/TableauDeBord'
import Clients from './pages/Clients'
import DetailClient from './pages/DetailClient'
import Tontines from './pages/Tontines'
import DetailTontine from './pages/DetailTontine'
import Comptes from './pages/Comptes'
import Credits from './pages/Credits'
import Transactions from './pages/Transactions'
import Caisse from './pages/Caisse'
import DetailCaisse from './pages/DetailCaisse'
import Rapports from './pages/Rapports'
import Employes from './pages/Employes'
import Agences from './pages/Agences'
import Zones from './pages/Zones'
import CompteZoneTontinePage from './pages/CompteZoneTontine'
import Audit from './pages/Audit'

export default function App() {
  const { employeConnecte, estAdmin, aDroit, chargement } = useStore()

  if (chargement) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 text-sm text-slate-300">
        Chargement…
      </div>
    )
  }

  if (!employeConnecte) return <Connexion />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<TableauDeBord />} />
        <Route path="/clients" element={<Clients />} />
        <Route path="/clients/:id" element={<DetailClient />} />
        <Route path="/tontines" element={<Tontines />} />
        <Route path="/tontines/:id" element={<DetailTontine />} />
        <Route path="/comptes" element={<Comptes />} />
        {MODULE_CREDITS_ACTIF && <Route path="/credits" element={<Credits />} />}
        <Route path="/transactions" element={<Transactions />} />
        <Route path="/caisse" element={<Caisse />} />
        <Route path="/caisse/:employeId" element={<DetailCaisse />} />
        {aDroit('voir_rapports') && <Route path="/rapports" element={<Rapports />} />}
        {estAdmin && <Route path="/agences" element={<Agences />} />}
        {(aDroit('gerer_zones') || aDroit('operer_comptes')) && (
          <Route path="/zones" element={<Zones />} />
        )}
        {(aDroit('gerer_zones') || aDroit('operer_comptes')) && (
          <Route path="/zones/:zoneId/compte" element={<CompteZoneTontinePage />} />
        )}
        {estAdmin && <Route path="/employes" element={<Employes />} />}
        {estAdmin && <Route path="/audit" element={<Audit />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
