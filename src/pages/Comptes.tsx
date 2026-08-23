import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Lock,
  LockOpen,
  Plus,
  Printer,
  Search,
  Wallet,
} from 'lucide-react'
import { useStore } from '../store'
import { type Compte, type TypeCompte } from '../types'
import { formatDate, formatDateHeure, formatMontant } from '../utils'
import { Avatar, EnTetePage, EtatVide, Modale } from '../components/ui'
import {
  FicheOperationCompteDouble,
  type DonneesFicheOperationCompte,
} from '../components/FicheOperationCompte'
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
    employeConnecte,
    ouvrirCompte,
    validerOuvertureCompte,
    refuserOuvertureCompte,
    deposerCompte,
    retirerCompte,
    basculerVerrouCompte,
  } = useStore()
  const [recherche, setRecherche] = useState('')
  const [typeFiltre, setTypeFiltre] = useState<'tous' | TypeCompte>('tous')
  const [modaleOuverture, setModaleOuverture] = useState(false)
  const [clientPourCompte, setClientPourCompte] = useState('')
  const [caissierPourCompte, setCaissierPourCompte] = useState('')
  const [typeNouveauCompte, setTypeNouveauCompte] = useState<TypeCompte>('courant')
  const [promoCompte, setPromoCompte] = useState(false)
  const [fraisCompte, setFraisCompte] = useState({
    partSociale: 5000,
    droitAdhesion: 2500,
    droitAdhesionPromo: 500,
  })
  const [operation, setOperation] = useState<Operation | null>(null)
  const [montantOp, setMontantOp] = useState('')
  const [noteOp, setNoteOp] = useState('')
  const [erreur, setErreur] = useState('')
  const [fiche, setFiche] = useState<DonneesFicheOperationCompte | null>(null)
  const { confirmer, alerter } = useConfirmation()
  const peutOperer = aDroit('operer_comptes')
  const peutVerrouiller = aDroit('verrouiller_comptes')

  useEffect(() => {
    void (async () => {
      try {
        const { apiFetch } = await import('../api/client')
        const p = await apiFetch<{
          partSociale: number
          droitAdhesion: number
          droitAdhesionPromo: number
        }>('/api/parametres/ouverture-compte')
        setFraisCompte(p)
      } catch {
        /* défauts */
      }
    })()
  }, [])

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

  const clientsActifs = () => data.clients.filter((c) => c.actif)

  const caissiersDisponibles = useMemo(() => {
    const client = data.clients.find((c) => c.id === clientPourCompte)
    return data.employes
      .filter((e) => e.actif && (e.role === 'caissier' || e.role === 'chef_agence'))
      .filter((e) => !client?.agenceId || e.agenceId === client.agenceId)
      .sort((a, b) => a.nomComplet.localeCompare(b.nomComplet))
  }, [data.employes, data.clients, clientPourCompte])

  const demandesEnAttente = useMemo(
    () =>
      (data.demandesOuvertureCompte ?? [])
        .filter((d) => d.statut === 'en_attente')
        .sort((a, b) => b.dateDemande.localeCompare(a.dateDemande)),
    [data.demandesOuvertureCompte],
  )

  const totalCourant = data.comptes.filter((c) => c.type === 'courant').reduce((s, c) => s + c.solde, 0)
  const totalEpargne = data.comptes.filter((c) => c.type === 'epargne').reduce((s, c) => s + c.solde, 0)

  const validerOperation = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!operation) return
    const { compte, type } = operation
    const montant = Number(montantOp)
    const note = noteOp.trim() || undefined
    const client = clientDuCompte(compte)
    const soldeAvant = compte.solde
    const resultat =
      type === 'depot'
        ? await deposerCompte(compte.id, montant, note)
        : await retirerCompte(compte.id, montant, note)

    setOperation(null)
    setMontantOp('')
    setNoteOp('')
    setErreur('')

    if (resultat) {
      await alerter(type === 'depot' ? 'Dépôt échoué' : 'Retrait échoué', resultat)
      return
    }

    const soldeApres = type === 'depot' ? soldeAvant + montant : soldeAvant - montant
    const agence = client ? data.agences.find((a) => a.id === client.agenceId) : undefined
    const date = new Date().toISOString()

    setFiche({
      type,
      montant,
      note,
      date,
      numeroCompte: compte.numero,
      typeCompte: compte.type,
      soldeAvant,
      soldeApres,
      clientNom: client ? `${client.prenom} ${client.nom}` : '—',
      clientCode: client?.codeClient ?? '—',
      clientTelephone: client?.telephone,
      caissierNom: employeConnecte?.nomComplet ?? '—',
      agenceNom: agence ? `${agence.code} — ${agence.nom}` : undefined,
      reference: `${type === 'depot' ? 'DEP' : 'RET'}-${compte.numero}-${date.slice(0, 10).replace(/-/g, '')}`,
    })
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
      <div className={fiche ? 'print:hidden' : undefined}>
        <EnTetePage
          titre="Comptes"
          sousTitre={`${data.comptes.length} comptes — courant : ${formatMontant(totalCourant)} — épargne : ${formatMontant(totalEpargne)}`}
          action={
            peutOperer &&
            !estCaissier && (
              <button
                className="btn-primary"
                onClick={() => {
                  setErreur('')
                  setClientPourCompte('')
                  setCaissierPourCompte('')
                  setPromoCompte(false)
                  setTypeNouveauCompte('courant')
                  setModaleOuverture(true)
                }}
              >
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
                  typeFiltre === f.valeur
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {demandesEnAttente.length > 0 && !estCaissier && (
          <div className="card mb-6 border-amber-200 bg-amber-50/50">
            <h3 className="mb-3 font-semibold text-slate-900">
              Ouvertures en attente de validation caisse ({demandesEnAttente.length})
            </h3>
            <div className="space-y-2">
              {demandesEnAttente.map((d) => {
                const client = data.clients.find((c) => c.id === d.clientId)
                const caissier = data.employes.find((e) => e.id === d.caissierId)
                const estAssigne = employeConnecte?.id === d.caissierId
                return (
                  <div
                    key={d.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-amber-100"
                  >
                    <div>
                      <p className="font-medium text-slate-900">
                        {client ? `${client.prenom} ${client.nom}` : 'Client'} —{' '}
                        {LIBELLES_COMPTE[d.type]}
                        {d.promotion ? ' (promo)' : ''}
                      </p>
                      <p className="text-xs text-slate-500">
                        Caisse : {caissier?.nomComplet ?? '—'} — total{' '}
                        {formatMontant(d.partSociale + d.droitAdhesion)} —{' '}
                        {formatDateHeure(d.dateDemande)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {estAssigne && (
                        <button
                          type="button"
                          className="btn-primary !py-1.5 text-xs"
                          onClick={async () => {
                            const total = d.partSociale + d.droitAdhesion
                            const ok = await confirmer({
                              titre: 'Valider l’ouverture',
                              message: `Confirmez l’encaissement de ${formatMontant(total)}. Le compte sera créé.`,
                              labelValider: 'Valider et créer',
                            })
                            if (!ok) return
                            const err = await validerOuvertureCompte(d.id)
                            if (err) await alerter('Validation impossible', err)
                            else
                              await alerter(
                                'Compte ouvert',
                                `Compte créé. Total encaissé : ${formatMontant(total)}.`,
                              )
                          }}
                        >
                          Valider
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn-secondary !py-1.5 text-xs"
                        onClick={async () => {
                          const ok = await confirmer({
                            titre: estAssigne ? 'Refuser la demande' : 'Annuler la demande',
                            message: estAssigne
                              ? 'Refuser cette demande d’ouverture ?'
                              : 'Refuser / annuler cette demande d’ouverture ?',
                            labelValider: estAssigne ? 'Refuser' : 'Annuler la demande',
                            danger: true,
                          })
                          if (!ok) return
                          const err = await refuserOuvertureCompte(
                            d.id,
                            estAssigne ? 'Refusée en caisse' : 'Annulée par le demandeur',
                          )
                          if (err) await alerter('Action impossible', err)
                        }}
                      >
                        {estAssigne ? 'Refuser' : 'Annuler'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {comptesFiltres.length === 0 ? (
          <EtatVide
            titre="Aucun compte"
            description="Ouvrez un compte courant ou épargne pour un client."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {comptesFiltres.map((c) => {
              const client = clientDuCompte(c)
              if (!client) return null
              return (
                <div
                  key={c.id}
                  className={`card ${c.verrouille ? 'opacity-90 ring-2 ring-rose-200' : ''}`}
                >
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <Avatar nom={client.nom} prenom={client.prenom} />
                      <div>
                        <Link
                          to={`/clients/${client.id}`}
                          className="font-semibold text-slate-900 hover:text-brand-700"
                        >
                          {client.prenom} {client.nom}
                        </Link>
                        <div className="font-mono text-xs text-brand-700">{c.numero}</div>
                      </div>
                    </div>
                    <span className={`badge ${STYLES_COMPTE[c.type]}`}>
                      {LIBELLES_COMPTE[c.type]}
                    </span>
                  </div>

                  {c.verrouille && (
                    <div className="mb-3 flex items-center gap-1.5 rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700">
                      <Lock className="h-3.5 w-3.5" />
                      Compte verrouillé
                    </div>
                  )}

                  <div className="mb-3 rounded-xl bg-slate-50 p-3">
                    <div className="text-xs text-slate-500">Solde</div>
                    <div className="text-xl font-bold text-slate-900">
                      {formatMontant(c.solde)}
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      Ouvert le {formatDate(c.dateOuverture)}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    {derniersMouvements(c.id).map((mv) => (
                      <div key={mv.id} className="flex items-center justify-between text-xs">
                        <span className="text-slate-500">{formatDate(mv.date)}</span>
                        <span
                          className={
                            mv.type === 'depot'
                              ? 'font-medium text-emerald-600'
                              : 'font-medium text-rose-600'
                          }
                        >
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
                            titre: c.verrouille
                              ? 'Déverrouiller le compte'
                              : 'Verrouiller le compte',
                            message: c.verrouille
                              ? `Déverrouiller le compte ${c.numero} de ${client.prenom} ${client.nom} ? Les opérations seront de nouveau possibles.`
                              : `Verrouiller le compte ${c.numero} de ${client.prenom} ${client.nom} ? Toute opération sera bloquée.`,
                            labelValider: c.verrouille ? 'Déverrouiller' : 'Verrouiller',
                            danger: !c.verrouille,
                          })
                          if (ok) await basculerVerrouCompte(c.id)
                        }}
                      >
                        {c.verrouille ? (
                          <LockOpen className="h-4 w-4" />
                        ) : (
                          <Lock className="h-4 w-4" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <Modale
          titre="Ouvrir un compte"
          ouverte={modaleOuverture}
          onFermer={() => setModaleOuverture(false)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              if (!clientPourCompte) return
              if (!caissierPourCompte) {
                setErreur('Indiquez la caisse qui encaissera part sociale et droit d’adhésion.')
                return
              }
              const resultat = await ouvrirCompte(
                clientPourCompte,
                typeNouveauCompte,
                promoCompte,
                caissierPourCompte,
              )
              if ('erreur' in resultat) {
                setErreur(resultat.erreur)
                await alerter('Demande impossible', resultat.erreur)
                return
              }
              const droit = promoCompte ? fraisCompte.droitAdhesionPromo : fraisCompte.droitAdhesion
              const caissier = data.employes.find((x) => x.id === caissierPourCompte)
              setModaleOuverture(false)
              setClientPourCompte('')
              setCaissierPourCompte('')
              setPromoCompte(false)
              setErreur('')
              await alerter(
                'Demande envoyée',
                `Demande d’ouverture enregistrée.\n` +
                  `Le compte sera créé après encaissement et validation par ${caissier?.nomComplet ?? 'le caissier'}.\n` +
                  `Part sociale : ${formatMontant(fraisCompte.partSociale)}\n` +
                  `Droit d'adhésion : ${formatMontant(droit)}\n` +
                  `Total à encaisser : ${formatMontant(fraisCompte.partSociale + droit)}`,
              )
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
              <select
                className="input"
                required
                value={clientPourCompte}
                onChange={(e) => {
                  setClientPourCompte(e.target.value)
                  setCaissierPourCompte('')
                }}
              >
                <option value="">— Choisir un client —</option>
                {clientsActifs().map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.codeClient} — {c.prenom} {c.nom}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-400">
                Frais dus à chaque ouverture (part sociale + droit d’adhésion), encaissés en caisse après
                validation.
              </p>
            </div>
            <div>
              <label className="label">Caisse (encaissement) *</label>
              <select
                className="input"
                required
                value={caissierPourCompte}
                onChange={(e) => setCaissierPourCompte(e.target.value)}
                disabled={!clientPourCompte}
              >
                <option value="">— Choisir le caissier —</option>
                {caissiersDisponibles.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nomComplet} ({e.role === 'chef_agence' ? 'chef agence' : 'caissier'})
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-400">
                Le compte n’est créé qu’après validation et encaissement par ce caissier.
              </p>
            </div>
            <label className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={promoCompte}
                onChange={(e) => setPromoCompte(e.target.checked)}
              />
              <span>
                <span className="font-medium text-slate-900">Promotion — droit d’adhésion réduit</span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  {formatMontant(fraisCompte.droitAdhesionPromo)} au lieu de{' '}
                  {formatMontant(fraisCompte.droitAdhesion)}
                </span>
              </span>
            </label>
            <div className="rounded-xl border border-slate-200 p-3 text-xs text-slate-700">
              <p>
                Part sociale (microfinance) : <strong>{formatMontant(fraisCompte.partSociale)}</strong>
              </p>
              <p>
                Droit d’adhésion (sur le compte) :{' '}
                <strong>
                  {formatMontant(promoCompte ? fraisCompte.droitAdhesionPromo : fraisCompte.droitAdhesion)}
                </strong>
              </p>
              <p className="mt-1 font-semibold">
                Total caisse :{' '}
                {formatMontant(
                  fraisCompte.partSociale +
                    (promoCompte ? fraisCompte.droitAdhesionPromo : fraisCompte.droitAdhesion),
                )}
              </p>
            </div>
            {erreur && <p className="text-sm font-medium text-rose-600">{erreur}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setModaleOuverture(false)}
              >
                Annuler
              </button>
              <button type="submit" className="btn-primary">
                <Wallet className="h-4 w-4" />
                Envoyer la demande
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
                Solde actuel :{' '}
                <span className="font-bold">{formatMontant(operation.compte.solde)}</span>
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
                <input
                  className="input"
                  value={noteOp}
                  onChange={(e) => setNoteOp(e.target.value)}
                  placeholder="Facultatif"
                />
              </div>
              {erreur && <p className="text-sm font-medium text-rose-600">{erreur}</p>}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setOperation(null)}
                >
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

      {fiche && (
        <div className="fiche-impression-racine fixed inset-0 z-[60] flex flex-col bg-slate-900/50 p-4 print:static print:inset-auto print:z-auto print:block print:bg-white print:p-0">
          <div className="mx-auto flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl print:max-w-none print:overflow-visible print:rounded-none print:shadow-none">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 print:hidden">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Fiche {fiche.type === 'depot' ? 'de dépôt' : 'de retrait'}
                </h2>
                <p className="text-sm text-slate-500">
                  Opération enregistrée le {formatDateHeure(fiche.date)} — deux exemplaires sur une
                  page (à découper).
                </p>
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn-secondary" onClick={() => setFiche(null)}>
                  Fermer
                </button>
                <button type="button" className="btn-primary" onClick={() => window.print()}>
                  <Printer className="h-4 w-4" />
                  Imprimer
                </button>
              </div>
            </div>
            <div className="max-h-[80vh] overflow-y-auto p-4 print:max-h-none print:overflow-visible print:p-0">
              <FicheOperationCompteDouble data={fiche} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
