import { useState } from 'react'
import { KeyRound, Pencil, Plus, ShieldCheck, Trash2, UserCheck, UserX } from 'lucide-react'
import { LIBELLES_DROIT, LIBELLES_ROLE, TOUS_DROITS, useStore } from '../store'
import type { Droit, Employe, Role } from '../types'
import { formatDate } from '../utils'
import { Avatar, EnTetePage, Modale } from '../components/ui'
import { useConfirmation } from '../components/Confirmation'

interface FormulaireEmploye {
  nomComplet: string
  identifiant: string
  motDePasse: string
  role: Role
  agenceId: string
  droits: Droit[]
  telephone: string
  email: string
  adresse: string
  pieceIdentite: string
}

const formulaireVide: FormulaireEmploye = {
  nomComplet: '',
  identifiant: '',
  motDePasse: '',
  role: 'caissier',
  agenceId: '',
  droits: ['operer_comptes', 'gerer_clients'],
  telephone: '',
  email: '',
  adresse: '',
  pieceIdentite: '',
}

export default function Employes() {
  const {
    data,
    employeConnecte,
    ajouterEmploye,
    modifierEmploye,
    supprimerEmploye,
    basculerActifEmploye,
  } = useStore()
  const [modaleOuverte, setModaleOuverte] = useState(false)
  const [employeEnEdition, setEmployeEnEdition] = useState<Employe | null>(null)
  const [form, setForm] = useState<FormulaireEmploye>(formulaireVide)
  const [erreur, setErreur] = useState('')
  const [employeMdp, setEmployeMdp] = useState<Employe | null>(null)
  const [nouveauMdp, setNouveauMdp] = useState('')
  const { confirmer } = useConfirmation()

  const ouvrirCreation = () => {
    setEmployeEnEdition(null)
    setForm({ ...formulaireVide, agenceId: data.agences[0]?.id ?? '' })
    setErreur('')
    setModaleOuverte(true)
  }

  const ouvrirEdition = (u: Employe) => {
    setEmployeEnEdition(u)
    setForm({
      nomComplet: u.nomComplet,
      identifiant: u.identifiant,
      motDePasse: u.motDePasse,
      role: u.role,
      agenceId: u.agenceId,
      droits: [...u.droits],
      telephone: u.telephone ?? '',
      email: u.email ?? '',
      adresse: u.adresse ?? '',
      pieceIdentite: u.pieceIdentite ?? '',
    })
    setErreur('')
    setModaleOuverte(true)
  }

  const enregistrer = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.agenceId) {
      setErreur('Sélectionnez une agence.')
      return
    }
    const commun = {
      nomComplet: form.nomComplet.trim(),
      identifiant: form.identifiant.trim(),
      role: form.role,
      agenceId: form.agenceId,
      droits: form.role === 'admin' ? [] : form.droits,
      telephone: form.telephone.trim() || undefined,
      email: form.email.trim() || undefined,
      adresse: form.adresse.trim() || undefined,
      pieceIdentite: form.pieceIdentite.trim() || undefined,
    }
    if (employeEnEdition) {
      modifierEmploye(employeEnEdition.id, commun)
    } else {
      const ok = ajouterEmploye({ ...commun, motDePasse: form.motDePasse })
      if (!ok) {
        setErreur('Cet identifiant existe déjà.')
        return
      }
    }
    setModaleOuverte(false)
  }

  const changerMdp = (e: React.FormEvent) => {
    e.preventDefault()
    if (!employeMdp) return
    modifierEmploye(employeMdp.id, { motDePasse: nouveauMdp })
    setEmployeMdp(null)
    setNouveauMdp('')
  }

  const basculerDroit = (droit: Droit) => {
    setForm((f) => ({
      ...f,
      droits: f.droits.includes(droit) ? f.droits.filter((d) => d !== droit) : [...f.droits, droit],
    }))
  }

  const stylesRole: Record<Role, string> = {
    admin: 'bg-violet-100 text-violet-700',
    chef_agence: 'bg-sky-100 text-sky-700',
    caissier: 'bg-emerald-100 text-emerald-700',
  }

  return (
    <div>
      <EnTetePage
        titre="Employés"
        sousTitre="Informations personnelles, comptes d'accès et droits accordés"
        action={
          <button className="btn-primary" onClick={ouvrirCreation}>
            <Plus className="h-4 w-4" />
            Nouvel employé
          </button>
        }
      />

      <div className="card overflow-x-auto !p-0">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-5 py-3.5">Employé</th>
              <th className="px-5 py-3.5">Contact</th>
              <th className="px-5 py-3.5">Rôle</th>
              <th className="px-5 py-3.5">Droits</th>
              <th className="px-5 py-3.5">Statut</th>
              <th className="px-5 py-3.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.employes.map((u) => {
              const [prenom, ...reste] = u.nomComplet.split(' ')
              const estMoi = u.id === employeConnecte?.id
              return (
                <tr key={u.id} className="transition hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar nom={reste.join(' ') || prenom} prenom={prenom} />
                      <div>
                        <div className="font-medium text-slate-900">
                          {u.nomComplet}
                          {estMoi && <span className="ml-2 text-xs text-slate-400">(vous)</span>}
                        </div>
                        <div className="text-xs text-slate-500">
                          <span className="font-mono">{u.identifiant}</span> —{' '}
                          {data.agences.find((a) => a.id === u.agenceId)?.nom ?? '—'} — embauché le{' '}
                          {formatDate(u.dateEmbauche)}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-xs text-slate-600">
                    <div>{u.telephone ?? '—'}</div>
                    <div className="text-slate-400">{u.email ?? ''}</div>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`badge ${stylesRole[u.role]}`}>{LIBELLES_ROLE[u.role]}</span>
                  </td>
                  <td className="px-5 py-3">
                    {u.role === 'admin' ? (
                      <span className="badge bg-violet-100 text-violet-700">
                        <ShieldCheck className="mr-1 h-3 w-3" />
                        Tous les droits
                      </span>
                    ) : (
                      <span className="text-xs text-slate-600">
                        {u.droits.length === 0 ? '—' : `${u.droits.length}/${TOUS_DROITS.length} droits`}
                      </span>
                    )}
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
                        onClick={() => ouvrirEdition(u)}
                        title="Modifier les informations et les droits"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        className="btn-secondary !px-2.5 !py-1.5 text-xs"
                        onClick={() => {
                          setEmployeMdp(u)
                          setNouveauMdp('')
                        }}
                        title="Changer le mot de passe"
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                      </button>
                      {!estMoi && (
                        <>
                          <button
                            className="btn-secondary !px-2.5 !py-1.5 text-xs"
                            onClick={() => basculerActifEmploye(u.id)}
                            title={u.actif ? 'Désactiver' : 'Réactiver'}
                          >
                            {u.actif ? <UserX className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
                          </button>
                          <button
                            className="btn-danger !px-2.5 !py-1.5 text-xs"
                            onClick={async () => {
                              const ok = await confirmer({
                                titre: 'Supprimer un employé',
                                message: `Supprimer définitivement l'employé ${u.nomComplet} ? Cette action est irréversible.`,
                                labelValider: 'Supprimer',
                                danger: true,
                              })
                              if (ok) supprimerEmploye(u.id)
                            }}
                            title="Supprimer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
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
        L'administrateur est le seul à avoir tous les droits ; il les accorde individuellement à chaque
        employé (bouton Modifier).
      </p>

      {/* Création / édition */}
      <Modale
        titre={employeEnEdition ? `Modifier — ${employeEnEdition.nomComplet}` : 'Nouvel employé'}
        ouverte={modaleOuverte}
        onFermer={() => setModaleOuverte(false)}
        large
      >
        <form onSubmit={enregistrer} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Nom complet *</label>
              <input className="input" required value={form.nomComplet} onChange={(e) => setForm((f) => ({ ...f, nomComplet: e.target.value }))} />
            </div>
            <div>
              <label className="label">Téléphone</label>
              <input className="input" value={form.telephone} onChange={(e) => setForm((f) => ({ ...f, telephone: e.target.value }))} placeholder="+225 07 00 00 00 00" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Email</label>
              <input className="input" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
            <div>
              <label className="label">Pièce d'identité</label>
              <input className="input" value={form.pieceIdentite} onChange={(e) => setForm((f) => ({ ...f, pieceIdentite: e.target.value }))} placeholder="ex. CNI C123456789" />
            </div>
          </div>
          <div>
            <label className="label">Adresse</label>
            <input className="input" value={form.adresse} onChange={(e) => setForm((f) => ({ ...f, adresse: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Identifiant *</label>
              <input className="input" required value={form.identifiant} onChange={(e) => setForm((f) => ({ ...f, identifiant: e.target.value }))} />
            </div>
            {!employeEnEdition && (
              <div>
                <label className="label">Mot de passe *</label>
                <input
                  className="input"
                  type="password"
                  required
                  minLength={6}
                  value={form.motDePasse}
                  onChange={(e) => setForm((f) => ({ ...f, motDePasse: e.target.value }))}
                />
              </div>
            )}
          </div>
          <div>
            <label className="label">Rôle</label>
            <select className="input" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as Role }))}>
              <option value="caissier">Caissier</option>
              <option value="chef_agence">Chef d'agence</option>
              <option value="admin">Administrateur</option>
            </select>
          </div>
          <div>
            <label className="label">Agence *</label>
            <select
              className="input"
              required
              value={form.agenceId}
              onChange={(e) => setForm((f) => ({ ...f, agenceId: e.target.value }))}
            >
              <option value="">— Choisir —</option>
              {data.agences.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.nom}
                </option>
              ))}
            </select>
          </div>
          {form.role === 'admin' ? (
            <p className="rounded-xl bg-violet-50 p-3 text-sm text-violet-700">
              L'administrateur possède tous les droits.
            </p>
          ) : (
            <div>
              <label className="label">Droits accordés</label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {TOUS_DROITS.map((droit) => (
                  <label
                    key={droit}
                    className={`flex cursor-pointer items-center gap-2 rounded-xl border p-2.5 text-sm transition ${
                      form.droits.includes(droit)
                        ? 'border-brand-300 bg-brand-50 text-brand-800'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                      checked={form.droits.includes(droit)}
                      onChange={() => basculerDroit(droit)}
                    />
                    {LIBELLES_DROIT[droit]}
                  </label>
                ))}
              </div>
            </div>
          )}
          {erreur && <p className="text-sm font-medium text-rose-600">{erreur}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setModaleOuverte(false)}>
              Annuler
            </button>
            <button type="submit" className="btn-primary">
              {employeEnEdition ? 'Enregistrer' : "Créer l'employé"}
            </button>
          </div>
        </form>
      </Modale>

      {/* Mot de passe */}
      <Modale
        titre={employeMdp ? `Mot de passe — ${employeMdp.nomComplet}` : ''}
        ouverte={employeMdp !== null}
        onFermer={() => setEmployeMdp(null)}
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
            <button type="button" className="btn-secondary" onClick={() => setEmployeMdp(null)}>
              Annuler
            </button>
            <button type="submit" className="btn-primary">Changer le mot de passe</button>
          </div>
        </form>
      </Modale>
    </div>
  )
}
