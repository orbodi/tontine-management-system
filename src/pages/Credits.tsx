import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, HandCoins, Plus, X } from 'lucide-react'
import { useStore } from '../store'
import type { Credit, StatutCredit } from '../types'
import { situationCredit } from '../metier'
import { formatDate, formatMontant, afficherNumeroClient } from '../utils'
import { Avatar, BadgeStatutCredit, EnTetePage, EtatVide, Modale } from '../components/ui'
import { useConfirmation } from '../components/Confirmation'

type Filtre = 'tous' | StatutCredit

export default function Credits() {
  const { data, aDroit, demanderCredit, approuverCredit, rejeterCredit, rembourserCredit } = useStore()
  const peutApprouverCredits = aDroit('approuver_credits')
  const { confirmer } = useConfirmation()
  const [filtre, setFiltre] = useState<Filtre>('tous')
  const [modaleDemande, setModaleDemande] = useState(false)
  const [clientChoisi, setClientChoisi] = useState('')
  const [montant, setMontant] = useState('')
  const [taux, setTaux] = useState('10')
  const [duree, setDuree] = useState('6')
  const [motif, setMotif] = useState('')
  const [creditARembourser, setCreditARembourser] = useState<Credit | null>(null)
  const [montantRemboursement, setMontantRemboursement] = useState('')

  const clientDuCredit = (c: Credit) => data.clients.find((x) => x.id === c.clientId)

  const creditsAffiches = useMemo(() => {
    return data.credits
      .filter((c) => filtre === 'tous' || c.statut === filtre)
      .sort((a, b) => b.dateDemande.localeCompare(a.dateDemande))
  }, [data.credits, filtre])

  const compteurs = useMemo(() => {
    const r: Record<Filtre, number> = {
      tous: data.credits.length,
      en_attente: 0,
      en_cours: 0,
      rembourse: 0,
      en_retard: 0,
      rejete: 0,
    }
    data.credits.forEach((c) => {
      r[c.statut]++
    })
    return r
  }, [data.credits])

  const soumettre = async (e: React.FormEvent) => {
    e.preventDefault()
    await demanderCredit({
      clientId: clientChoisi,
      montant: Number(montant),
      tauxInteret: Number(taux),
      dureeMois: Number(duree),
      motif: motif.trim() || undefined,
    })
    setModaleDemande(false)
    setClientChoisi('')
    setMontant('')
    setTaux('10')
    setDuree('6')
    setMotif('')
  }

  const validerRemboursement = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!creditARembourser) return
    await rembourserCredit(creditARembourser.id, Number(montantRemboursement))
    setCreditARembourser(null)
    setMontantRemboursement('')
  }

  const filtres: { valeur: Filtre; label: string }[] = [
    { valeur: 'tous', label: 'Tous' },
    { valeur: 'en_attente', label: 'En attente' },
    { valeur: 'en_cours', label: 'En cours' },
    { valeur: 'en_retard', label: 'En retard' },
    { valeur: 'rembourse', label: 'Remboursés' },
    { valeur: 'rejete', label: 'Rejetés' },
  ]

  return (
    <div>
      <EnTetePage
        titre="Crédits"
        sousTitre="Demandes, approbations et remboursements"
        action={
          <button className="btn-primary" onClick={() => setModaleDemande(true)}>
            <Plus className="h-4 w-4" />
            Nouvelle demande
          </button>
        }
      />

      <div className="mb-6 flex flex-wrap gap-2">
        {filtres.map((f) => (
          <button
            key={f.valeur}
            onClick={() => setFiltre(f.valeur)}
            className={`rounded-xl px-3.5 py-2 text-sm font-medium transition ${
              filtre === f.valeur
                ? 'bg-brand-600 text-white shadow-sm'
                : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
            }`}
          >
            {f.label}
            <span className={`ml-1.5 ${filtre === f.valeur ? 'text-brand-200' : 'text-slate-400'}`}>
              {compteurs[f.valeur]}
            </span>
          </button>
        ))}
      </div>

      {creditsAffiches.length === 0 ? (
        <EtatVide titre="Aucun crédit dans cette catégorie" />
      ) : (
        <div className="space-y-4">
          {creditsAffiches.map((credit) => {
            const client = clientDuCredit(credit)
            if (!client) return null
            const sit = situationCredit(credit, data.remboursements)
            const actif = credit.statut === 'en_cours' || credit.statut === 'en_retard'
            return (
              <div key={credit.id} className="card">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <Avatar nom={client.nom} prenom={client.prenom} taille="lg" />
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Link to={`/clients/${client.id}`} className="font-semibold text-slate-900 hover:text-brand-700">
                          {client.prenom} {client.nom}
                        </Link>
                        <span className="font-mono text-xs font-semibold text-brand-700">{credit.numero}</span>
                        <BadgeStatutCredit statut={credit.statut} />
                      </div>
                      <p className="text-sm text-slate-500">
                        {formatMontant(credit.montant)} sur {credit.dureeMois} mois à {credit.tauxInteret} % —{' '}
                        {credit.motif ?? 'Sans motif'}
                      </p>
                      <p className="text-xs text-slate-400">
                        Demandé le {formatDate(credit.dateDemande)}
                        {credit.dateOctroi ? ` — octroyé le ${formatDate(credit.dateOctroi)}` : ''}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {credit.statut === 'en_attente' &&
                      (peutApprouverCredits ? (
                        <>
                          <button
                            className="btn-primary !py-2 text-xs"
                            onClick={async () => {
                              const ok = await confirmer({
                                titre: 'Approuver le crédit',
                                message: `Approuver le crédit ${credit.numero} de ${formatMontant(credit.montant)} pour ${client.prenom} ${client.nom} ?`,
                                labelValider: 'Approuver',
                              })
                              if (ok) await approuverCredit(credit.id)
                            }}
                          >
                            <Check className="h-4 w-4" />
                            Approuver
                          </button>
                          <button
                            className="btn-danger !py-2 text-xs"
                            onClick={async () => {
                              const ok = await confirmer({
                                titre: 'Rejeter la demande',
                                message: `Rejeter la demande de crédit ${credit.numero} de ${client.prenom} ${client.nom} ?`,
                                labelValider: 'Rejeter',
                                danger: true,
                              })
                              if (ok) await rejeterCredit(credit.id)
                            }}
                          >
                            <X className="h-4 w-4" />
                            Rejeter
                          </button>
                        </>
                      ) : (
                        <span className="text-xs italic text-slate-400">
                          Approbation réservée au chef d'agence
                        </span>
                      ))}
                    {actif && (
                      <button
                        className="btn-primary !py-2 text-xs"
                        onClick={() => {
                          setCreditARembourser(credit)
                          setMontantRemboursement(String(sit.mensualite))
                        }}
                      >
                        <HandCoins className="h-4 w-4" />
                        Encaisser un remboursement
                      </button>
                    )}
                  </div>
                </div>

                {(actif || credit.statut === 'rembourse') && (
                  <div className="mt-4 border-t border-slate-100 pt-3">
                    <div className="mb-1.5 flex flex-wrap justify-between gap-2 text-xs text-slate-500">
                      <span>
                        Mensualité : <span className="font-semibold text-slate-700">{formatMontant(sit.mensualite)}</span>
                        {' — '}échéances payées :{' '}
                        <span className="font-semibold text-slate-700">
                          {sit.echeancesPayees}/{credit.dureeMois}
                        </span>
                        {sit.enRetard && (
                          <span className="ml-1 font-semibold text-rose-600">
                            ({sit.echeancesAttendues - sit.echeancesPayees} en retard)
                          </span>
                        )}
                      </span>
                      <span>
                        Payé {formatMontant(sit.dejaPaye)} / {formatMontant(sit.totalDu)} — reste{' '}
                        <span className="font-semibold text-slate-700">{formatMontant(sit.resteAPayer)}</span>
                      </span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full transition-all ${sit.enRetard ? 'bg-rose-500' : 'bg-brand-500'}`}
                        style={{ width: `${Math.min(100, (sit.dejaPaye / sit.totalDu) * 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Nouvelle demande */}
      <Modale titre="Nouvelle demande de crédit" ouverte={modaleDemande} onFermer={() => setModaleDemande(false)}>
        <form onSubmit={soumettre} className="space-y-4">
          <div>
            <label className="label">Client *</label>
            <select className="input" required value={clientChoisi} onChange={(e) => setClientChoisi(e.target.value)}>
              <option value="">— Choisir un client —</option>
              {data.clients
                .filter((c) => c.actif)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {afficherNumeroClient(c.codeClient)} — {c.prenom} {c.nom}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label className="label">Montant (FCFA) *</label>
            <input className="input" type="number" min={1000} required value={montant} onChange={(e) => setMontant(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Taux d'intérêt (%) *</label>
              <input className="input" type="number" min={0} max={100} step="0.5" required value={taux} onChange={(e) => setTaux(e.target.value)} />
            </div>
            <div>
              <label className="label">Durée (mois) *</label>
              <input className="input" type="number" min={1} max={60} required value={duree} onChange={(e) => setDuree(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label">Motif</label>
            <input className="input" value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="ex. Achat de marchandises" />
          </div>
          {montant && duree && (
            <div className="rounded-xl bg-brand-50 p-3 text-sm text-brand-800">
              Total à rembourser :{' '}
              <span className="font-bold">{formatMontant(Number(montant) * (1 + Number(taux) / 100))}</span> soit{' '}
              <span className="font-bold">
                {formatMontant(Math.round((Number(montant) * (1 + Number(taux) / 100)) / Number(duree)))}
              </span>{' '}
              par mois sur {duree} mois.
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setModaleDemande(false)}>
              Annuler
            </button>
            <button type="submit" className="btn-primary">Soumettre la demande</button>
          </div>
        </form>
      </Modale>

      {/* Remboursement */}
      <Modale
        titre={creditARembourser ? `Remboursement — ${creditARembourser.numero}` : ''}
        ouverte={creditARembourser !== null}
        onFermer={() => setCreditARembourser(null)}
      >
        {creditARembourser && (
          <form onSubmit={validerRemboursement} className="space-y-4">
            {(() => {
              const sit = situationCredit(creditARembourser, data.remboursements)
              return (
                <div className="rounded-xl bg-slate-50 p-3 text-sm">
                  Reste à payer : <span className="font-bold">{formatMontant(sit.resteAPayer)}</span> — mensualité
                  habituelle : <span className="font-bold">{formatMontant(sit.mensualite)}</span>
                </div>
              )
            })()}
            <div>
              <label className="label">Montant encaissé (FCFA) *</label>
              <input
                className="input"
                type="number"
                min={1}
                required
                autoFocus
                value={montantRemboursement}
                onChange={(e) => setMontantRemboursement(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setCreditARembourser(null)}>
                Annuler
              </button>
              <button type="submit" className="btn-primary">Valider le remboursement</button>
            </div>
          </form>
        )}
      </Modale>
    </div>
  )
}
