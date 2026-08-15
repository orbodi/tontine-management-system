import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Lock,
  LockOpen,
  Plus,
  Search,
  Wallet,
} from 'lucide-react'
import { useStore } from '../store'
import { type Compte, type TypeCompte } from '../types'
import { formatDate, formatMontant } from '../utils'
import { Avatar, EnTetePage, EtatVide, Modale } from '../components/ui'
import { useConfirmation } from '../components/Confirmation'

const LIBELLES_COMPTE: Record<TypeCompte, string> = {
  courant: 'Compte courant',
  epargne: 'Compte épargne',
}

const STYLES_COMPTE: Record<TypeCompte, string> = {
  courant: 'bg-sky-100 text-sky-700',
  epargne: 'bg-emerald-100 text-emerald-700',
}

type Operation = { compte: Compte; type: 'depot' | 'retrait' }

export default function Comptes() {
  const {
    data,
    aDroit,
    estCaissier,
    ouvrirCompte,
    deposerCompte,
    retirerCompte,
    basculerVerrouCompte,
  } = useStore()
  const [recherche, setRecherche] = useState('')
  const [typeFiltre, setTypeFiltre] = useState<'tous' | TypeCompte>('tous')
  const [modaleOuverture, setModaleOuverture] = useState(false)
  const [clientPourCompte, setClientPourCompte] = useState('')
  const [typeNouveauCompte, setTypeNouveauCompte] = useState<TypeCompte>('courant')
  const [operation, setOperation] = useState<Operation | null>(null)
  const [montantOp, setMontantOp] = useState('')
  const [noteOp, setNoteOp] = useState('')
  const [erreur, setErreur] = useState('')
  const { confirmer, alerter } = useConfirmation()
  const peutOperer = aDroit('operer_comptes')
  const peutVerrouiller = aDroit('verrouiller_comptes')

  const clientDuCompte = (c: Compte) => data.clients.find((x) => x.id === c.clientId)

  const comptesFiltres = useMemo(() => {
    const q = recherche.trim().toLowerCase()
    return data.comptes
      .filter((c) => typeFiltre === 'tous' || c.type === typeFiltre)
      .filter((c) => {
        const client = clientDuCompte(c)
        return (
          !q ||
          c.numero.toLowerCase().includes(q) ||
          (client && `${client.prenom} ${client.nom} ${client.codeClient}`.toLowerCase().includes(q))
        )
      })
      .sort((a, b) => b.solde - a.solde)
  }, [data.comptes, data.clients, recherche, typeFiltre])

  const clientsSansCeType = (type: TypeCompte) =>
    data.clients.filter((c) => c.actif && !data.comptes.some((k) => k.clientId === c.id && k.type === type))

  const totalCourant = data.comptes.filter((c) => c.type === 'courant').reduce((s, c) => s + c.solde, 0)
  const totalEpargne = data.comptes.filter((c) => c.type === 'epargne').reduce((s, c) => s + c.solde, 0)

  const validerOperation = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!operation) return
    const { compte, type } = operation
    const montant = Number(montantOp)
    const note = noteOp.trim() || undefined
    const client = clientDuCompte(compte)
    const resultat =
      type === 'depot' ? deposerCompte(compte.id, montant, note) : retirerCompte(compte.id, montant, note)

    setOperation(null)
    setMontantOp('')
    setNoteOp('')
    setErreur('')

    if (resultat) {
      await alerter(type === 'depot' ? 'Dépôt échoué' : 'Retrait échoué', resultat)
      return
    }

    const typeCompte = LIBELLES_COMPTE[compte.type].toLowerCase()
    await alerter(
      type === 'depot' ? 'Dépôt effectué' : 'Retrait effectué',
      `Le ${type === 'depot' ? 'dépôt' : 'retrait'} de ${formatMontant(montant)} a été enregistré avec succès` +
        (client ? ` pour ${client.prenom} ${client.nom}` : '') +
        ` (${typeCompte} ${compte.numero}).`,
    )
  }

  const derniersMouvements = (compteId: string) =>
    data.mouvements
      .filter((m) => m.compteId === compteId)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 3)

  const titreOperation = (o: Operation) => {
    const client = clientDuCompte(o.compte)
    const nom = client ? `${client.prenom} ${client.nom}` : ''
    if (o.type === 'depot') return `Dépôt sur ${o.compte.numero} — ${nom}`
    return `Retrait du ${o.compte.numero} — ${nom}`
  }

  const filtres: { valeur: 'tous' | TypeCompte; label: string }[] = [
    { valeur: 'tous', label: 'Tous' },
    { valeur: 'courant', label: 'Courants' },
    { valeur: 'epargne', label: 'Épargne' },
  ]

  return (
    <div>
      <EnTetePage
        titre="Comptes"
        sousTitre={`${data.comptes.length} comptes — courant : ${formatMontant(totalCourant)} — épargne : ${formatMontant(totalEpargne)}`}
        action={
          peutOperer && !estCaissier && (
            <button className="btn-primary" onClick={() => setModaleOuverture(true)}>
              <Plus className="h-4 w-4" />
              Ouvrir un compte
            </button>
          )
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="relative max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-10"
            placeholder="Rechercher un titulaire ou un n° de compte…"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
          />
        </div>
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
          {filtres.map((f) => (
            <button
              key={f.valeur}
              onClick={() => setTypeFiltre(f.valeur)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                typeFiltre === f.valeur ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {comptesFiltres.length === 0 ? (
        <EtatVide titre="Aucun compte" description="Ouvrez un compte courant ou épargne pour un client." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {comptesFiltres.map((c) => {
            const client = clientDuCompte(c)
            if (!client) return null
            return (
              <div key={c.id} className={`card ${c.verrouille ? 'opacity-90 ring-2 ring-rose-200' : ''}`}>
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <Avatar nom={client.nom} prenom={client.prenom} />
                    <div>
                      <Link to={`/clients/${client.id}`} className="font-semibold text-slate-900 hover:text-brand-700">
                        {client.prenom} {client.nom}
                      </Link>
                      <div className="font-mono text-xs text-brand-700">{c.numero}</div>
                    </div>
                  </div>
                  <span className={`badge ${STYLES_COMPTE[c.type]}`}>{LIBELLES_COMPTE[c.type]}</span>
                </div>

                {c.verrouille && (
                  <div className="mb-3 flex items-center gap-1.5 rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700">
                    <Lock className="h-3.5 w-3.5" />
                    Compte verrouillé
                  </div>
                )}

                <div className="mb-3 rounded-xl bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">Solde</div>
                  <div className="text-xl font-bold text-slate-900">{formatMontant(c.solde)}</div>
                  <div className="mt-1 text-xs text-slate-400">Ouvert le {formatDate(c.dateOuverture)}</div>
                </div>

                <div className="space-y-1.5">
                  {derniersMouvements(c.id).map((mv) => (
                    <div key={mv.id} className="flex items-center justify-between text-xs">
                      <span className="text-slate-500">{formatDate(mv.date)}</span>
                      <span className={mv.type === 'depot' ? 'font-medium text-emerald-600' : 'font-medium text-rose-600'}>
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
                  {peutOperer && (
                    <>
                      <button
                        className="btn-primary flex-1 !py-2 text-xs"
                        disabled={c.verrouille}
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
                        disabled={c.verrouille}
                        onClick={() => {
                          setOperation({ compte: c, type: 'retrait' })
                          setErreur('')
                        }}
                      >
                        <ArrowUpFromLine className="h-4 w-4" />
                        Retrait
                      </button>
                    </>
                  )}
                  {peutVerrouiller && (
                    <button
                      className="btn-secondary !px-3 !py-2 text-xs"
                      title={c.verrouille ? 'Déverrouiller le compte' : 'Verrouiller le compte'}
                      onClick={async () => {
                        const ok = await confirmer({
                          titre: c.verrouille ? 'Déverrouiller le compte' : 'Verrouiller le compte',
                          message: c.verrouille
                            ? `Déverrouiller le compte ${c.numero} de ${client.prenom} ${client.nom} ? Les opérations seront de nouveau possibles.`
                            : `Verrouiller le compte ${c.numero} de ${client.prenom} ${client.nom} ? Toute opération sera bloquée.`,
                          labelValider: c.verrouille ? 'Déverrouiller' : 'Verrouiller',
                          danger: !c.verrouille,
                        })
                        if (ok) basculerVerrouCompte(c.id)
                      }}
                    >
                      {c.verrouille ? <LockOpen className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Modale titre="Ouvrir un compte" ouverte={modaleOuverture} onFermer={() => setModaleOuverture(false)}>
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            if (!clientPourCompte) return
            const resultat = ouvrirCompte(clientPourCompte, typeNouveauCompte)
            if ('erreur' in resultat) {
              setErreur(resultat.erreur)
              await alerter('Ouverture impossible', resultat.erreur)
              return
            }
            setModaleOuverture(false)
            setClientPourCompte('')
            setErreur('')
            await alerter('Compte ouvert', `Le compte ${resultat.numero} a été ouvert avec succès.`)
          }}
          className="space-y-4"
        >
          <div>
            <label className="label">Type de compte *</label>
            <select
              className="input"
              value={typeNouveauCompte}
              onChange={(e) => {
                setTypeNouveauCompte(e.target.value as TypeCompte)
                setClientPourCompte('')
              }}
            >
              <option value="courant">Compte courant — dépôts et retraits (n° Bxxxx)</option>
              <option value="epargne">Compte épargne — dépôts et retraits (n° Bxxxx)</option>
            </select>
          </div>
          <div>
            <label className="label">Client titulaire *</label>
            <select className="input" required value={clientPourCompte} onChange={(e) => setClientPourCompte(e.target.value)}>
              <option value="">— Choisir un client —</option>
              {clientsSansCeType(typeNouveauCompte).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.codeClient} — {c.prenom} {c.nom}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-400">
              Seuls les clients sans {LIBELLES_COMPTE[typeNouveauCompte].toLowerCase()} sont proposés.
            </p>
          </div>
          {erreur && <p className="text-sm font-medium text-rose-600">{erreur}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setModaleOuverture(false)}>
              Annuler
            </button>
            <button type="submit" className="btn-primary">
              <Wallet className="h-4 w-4" />
              Ouvrir le compte
            </button>
          </div>
        </form>
      </Modale>

      <Modale
        titre={operation ? titreOperation(operation) : ''}
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
                max={operation.type === 'depot' ? undefined : operation.compte.solde}
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
                {operation.type === 'depot' ? 'Valider le dépôt' : 'Valider le retrait'}
              </button>
            </div>
          </form>
        )}
      </Modale>
    </div>
  )
}
