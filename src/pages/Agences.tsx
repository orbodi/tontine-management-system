import { useState } from 'react'
import { Building2, Plus } from 'lucide-react'
import { useStore } from '../store'
import { EnTetePage, EtatVide, Modale } from '../components/ui'

export default function Agences() {
  const { data, ajouterAgence, modifierAgence, basculerActifAgence } = useStore()
  const [modale, setModale] = useState(false)
  const [editionId, setEditionId] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [nom, setNom] = useState('')
  const [adresse, setAdresse] = useState('')
  const [chefId, setChefId] = useState('')
  const [erreur, setErreur] = useState('')

  const ouvrirCreation = () => {
    setEditionId(null)
    setCode('')
    setNom('')
    setAdresse('')
    setChefId('')
    setErreur('')
    setModale(true)
  }

  const ouvrirEdition = (id: string) => {
    const a = data.agences.find((x) => x.id === id)
    if (!a) return
    setEditionId(id)
    setCode(a.code)
    setNom(a.nom)
    setAdresse(a.adresse ?? '')
    setChefId(a.chefEmployeId ?? '')
    setErreur('')
    setModale(true)
  }

  const enregistrer = (e: React.FormEvent) => {
    e.preventDefault()
    if (editionId) {
      modifierAgence(editionId, {
        code: code.trim(),
        nom: nom.trim(),
        adresse: adresse.trim() || undefined,
        chefEmployeId: chefId || undefined,
      })
    } else {
      const ok = ajouterAgence({
        code: code.trim(),
        nom: nom.trim(),
        adresse: adresse.trim() || undefined,
        chefEmployeId: chefId || undefined,
      })
      if (!ok) {
        setErreur('Ce code d\'agence existe déjà.')
        return
      }
    }
    setModale(false)
  }

  const chefs = data.employes.filter((u) => u.role === 'chef_agence' || u.role === 'admin')

  return (
    <div>
      <EnTetePage
        titre="Agences"
        sousTitre={`${data.agences.length} agence${data.agences.length > 1 ? 's' : ''}`}
        action={
          <button className="btn-primary" onClick={ouvrirCreation}>
            <Plus className="h-4 w-4" />
            Nouvelle agence
          </button>
        }
      />

      {data.agences.length === 0 ? (
        <EtatVide titre="Aucune agence" />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {data.agences.map((a) => {
            const chef = data.employes.find((u) => u.id === a.chefEmployeId)
            const nbClients = data.clients.filter((c) => c.agenceId === a.id).length
            const nbEmployes = data.employes.filter((u) => u.agenceId === a.id).length
            return (
              <div key={a.id} className="card">
                <div className="flex items-start gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-100 text-brand-700">
                    <Building2 className="h-6 w-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-bold text-brand-700">{a.code}</span>
                      <h3 className="font-semibold text-slate-900">{a.nom}</h3>
                      <span className={`badge ${a.actif ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                        {a.actif ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">{a.adresse ?? 'Adresse non renseignée'}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      Chef : {chef?.nomComplet ?? '—'} — {nbClients} client{nbClients > 1 ? 's' : ''} —{' '}
                      {nbEmployes} employé{nbEmployes > 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex gap-2">
                  <button className="btn-secondary !py-2 text-xs" onClick={() => ouvrirEdition(a.id)}>
                    Modifier
                  </button>
                  <button className="btn-secondary !py-2 text-xs" onClick={() => basculerActifAgence(a.id)}>
                    {a.actif ? 'Désactiver' : 'Réactiver'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Modale
        titre={editionId ? 'Modifier l\'agence' : 'Nouvelle agence'}
        ouverte={modale}
        onFermer={() => setModale(false)}
      >
        <form onSubmit={enregistrer} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Code (2 chiffres) *</label>
              <input
                className="input font-mono"
                required
                maxLength={2}
                pattern="[0-9]{2}"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="01"
              />
            </div>
            <div>
              <label className="label">Nom *</label>
              <input className="input" required value={nom} onChange={(e) => setNom(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label">Adresse</label>
            <input className="input" value={adresse} onChange={(e) => setAdresse(e.target.value)} />
          </div>
          <div>
            <label className="label">Chef d'agence</label>
            <select className="input" value={chefId} onChange={(e) => setChefId(e.target.value)}>
              <option value="">— Aucun —</option>
              {chefs.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nomComplet}
                </option>
              ))}
            </select>
          </div>
          {erreur && <p className="text-sm font-medium text-rose-600">{erreur}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setModale(false)}>
              Annuler
            </button>
            <button type="submit" className="btn-primary">
              {editionId ? 'Enregistrer' : 'Créer'}
            </button>
          </div>
        </form>
      </Modale>
    </div>
  )
}
