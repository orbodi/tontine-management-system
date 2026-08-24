import { useState } from 'react'
import { LogIn } from 'lucide-react'
import { LOGO_URL, NOM_APPLICATION, SOUS_TITRE_APPLICATION } from '../config'
import { useStore } from '../store'

export default function Connexion() {
  const { connexion } = useStore()
  const [identifiant, setIdentifiant] = useState('')
  const [motDePasse, setMotDePasse] = useState('')
  const [erreur, setErreur] = useState('')

  const valider = async (e: React.FormEvent) => {
    e.preventDefault()
    const err = await connexion(identifiant, motDePasse)
    if (err) {
      setErreur(err)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto max-w-[200px] overflow-hidden rounded-2xl bg-white p-3 shadow-lg">
            <img
              src={LOGO_URL}
              alt={`${SOUS_TITRE_APPLICATION} ${NOM_APPLICATION}`}
              className="mx-auto h-auto max-h-28 w-full object-contain"
            />
          </div>
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
            {erreur && <p className="text-sm text-rose-600">{erreur}</p>}
          </div>
          <button type="submit" className="btn-primary mt-5 w-full">
            <LogIn className="h-4 w-4" />
            Se connecter
          </button>
        </form>
      </div>
    </div>
  )
}
