import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownToLine, ArrowUpFromLine, PiggyBank, Plus, Search } from 'lucide-react'
import { useStore } from '../store'
import type { CompteEpargne } from '../types'
import { formatDate, formatMontant } from '../utils'
import { Avatar, EnTetePage, EtatVide, Modale } from '../components/ui'

export default function Epargne() {
  const { data, ouvrirCompte, deposerEpargne, retirerEpargne } = useStore()
  const [recherche, setRecherche] = useState('')
  const [modaleOuverture, setModaleOuverture] = useState(false)
  const [clientPourCompte, setClientPourCompte] = useState('')
  const [operation, setOperation] = useState<{ compte: CompteEpargne; type: 'depot' | 'retrait' } | null>(null)
  const [montantOp, setMontantOp] = useState('')
  const [noteOp, setNoteOp] = useState('')
  const [erreur, setErreur] = useState('')

  const clientDuCompte = (c: CompteEpargne) => data.clients.find((x) => x.id === c.clientId)

  const comptesFiltres = useMemo(() => {
    const q = recherche.trim().toLowerCase()
    return data.comptes
      .filter((c) => {
        const client = clientDuCompte(c)
        return (
          !q ||
          c.numero.toLowerCase().includes(q) ||
          (client && `${client.prenom} ${client.nom} ${client.codeClient}`.toLowerCase().includes(q))
        )
      })
      .sort((a, b) => b.solde - a.solde)
  }, [data.comptes, data.clients, recherche])

  const clientsSansCompte = data.clients.filter(
    (c) => c.actif && !data.comptes.some((k) => k.clientId === c.id),
  )

  const totalEpargne = data.comptes.reduce((s, c) => s + c.solde, 0)

  const validerOperation = (e: React.FormEvent) => {
    e.preventDefault()
    if (!operation) return
    const montant = Number(montantOp)
    if (operation.type === 'depot') {
      deposerEpargne(operation.compte.id, montant, noteOp.trim() || undefined)
    } else {
      const ok = retirerEpargne(operation.compte.id, montant, noteOp.trim() || undefined)
      if (!ok) {
        setErreur('Solde insuffisant pour ce retrait.')
        return
      }
    }
    setOperation(null)
    setMontantOp('')
    setNoteOp('')
    setErreur('')
  }

  const derniersMouvements = (compteId: string) =>
    data.mouvements
      .filter((m) => m.compteId === compteId)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 3)

  return (
    <div>
      <EnTetePage
        titre="Épargne"
        sousTitre={`${data.comptes.length} comptes — encours total : ${formatMontant(totalEpargne)}`}
        action={
          <button className="btn-primary" onClick={() => setModaleOuverture(true)} disabled={clientsSansCompte.length === 0}>
            <Plus className="h-4 w-4" />
            Ouvrir un compte
          </button>
        }
      />

      <div className="relative mb-6 max-w-md">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          className="input pl-10"
          placeholder="Rechercher un titulaire ou un n° de compte…"
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
        />
      </div>

      {comptesFiltres.length === 0 ? (
        <EtatVide titre="Aucun compte d'épargne" description="Ouvrez un compte pour un client." />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {comptesFiltres.map((c) => {
            const client = clientDuCompte(c)
            if (!client) return null
            return (
              <div key={c.id} className="card">
                <div className="flex items-center gap-3">
                  <Avatar nom={client.nom} prenom={client.prenom} taille="lg" />
                  <div className="min-w-0 flex-1">
                    <Link to={`/clients/${client.id}`} className="truncate font-semibold text-slate-900 hover:text-brand-700">
                      {client.prenom} {client.nom}
                    </Link>
                    <p className="text-xs text-slate-500">
                      <span className="font-mono font-semibold text-brand-700">{c.numero}</span> — ouvert le{' '}
                      {formatDate(c.dateOuverture)}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-slate-500">Solde</div>
                    <div className="text-lg font-bold text-brand-700">{formatMontant(c.solde)}</div>
                  </div>
                </div>

                <div className="mt-3 space-y-1 border-t border-slate-100 pt-3">
                  {derniersMouvements(c.id).map((mv) => (
                    <div key={mv.id} className="flex items-center justify-between text-xs">
                      <span className="text-slate-500">
                        {mv.type === 'depot' ? 'Dépôt' : 'Retrait'} — {formatDate(mv.date)}
                      </span>
                      <span className={mv.type === 'depot' ? 'font-semibold text-emerald-600' : 'font-semibold text-rose-600'}>
                        {mv.type === 'depot' ? '+' : '-'}
                        {formatMontant(mv.montant)}
                      </span>
                    </div>
                  ))}
                  {derniersMouvements(c.id).length === 0 && (
                    <p className="text-xs text-slate-400">Aucun mouvement pour l'instant.</p>
                  )}
                </div>

                <div className="mt-4 flex gap-2">
                  <button
                    className="btn-primary flex-1 !py-2 text-xs"
                    onClick={() => {
                      setOperation({ compte: c, type: 'depot' })
                      setErreur('')
                    }}
                  >
                    <ArrowDownToLine className="h-4 w-4" />
                    Dépôt
                  </button>
                  <button
                    className="btn-secondary flex-1 !py-2 text-xs"
                    onClick={() => {
                      setOperation({ compte: c, type: 'retrait' })
                      setErreur('')
                    }}
                  >
                    <ArrowUpFromLine className="h-4 w-4" />
                    Retrait
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Ouverture de compte */}
      <Modale titre="Ouvrir un compte d'épargne" ouverte={modaleOuverture} onFermer={() => setModaleOuverture(false)}>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (clientPourCompte) {
              ouvrirCompte(clientPourCompte)
              setModaleOuverture(false)
              setClientPourCompte('')
            }
          }}
          className="space-y-4"
        >
          <div>
            <label className="label">Client titulaire *</label>
            <select className="input" required value={clientPourCompte} onChange={(e) => setClientPourCompte(e.target.value)}>
              <option value="">— Choisir un client —</option>
              {clientsSansCompte.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.codeClient} — {c.prenom} {c.nom}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setModaleOuverture(false)}>
              Annuler
            </button>
            <button type="submit" className="btn-primary">
              <PiggyBank className="h-4 w-4" />
              Ouvrir le compte
            </button>
          </div>
        </form>
      </Modale>

      {/* Dépôt / retrait */}
      <Modale
        titre={
          operation
            ? `${operation.type === 'depot' ? 'Dépôt sur' : 'Retrait du'} ${operation.compte.numero} — ${clientDuCompte(operation.compte)?.prenom ?? ''} ${clientDuCompte(operation.compte)?.nom ?? ''}`
            : ''
        }
        ouverte={operation !== null}
        onFermer={() => setOperation(null)}
      >
        {operation && (
          <form onSubmit={validerOperation} className="space-y-4">
            <div className="rounded-xl bg-slate-50 p-3 text-sm">
              Solde actuel : <span className="font-bold">{formatMontant(operation.compte.solde)}</span>
            </div>
            <div>
              <label className="label">Montant (FCFA) *</label>
              <input
                className="input"
                type="number"
                min={1}
                max={operation.type === 'retrait' ? operation.compte.solde : undefined}
                required
                autoFocus
                value={montantOp}
                onChange={(e) => setMontantOp(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Note</label>
              <input className="input" value={noteOp} onChange={(e) => setNoteOp(e.target.value)} placeholder="Facultatif" />
            </div>
            {erreur && <p className="text-sm font-medium text-rose-600">{erreur}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setOperation(null)}>
                Annuler
              </button>
              <button type="submit" className="btn-primary">
                Valider {operation.type === 'depot' ? 'le dépôt' : 'le retrait'}
              </button>
            </div>
          </form>
        )}
      </Modale>
    </div>
  )
}
