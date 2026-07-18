import { useState } from 'react'
import { KeyRound, Plus, UserCheck, UserX } from 'lucide-react'
import { LIBELLES_ROLE, useStore } from '../store'
import type { Role, Utilisateur } from '../types'
import { Avatar, EnTetePage, Modale } from '../components/ui'

export default function Utilisateurs() {
  const { data, utilisateurConnecte, ajouterUtilisateur, modifierUtilisateur, basculerActifUtilisateur } =
    useStore()
  const [modaleOuverte, setModaleOuverte] = useState(false)
  const [nomComplet, setNomComplet] = useState('')
  const [identifiant, setIdentifiant] = useState('')
  const [motDePasse, setMotDePasse] = useState('')
  const [role, setRole] = useState<Role>('caissier')
  const [erreur, setErreur] = useState('')
  const [utilisateurMdp, setUtilisateurMdp] = useState<Utilisateur | null>(null)
  const [nouveauMdp, setNouveauMdp] = useState('')

  const creer = (e: React.FormEvent) => {
    e.preventDefault()
    const ok = ajouterUtilisateur({
      nomComplet: nomComplet.trim(),
      identifiant: identifiant.trim(),
      motDePasse,
      role,
    })
    if (!ok) {
      setErreur('Cet identifiant existe déjà.')
      return
    }
    setModaleOuverte(false)
    setNomComplet('')
    setIdentifiant('')
    setMotDePasse('')
    setRole('caissier')
    setErreur('')
  }

  const changerMdp = (e: React.FormEvent) => {
    e.preventDefault()
    if (!utilisateurMdp) return
    modifierUtilisateur(utilisateurMdp.id, { motDePasse: nouveauMdp })
    setUtilisateurMdp(null)
    setNouveauMdp('')
  }

  const stylesRole: Record<Role, string> = {
    admin: 'bg-violet-100 text-violet-700',
    chef_agence: 'bg-sky-100 text-sky-700',
    caissier: 'bg-emerald-100 text-emerald-700',
  }

  return (
    <div>
      <EnTetePage
        titre="Utilisateurs"
        sousTitre="Comptes d'accès à l'application et rôles"
        action={
          <button className="btn-primary" onClick={() => setModaleOuverte(true)}>
            <Plus className="h-4 w-4" />
            Nouvel utilisateur
          </button>
        }
      />

      <div className="card overflow-x-auto !p-0">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-5 py-3.5">Utilisateur</th>
              <th className="px-5 py-3.5">Identifiant</th>
              <th className="px-5 py-3.5">Rôle</th>
              <th className="px-5 py-3.5">Statut</th>
              <th className="px-5 py-3.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.utilisateurs.map((u) => {
              const [prenom, ...reste] = u.nomComplet.split(' ')
              const estMoi = u.id === utilisateurConnecte?.id
              return (
                <tr key={u.id} className="transition hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar nom={reste.join(' ') || prenom} prenom={prenom} />
                      <span className="font-medium text-slate-900">
                        {u.nomComplet}
                        {estMoi && <span className="ml-2 text-xs text-slate-400">(vous)</span>}
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-slate-600">{u.identifiant}</td>
                  <td className="px-5 py-3">
                    <span className={`badge ${stylesRole[u.role]}`}>{LIBELLES_ROLE[u.role]}</span>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`badge ${u.actif ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                      {u.actif ? 'Actif' : 'Désactivé'}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        className="btn-secondary !px-2.5 !py-1.5 text-xs"
                        onClick={() => {
                          setUtilisateurMdp(u)
                          setNouveauMdp('')
                        }}
                        title="Changer le mot de passe"
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                      </button>
                      {!estMoi && (
                        <button
                          className="btn-secondary !px-2.5 !py-1.5 text-xs"
                          onClick={() => basculerActifUtilisateur(u.id)}
                          title={u.actif ? 'Désactiver' : 'Réactiver'}
                        >
                          {u.actif ? <UserX className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-slate-400">
        Rappel des droits : le caissier enregistre les opérations courantes ; le chef d'agence approuve en
        plus les crédits ; l'administrateur gère aussi les utilisateurs.
      </p>

      <Modale titre="Nouvel utilisateur" ouverte={modaleOuverte} onFermer={() => setModaleOuverte(false)}>
        <form onSubmit={creer} className="space-y-4">
          <div>
            <label className="label">Nom complet *</label>
            <input className="input" required value={nomComplet} onChange={(e) => setNomComplet(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Identifiant *</label>
              <input className="input" required value={identifiant} onChange={(e) => setIdentifiant(e.target.value)} />
            </div>
            <div>
              <label className="label">Mot de passe *</label>
              <input
                className="input"
                type="password"
                required
                minLength={6}
                value={motDePasse}
                onChange={(e) => setMotDePasse(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="label">Rôle</label>
            <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="caissier">Caissier</option>
              <option value="chef_agence">Chef d'agence</option>
              <option value="admin">Administrateur</option>
            </select>
          </div>
          {erreur && <p className="text-sm font-medium text-rose-600">{erreur}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setModaleOuverte(false)}>
              Annuler
            </button>
            <button type="submit" className="btn-primary">Créer l'utilisateur</button>
          </div>
        </form>
      </Modale>

      <Modale
        titre={utilisateurMdp ? `Mot de passe — ${utilisateurMdp.nomComplet}` : ''}
        ouverte={utilisateurMdp !== null}
        onFermer={() => setUtilisateurMdp(null)}
      >
        <form onSubmit={changerMdp} className="space-y-4">
          <div>
            <label className="label">Nouveau mot de passe *</label>
            <input
              className="input"
              type="password"
              required
              minLength={6}
              autoFocus
              value={nouveauMdp}
              onChange={(e) => setNouveauMdp(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setUtilisateurMdp(null)}>
              Annuler
            </button>
            <button type="submit" className="btn-primary">Changer le mot de passe</button>
          </div>
        </form>
      </Modale>
    </div>
  )
}
