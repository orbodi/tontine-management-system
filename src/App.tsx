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
import Rapports from './pages/Rapports'
import Employes from './pages/Employes'
import Agences from './pages/Agences'
import Zones from './pages/Zones'
import Audit from './pages/Audit'

export default function App() {
  const { employeConnecte, estAdmin, aDroit } = useStore()

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
        {aDroit('voir_rapports') && <Route path="/rapports" element={<Rapports />} />}
        {estAdmin && <Route path="/agences" element={<Agences />} />}
        {aDroit('gerer_zones') && <Route path="/zones" element={<Zones />} />}
        {estAdmin && <Route path="/employes" element={<Employes />} />}
        {estAdmin && <Route path="/audit" element={<Audit />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
