import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { useStore } from './store'
import Connexion from './pages/Connexion'
import TableauDeBord from './pages/TableauDeBord'
import Clients from './pages/Clients'
import DetailClient from './pages/DetailClient'
import Tontines from './pages/Tontines'
import Epargne from './pages/Epargne'
import Credits from './pages/Credits'
import Transactions from './pages/Transactions'
import Rapports from './pages/Rapports'
import Utilisateurs from './pages/Utilisateurs'

export default function App() {
  const { utilisateurConnecte, estAdmin } = useStore()

  if (!utilisateurConnecte) return <Connexion />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<TableauDeBord />} />
        <Route path="/clients" element={<Clients />} />
        <Route path="/clients/:id" element={<DetailClient />} />
        <Route path="/tontines" element={<Tontines />} />
        <Route path="/epargne" element={<Epargne />} />
        <Route path="/credits" element={<Credits />} />
        <Route path="/transactions" element={<Transactions />} />
        <Route path="/rapports" element={<Rapports />} />
        {estAdmin && <Route path="/utilisateurs" element={<Utilisateurs />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
