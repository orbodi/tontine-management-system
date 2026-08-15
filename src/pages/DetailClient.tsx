import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Banknote,
  BellRing,
  HandCoins,
  PiggyBank,
  UserCheck,
  UserX,
} from 'lucide-react'
import { MODULE_CREDITS_ACTIF } from '../config'
import { useStore } from '../store'
import { LIBELLES_CARNET, TYPES_SORTIE, situationCredit } from '../metier'
import { formatDate, formatDateHeure, formatMontant } from '../utils'
import { Avatar, BadgeStatutCredit, BoutonsMessage, EnTetePage, Modale } from '../components/ui'

export default function DetailClient() {
  const { id } = useParams()
  const { data, basculerActifClient } = useStore()
  const [modaleMessage, setModaleMessage] = useState(false)
  const [texteMessage, setTexteMessage] = useState('')

  const client = data.clients.find((c) => c.id === id)

  const activite = useMemo(() => {
    if (!client) return null
    const carnets = data.carnets.filter((c) => c.clientId === client.id)
    const comptes = data.comptes.filter((c) => c.clientId === client.id)
    const credits = data.credits.filter((c) => c.clientId === client.id)
    const transactions = data.transactions.filter((t) => t.clientId === client.id)

    const soldeTontine = carnets.reduce((s, carnet) => {
      const mises = data.mises
        .filter((m) => m.carnetId === carnet.id && m.cycle === carnet.cycleActuel)
        .reduce((x, m) => x + m.nombreMises, 0)
      return s + mises * carnet.mise
    }, 0)
    const soldeEpargne = comptes.reduce((s, c) => s + c.solde, 0)
    const detteCredits = credits
      .filter((c) => c.statut === 'en_cours' || c.statut === 'en_retard')
      .reduce((s, c) => s + situationCredit(c, data.remboursements).resteAPayer, 0)

    return { carnets, comptes, credits, transactions, soldeTontine, soldeEpargne, detteCredits }
  }, [client, data])

  if (!client || !activite) {
    return (
      <div>
        <Link to="/clients" className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-brand-600 hover:text-brand-700">
          <ArrowLeft className="h-4 w-4" />
          Retour aux clients
        </Link>
        <p className="text-slate-600">Client introuvable.</p>
      </div>
    )
  }

  const creditEnRetard = MODULE_CREDITS_ACTIF
    ? activite.credits.find((c) => c.statut === 'en_retard')
    : undefined

  const ouvrirModaleMessage = () => {
    let texte = `Bonjour ${client.prenom} ${client.nom}, `
    if (creditEnRetard) {
      const sit = situationCredit(creditEnRetard, data.remboursements)
      texte += `nous vous rappelons que votre crédit ${creditEnRetard.numero} présente un retard de paiement. Reste à payer : ${formatMontant(sit.resteAPayer)} (mensualité : ${formatMontant(sit.mensualite)}). Merci de passer à l'agence. MicroFinance Pro`
    } else {
      texte += `votre situation chez MicroFinance Pro : épargne ${formatMontant(activite.soldeEpargne)}, tontine en cours ${formatMontant(activite.soldeTontine)}. Merci de votre confiance.`
    }
    setTexteMessage(texte)
    setModaleMessage(true)
  }

  return (
    <div>
      <Link to="/clients" className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-brand-600 hover:text-brand-700">
        <ArrowLeft className="h-4 w-4" />
        Retour aux clients
      </Link>

      <EnTetePage
        titre={`${client.prenom} ${client.nom}`}
        sousTitre={`${client.codeClient} — ${client.profession ?? 'Profession non renseignée'}`}
        action={
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={ouvrirModaleMessage}>
              <BellRing className="h-4 w-4" />
              Notifier le client
            </button>
            <button className="btn-secondary" onClick={() => basculerActifClient(client.id)}>
              {client.actif ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
              {client.actif ? 'Désactiver' : 'Réactiver'}
            </button>
          </div>
        }
      />

      {/* Fiche d'identité */}
      <div className="card mb-6">
        <div className="flex flex-wrap items-start gap-5">
          <Avatar nom={client.nom} prenom={client.prenom} taille="lg" />
          <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
            <div>
              <dt className="text-xs text-slate-500">Agence</dt>
              <dd className="font-medium text-slate-900">
                {data.agences.find((a) => a.id === client.agenceId)
                  ? `${data.agences.find((a) => a.id === client.agenceId)!.code} — ${data.agences.find((a) => a.id === client.agenceId)!.nom}`
                  : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Téléphone</dt>
              <dd className="font-medium text-slate-900">{client.telephone}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Email</dt>
              <dd className="font-medium text-slate-900">{client.email ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Pièce d'identité</dt>
              <dd className="font-medium text-slate-900">{client.pieceIdentite ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Adresse</dt>
              <dd className="font-medium text-slate-900">{client.adresse ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Inscrit le</dt>
              <dd className="font-medium text-slate-900">{formatDate(client.dateInscription)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Statut</dt>
              <dd>
                <span className={`badge ${client.actif ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                  {client.actif ? 'Actif' : 'Inactif'}
                </span>
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Synthèse financière */}
      <div className={`mb-6 grid grid-cols-1 gap-4 ${MODULE_CREDITS_ACTIF ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
        <div className="card flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
            <HandCoins className="h-6 w-6" />
          </div>
          <div>
            <div className="text-lg font-bold text-slate-900">{formatMontant(activite.soldeTontine)}</div>
            <div className="text-sm text-slate-500">Tontine (cycle en cours)</div>
          </div>
        </div>
        <div className="card flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600">
            <PiggyBank className="h-6 w-6" />
          </div>
          <div>
            <div className="text-lg font-bold text-slate-900">{formatMontant(activite.soldeEpargne)}</div>
            <div className="text-sm text-slate-500">Comptes (courant + épargne)</div>
          </div>
        </div>
        {MODULE_CREDITS_ACTIF && (
        <div className="card flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-100 text-violet-600">
            <Banknote className="h-6 w-6" />
          </div>
          <div>
            <div className="text-lg font-bold text-slate-900">{formatMontant(activite.detteCredits)}</div>
            <div className="text-sm text-slate-500">Crédits restant dus</div>
          </div>
        </div>
        )}
      </div>

      <div className={`grid grid-cols-1 gap-6 ${MODULE_CREDITS_ACTIF ? 'xl:grid-cols-2' : ''}`}>
        {/* Crédits */}
        {MODULE_CREDITS_ACTIF && (
        <div className="card">
          <h3 className="mb-4 font-semibold text-slate-900">Crédits</h3>
          {activite.credits.length === 0 ? (
            <p className="text-sm text-slate-500">Aucun crédit.</p>
          ) : (
            <div className="space-y-3">
              {activite.credits.map((c) => {
                const sit = situationCredit(c, data.remboursements)
                return (
                  <div key={c.id} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-semibold text-brand-700">{c.numero}</span>
                      <BadgeStatutCredit statut={c.statut} />
                    </div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">
                      {formatMontant(c.montant)} sur {c.dureeMois} mois — {c.motif ?? 'Sans motif'}
                    </div>
                    {(c.statut === 'en_cours' || c.statut === 'en_retard') && (
                      <div className="mt-1 text-xs text-slate-500">
                        Payé {formatMontant(sit.dejaPaye)} / {formatMontant(sit.totalDu)} — reste{' '}
                        <span className="font-semibold text-slate-700">{formatMontant(sit.resteAPayer)}</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
        )}

        {/* Comptes et carnets */}
        <div className="card">
          <h3 className="mb-4 font-semibold text-slate-900">Comptes et carnets</h3>
          <div className="space-y-3">
            {activite.comptes.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-xl border border-slate-200 p-3 text-sm">
                <div>
                  <span className="font-mono text-xs font-semibold text-brand-700">{c.numero}</span>
                  <span className="ml-2 text-slate-600">
                    {c.type === 'courant' ? 'Compte courant' : 'Compte épargne'}
                  </span>
                  {c.verrouille && <span className="badge ml-2 bg-rose-100 text-rose-700">Verrouillé</span>}
                </div>
                <span className="font-bold text-slate-900">{formatMontant(c.solde)}</span>
              </div>
            ))}
            {activite.carnets.map((carnet) => {
              const mises = data.mises
                .filter((m) => m.carnetId === carnet.id && m.cycle === carnet.cycleActuel)
                .reduce((s, m) => s + m.nombreMises, 0)
              return (
                <div key={carnet.id} className="rounded-xl border border-slate-200 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">
                      <span className="font-mono text-xs font-semibold text-brand-700">{carnet.numero}</span>{' '}
                      {LIBELLES_CARNET[carnet.typeCarnet]} — mise {formatMontant(carnet.mise)} (cycle{' '}
                      {carnet.cycleActuel}/12)
                      {carnet.verrouille && <span className="badge ml-2 bg-rose-100 text-rose-700">Verrouillé</span>}
                    </span>
                    <span className="font-bold text-slate-900">
                      {mises}/{carnet.misesParCycle} mises
                    </span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-brand-500"
                      style={{ width: `${(mises / carnet.misesParCycle) * 100}%` }}
                    />
                  </div>
                </div>
              )
            })}
            {activite.comptes.length === 0 && activite.carnets.length === 0 && (
              <p className="text-sm text-slate-500">Aucun compte ni carnet.</p>
            )}
          </div>
        </div>
      </div>

      {/* Historique */}
      <div className="card mt-6">
        <h3 className="mb-4 font-semibold text-slate-900">
          Historique des opérations ({activite.transactions.length})
        </h3>
        {activite.transactions.length === 0 ? (
          <p className="text-sm text-slate-500">Aucune opération.</p>
        ) : (
          <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
            {activite.transactions.map((t) => {
              const sortie = TYPES_SORTIE.includes(t.type)
              return (
                <div key={t.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-800">{t.description}</p>
                    <p className="text-xs text-slate-500">
                      {formatDateHeure(t.date)} — par {t.operateur}
                    </p>
                  </div>
                  <span className={`shrink-0 font-bold ${sortie ? 'text-rose-600' : 'text-emerald-600'}`}>
                    {sortie ? '-' : '+'}
                    {formatMontant(t.montant)}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Modale notification */}
      <Modale titre="Notifier le client" ouverte={modaleMessage} onFermer={() => setModaleMessage(false)}>
        <div className="space-y-4">
          <div>
            <label className="label">Message (modifiable)</label>
            <textarea
              className="input min-h-32"
              value={texteMessage}
              onChange={(e) => setTexteMessage(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Envoyer via</label>
            <BoutonsMessage telephone={client.telephone} message={texteMessage} />
          </div>
          <p className="text-xs text-slate-400">
            Le message s'ouvre dans votre application SMS ou WhatsApp avec le texte pré-rempli.
          </p>
        </div>
      </Modale>
    </div>
  )
}
