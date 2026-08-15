import { useState } from 'react'
import { Landmark, LogIn } from 'lucide-react'
import { useStore } from '../store'

export default function Connexion() {
  const { connexion } = useStore()
  const [identifiant, setIdentifiant] = useState('')
  const [motDePasse, setMotDePasse] = useState('')
  const [erreur, setErreur] = useState('')

  const valider = (e: React.FormEvent) => {
    e.preventDefault()
    if (!connexion(identifiant, motDePasse)) {
      setErreur('Identifiant ou mot de passe incorrect.')
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-500 text-white shadow-lg">
            <Landmark className="h-8 w-8" />
          </div>
          <h1 className="text-2xl font-bold text-white">MicroFinance Pro</h1>
          <p className="mt-1 text-sm text-slate-400">Gestion de microfinance</p>
        </div>

        <form onSubmit={valider} className="rounded-2xl bg-white p-6 shadow-xl">
          <h2 className="mb-5 text-lg font-bold text-slate-900">Connexion</h2>
          <div className="space-y-4">
            <div>
              <label className="label">Identifiant</label>
              <input
                className="input"
                required
                autoFocus
                value={identifiant}
                onChange={(e) => setIdentifiant(e.target.value)}
                placeholder="ex. admin"
              />
            </div>
            <div>
              <label className="label">Mot de passe</label>
              <input
                className="input"
                type="password"
                required
                value={motDePasse}
                onChange={(e) => setMotDePasse(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            {erreur && <p className="text-sm font-medium text-rose-600">{erreur}</p>}
            <button type="submit" className="btn-primary w-full justify-center">
              <LogIn className="h-4 w-4" />
              Se connecter
            </button>
          </div>

          <div className="mt-5 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
            <p className="mb-1 font-semibold text-slate-600">Comptes de démonstration :</p>
            <p>Admin : <code className="font-mono">admin / admin123</code></p>
            <p>Chef d'agence : <code className="font-mono">chef / chef123</code></p>
            <p>Caissière : <code className="font-mono">caisse / caisse123</code></p>
            <p>Caissier : <code className="font-mono">caisse2 / caisse123</code></p>
          </div>
        </form>
      </div>
    </div>
  )
}
