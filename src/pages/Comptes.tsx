import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Clock,
  Lock,
  LockOpen,
  Plus,
  Search,
  Wallet,
} from 'lucide-react'
import { useStore } from '../store'
import { DELAI_RETRAIT_EPARGNE_H, type Compte, type TypeCompte } from '../types'
import { formatDate, formatDateHeure, formatMontant } from '../utils'
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

type Operation = { compte: Compte; type: 'depot' | 'retrait' | 'demande' }

export default function Comptes() {
  const {
    data,
    aDroit,
    estCaissier,
    ouvrirCompte,
    deposerCompte,
    retirerCompte,
    demanderRetrait,
    executerDemandeRetrait,
    annulerDemandeRetrait,
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
  const [erreurDemandes, setErreurDemandes] = useState('')
  const { confirmer } = useConfirmation()

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

  const demandesEnAttente = useMemo(
    () =>
      data.demandesRetrait
        .filter((dr) => dr.statut === 'en_attente')
        .sort((a, b) => a.dateExecutable.localeCompare(b.dateExecutable)),
    [data.demandesRetrait],
  )

  const validerOperation = (e: React.FormEvent) => {
    e.preventDefault()
    if (!operation) return
    const montant = Number(montantOp)
    const note = noteOp.trim() || undefined
    let resultat: string | null = null
    if (operation.type === 'depot') resultat = deposerCompte(operation.compte.id, montant, note)
    else if (operation.type === 'retrait') resultat = retirerCompte(operation.compte.id, montant, note)
    else resultat = demanderRetrait(operation.compte.id, montant, note)
    if (resultat) {
      setErreur(resultat)
      return
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

  const titreOperation = (o: Operation) => {
    const client = clientDuCompte(o.compte)
    const nom = client ? `${client.prenom} ${client.nom}` : ''
    if (o.type === 'depot') return `Dépôt sur ${o.compte.numero} — ${nom}`
    if (o.type === 'retrait') return `Retrait du ${o.compte.numero} — ${nom}`
    return `Demande de retrait — ${o.compte.numero} — ${nom}`
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

      {/* Demandes de retrait épargne (préavis 48h) */}
      {demandesEnAttente.length > 0 && (
        <div className="card mb-6">
          <h3 className="mb-1 font-semibold text-slate-900">
            Demandes de retrait épargne ({demandesEnAttente.length})
          </h3>
          <p className="mb-4 text-xs text-slate-500">
            Le client doit prévenir la microfinance {DELAI_RETRAIT_EPARGNE_H}h avant d'effectuer un retrait sur
            son compte épargne.
          </p>
          <div className="space-y-2">
            {demandesEnAttente.map((dr) => {
              const compte = data.comptes.find((c) => c.id === dr.compteId)
              const client = compte ? clientDuCompte(compte) : undefined
              if (!compte || !client) return null
              const executable = Date.now() >= new Date(dr.dateExecutable).getTime()
              const heuresRestantes = Math.max(
                0,
                Math.ceil((new Date(dr.dateExecutable).getTime() - Date.now()) / 3600000),
              )
              return (
                <div
                  key={dr.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3"
                >
                  <div className="flex items-center gap-3">
                    <Avatar nom={client.nom} prenom={client.prenom} />
                    <div>
                      <div className="text-sm font-semibold text-slate-900">
                        {client.prenom} {client.nom}{' '}
                        <span className="font-mono text-xs text-brand-700">{compte.numero}</span>
                      </div>
                      <div className="text-xs text-slate-500">
                        {formatMontant(dr.montant)} — demandé le {formatDateHeure(dr.dateDemande)}
                        {dr.note ? ` (${dr.note})` : ''}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {executable ? (
                      <span className="badge bg-emerald-100 text-emerald-700">Préavis écoulé</span>
                    ) : (
                      <span className="badge bg-amber-100 text-amber-700">
                        <Clock className="mr-1 h-3 w-3" />
                        Encore {heuresRestantes}h
                      </span>
                    )}
                    {peutOperer && (
                      <>
                        <button
                          className="btn-primary !py-1.5 text-xs"
                          disabled={!executable}
                          title={executable ? undefined : `Exécutable le ${formatDateHeure(dr.dateExecutable)}`}
                          onClick={() => {
                            const resultat = executerDemandeRetrait(dr.id)
                            setErreurDemandes(resultat ?? '')
                          }}
                        >
                          <ArrowUpFromLine className="h-3.5 w-3.5" />
                          Exécuter le retrait
                        </button>
                        <button
                          className="btn-secondary !py-1.5 text-xs"
                          onClick={async () => {
                            const ok = await confirmer({
                              titre: 'Annuler la demande de retrait',
                              message: `Annuler la demande de retrait de ${formatMontant(dr.montant)} de ${client.prenom} ${client.nom} sur le compte ${compte.numero} ?`,
                              labelValider: 'Annuler la demande',
                              danger: true,
                            })
                            if (ok) annulerDemandeRetrait(dr.id)
                          }}
                        >
                          Annuler
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          {erreurDemandes && <p className="mt-3 text-sm font-medium text-rose-600">{erreurDemandes}</p>}
        </div>
      )}

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
        <div className="flex gap-2">
          {filtres.map((f) => (
            <button
              key={f.valeur}
              onClick={() => setTypeFiltre(f.valeur)}
              className={`rounded-xl px-3.5 py-2 text-sm font-medium transition ${
                typeFiltre === f.valeur
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
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
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {comptesFiltres.map((c) => {
            const client = clientDuCompte(c)
            if (!client) return null
            return (
              <div key={c.id} className={`card ${c.verrouille ? 'opacity-90 ring-2 ring-rose-200' : ''}`}>
                <div className="flex items-center gap-3">
                  <Avatar nom={client.nom} prenom={client.prenom} taille="lg" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link to={`/clients/${client.id}`} className="truncate font-semibold text-slate-900 hover:text-brand-700">
                        {client.prenom} {client.nom}
                      </Link>
                      <span className={`badge ${STYLES_COMPTE[c.type]}`}>{LIBELLES_COMPTE[c.type]}</span>
                      {c.verrouille && (
                        <span className="badge bg-rose-100 text-rose-700">
                          <Lock className="mr-1 h-3 w-3" />
                          Verrouillé
                        </span>
                      )}
                    </div>
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
                        title={
                          c.type === 'epargne'
                            ? `Retrait soumis à un préavis de ${DELAI_RETRAIT_EPARGNE_H}h`
                            : undefined
                        }
                        onClick={() => {
                          setOperation({ compte: c, type: c.type === 'courant' ? 'retrait' : 'demande' })
                          setErreur('')
                        }}
                      >
                        {c.type === 'courant' ? (
                          <>
                            <ArrowUpFromLine className="h-4 w-4" />
                            Retrait
                          </>
                        ) : (
                          <>
                            <Clock className="h-4 w-4" />
                            Demande de retrait
                          </>
                        )}
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

      {/* Ouverture de compte */}
      <Modale titre="Ouvrir un compte" ouverte={modaleOuverture} onFermer={() => setModaleOuverture(false)}>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (clientPourCompte) {
              const err = ouvrirCompte(clientPourCompte, typeNouveauCompte)
              if (err) {
                setErreur(err)
                return
              }
              setModaleOuverture(false)
              setClientPourCompte('')
              setErreur('')
            }
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
              <option value="courant">Compte courant — dépôts et retraits libres (n° Bxxxx)</option>
              <option value="epargne">Compte épargne — retrait avec préavis de {DELAI_RETRAIT_EPARGNE_H}h (n° Bxxxx)</option>
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

      {/* Dépôt / retrait / demande de retrait */}
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
            {operation.type === 'demande' && (
              <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
                Compte épargne : le retrait ne pourra être exécuté que {DELAI_RETRAIT_EPARGNE_H}h après la
                demande.
              </div>
            )}
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
                {operation.type === 'depot'
                  ? 'Valider le dépôt'
                  : operation.type === 'retrait'
                    ? 'Valider le retrait'
                    : 'Enregistrer la demande'}
              </button>
            </div>
          </form>
        )}
      </Modale>
    </div>
  )
}
