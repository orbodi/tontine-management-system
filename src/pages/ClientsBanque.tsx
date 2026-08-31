import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { ArrowLeft, Building2, ChevronRight, Plus, Search, Users, Wallet } from 'lucide-react'
import { useStore } from '../store'
import type { Client, TypeCompte } from '../types'
import { afficherNumeroClient, formatDateHeure, formatMontant, texteAlerteCompteOuvert, texteAlerteDemandeOuverture, texteConfirmationOuvertureCompte } from '../utils'
import { Avatar, EnTetePage, EtatVide, Modale } from '../components/ui'
import { formulaireClientVide, RecapFraisOuvertureCompte, CasesFraisOuvertureCompte, ModaleClient, type FormulaireClient } from '../components/ModaleClient'
import { useConfirmation } from '../components/Confirmation'
import { fraisOuvertureComptePour } from '../metier'

function clientsBanqueDe(clients: Client[], agenceId: string): Client[] {
  return clients.filter((c) => c.agenceId === agenceId && !!c.codeClientBanque)
}

export default function ClientsBanque() {
  const { agenceId } = useParams<{ agenceId?: string }>()
  const { data, estAdmin, employeConnecte } = useStore()
  const [recherche, setRecherche] = useState('')
  const agenceRestreinte = !estAdmin && employeConnecte ? employeConnecte.agenceId : null

  const agencesTriees = useMemo(() => {
    const q = recherche.trim().toLowerCase()
    let liste = data.agences.filter((a) => a.actif)
    if (agenceRestreinte) liste = liste.filter((a) => a.id === agenceRestreinte)
    return liste
      .filter((a) => !q || a.nom.toLowerCase().includes(q) || a.code.toLowerCase().includes(q))
      .sort((a, b) => a.nom.localeCompare(b.nom))
  }, [data.agences, agenceRestreinte, recherche])

  if (agenceId) {
    return <ListeClientsBanque agenceId={agenceId} />
  }

  return (
    <div>
      <Link
        to="/clients"
        className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-brand-600 hover:text-brand-700"
      >
        <ArrowLeft className="h-4 w-4" />
        Retour aux types de clients
      </Link>

      <EnTetePage
        titre="Clients banque"
        sousTitre="Clients banque (n° 0001…) — parcourez par agence"
      />

      <div className="relative mb-6 max-w-md">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          className="input pl-10"
          placeholder="Rechercher une agence…"
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
        />
      </div>

      {agencesTriees.length === 0 ? (
        <EtatVide titre="Aucune agence" description="Aucune agence active ne correspond." />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {agencesTriees.map((a) => {
            const clientsAg = clientsBanqueDe(data.clients, a.id)
            const nbActifs = clientsAg.filter((c) => c.actif).length
            return (
              <Link
                key={a.id}
                to={`/clients/banque/agence/${a.id}`}
                className="card group block transition hover:border-sky-300 hover:shadow-md"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-700 transition group-hover:bg-sky-200">
                    <Building2 className="h-6 w-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-bold text-sky-700">{a.code}</span>
                      <h3 className="font-semibold text-slate-900">{a.nom}</h3>
                    </div>
                    <p className="mt-2 flex items-center gap-1.5 text-sm text-slate-600">
                      <Users className="h-4 w-4 text-slate-400" />
                      {clientsAg.length} client{clientsAg.length > 1 ? 's' : ''} banque
                      {clientsAg.length > 0 && (
                        <span className="text-slate-400">
                          ({nbActifs} actif{nbActifs > 1 ? 's' : ''})
                        </span>
                      )}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">Fiches banque — comptes à ouvrir ensuite</p>
                  </div>
                  <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-slate-300 transition group-hover:text-sky-600" />
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ListeClientsBanque({ agenceId }: { agenceId: string }) {
  const {
    data,
    estAdmin,
    estCaissier,
    aDroit,
    employeConnecte,
    ajouterClient,
    inscrireClientBanque,
    modifierClient,
    ouvrirCompte,
    validerOuvertureCompte,
    refuserOuvertureCompte,
  } = useStore()
  const { alerter, confirmer } = useConfirmation()
  const [recherche, setRecherche] = useState('')
  const [modaleOuverte, setModaleOuverte] = useState(false)
  const [modaleOuvertureCompte, setModaleOuvertureCompte] = useState(false)
  const [clientEnEdition, setClientEnEdition] = useState<Client | null>(null)
  const [clientPourCompte, setClientPourCompte] = useState<Client | null>(null)
  const [modeAjout, setModeAjout] = useState<'nouveau' | 'existant'>('nouveau')
  const [form, setForm] = useState<FormulaireClient>(formulaireClientVide)
  const [clientExistantId, setClientExistantId] = useState('')
  const [typeCompte, setTypeCompte] = useState<TypeCompte>('courant')
  const [caissierId, setCaissierId] = useState('')
  const [promo, setPromo] = useState(false)
  const [payerPartSociale, setPayerPartSociale] = useState(true)
  const [payerAdhesion, setPayerAdhesion] = useState(true)
  const [erreur, setErreur] = useState('')
  const [fraisCompte, setFraisCompte] = useState({
    partSociale: 5000,
    droitAdhesion: 2500,
    droitAdhesionPromo: 500,
  })

  const agence = data.agences.find((a) => a.id === agenceId)
  const accesOk = !!agence && (estAdmin || employeConnecte?.agenceId === agence.id)
  const peutGererClients = estAdmin || aDroit('gerer_clients')
  const peutOuvrirCompte = (estAdmin || aDroit('operer_comptes')) && !estCaissier

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

  const clientsFiltres = useMemo(() => {
    if (!accesOk) return []
    const q = recherche.trim().toLowerCase()
    return clientsBanqueDe(data.clients, agenceId)
      .filter(
        (c) =>
          !q ||
          `${c.prenom} ${c.nom}`.toLowerCase().includes(q) ||
          (c.codeClient ?? '').toLowerCase().includes(q) ||
          afficherNumeroClient(c.codeClient ?? '').includes(q) ||
          (c.codeClientBanque ?? '').includes(q) ||
          (c.telephone ?? '').replace(/\s/g, '').includes(q.replace(/\s/g, '')),
      )
      .sort(
        (a, b) =>
          (a.ordreBanque ?? 0) - (b.ordreBanque ?? 0) ||
          `${a.prenom} ${a.nom}`.localeCompare(`${b.prenom} ${b.nom}`),
      )
  }, [data.clients, agenceId, recherche, accesOk])

  const clientsAInscrire = useMemo(
    () =>
      data.clients
        .filter((c) => c.actif && c.agenceId === agenceId && !c.codeClientBanque)
        .sort((a, b) => `${a.prenom} ${a.nom}`.localeCompare(`${b.prenom} ${b.nom}`)),
    [data.clients, agenceId],
  )

  const caissiersAgence = useMemo(
    () =>
      data.employes
        .filter((e) => e.actif && e.role === 'caissier' && e.agenceId === agenceId)
        .sort((a, b) => a.nomComplet.localeCompare(b.nomComplet)),
    [data.employes, agenceId],
  )

  const demandesAgence = useMemo(
    () =>
      (data.demandesOuvertureCompte ?? [])
        .filter((d) => d.statut === 'en_attente')
        .filter((d) => data.clients.some((c) => c.id === d.clientId && c.agenceId === agenceId))
        .sort((a, b) => b.dateDemande.localeCompare(a.dateDemande)),
    [data.demandesOuvertureCompte, data.clients, agenceId],
  )

  if (!agence || !accesOk) {
    return <Navigate to="/clients/banque" replace />
  }

  const ouvrirEdition = (c: Client) => {
    if (estCaissier) return
    setClientEnEdition(c)
    setForm({
      agenceId: c.agenceId,
      zoneId: c.zoneId ?? '',
      nom: c.nom,
      prenom: c.prenom,
      telephone: c.telephone,
      email: c.email ?? '',
      sexe: c.sexe,
      profession: c.profession ?? '',
      adresse: c.adresse ?? '',
      pieceIdentite: c.pieceIdentite ?? '',
      origineTontine: c.origineTontine === 'ancien' ? 'ancien' : 'nouveau',
    })
    setErreur('')
  }

  const enregistrerEdition = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!clientEnEdition) return
    const patch = {
      nom: form.nom.trim(),
      prenom: form.prenom.trim(),
      telephone: form.telephone.trim(),
      email: form.email.trim() || undefined,
      sexe: form.sexe,
      profession: form.profession.trim() || undefined,
      adresse: form.adresse.trim() || undefined,
      pieceIdentite: form.pieceIdentite.trim() || undefined,
      origineTontine: form.origineTontine,
    }
    const res = await modifierClient(clientEnEdition.id, patch)
    if (res.erreur) {
      setErreur(res.erreur)
      return
    }
    setClientEnEdition(null)
    setErreur('')
    await alerter(
      'Client modifié',
      `Les informations de ${patch.prenom} ${patch.nom}${
        clientEnEdition.codeClientBanque ? ` (n° ${clientEnEdition.codeClientBanque})` : ''
      } ont été mises à jour.`,
    )
  }

  const ouvrirCreation = () => {
    setClientEnEdition(null)
    setModeAjout(peutGererClients ? 'nouveau' : 'existant')
    setForm({
      ...formulaireClientVide,
      agenceId,
      zoneId: '',
    })
    setClientExistantId('')
    setErreur('')
    setModaleOuverte(true)
  }

  const ouvrirOuvertureCompte = (c: Client) => {
    setClientPourCompte(c)
    setTypeCompte('courant')
    setCaissierId('')
    setPromo(false)
    setPayerPartSociale(true)
    setPayerAdhesion(true)
    setErreur('')
    setModaleOuvertureCompte(true)
  }

  const champ =
    (cle: keyof FormulaireClient) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [cle]: e.target.value }))

  const enregistrerClient = async (e: React.FormEvent) => {
    e.preventDefault()
    if (modeAjout === 'nouveau') {
      if (!peutGererClients) {
        setErreur('Droit insuffisant pour créer un client.')
        return
      }
      const cree = await ajouterClient({
        nom: form.nom.trim(),
        prenom: form.prenom.trim(),
        telephone: form.telephone.trim(),
        email: form.email.trim() || undefined,
        sexe: form.sexe,
        profession: form.profession.trim() || undefined,
        adresse: form.adresse.trim() || undefined,
        pieceIdentite: form.pieceIdentite.trim() || undefined,
        origineTontine: form.origineTontine,
        agenceId,
      })
      if (!cree) {
        setErreur('Impossible d’ajouter le client (agence inactive ou introuvable).')
        return
      }
      setModaleOuverte(false)
      setErreur('')
      await alerter(
        'Client banque créé',
        `${form.prenom.trim()} ${form.nom.trim()} a été inscrit${cree.codeClientBanque ? ` (n° ${cree.codeClientBanque})` : ''}.\nOuvrez ensuite un compte depuis sa ligne.`,
      )
      return
    }
    if (!clientExistantId) {
      setErreur('Choisissez un client.')
      return
    }
    const res = await inscrireClientBanque(clientExistantId)
    if (res.erreur) {
      setErreur(res.erreur)
      return
    }
    const choisi = data.clients.find((c) => c.id === clientExistantId)
    setModaleOuverte(false)
    setErreur('')
    await alerter(
      'Client banque inscrit',
      `${choisi ? `${choisi.prenom} ${choisi.nom}` : 'Le client'} a été inscrit${res.codeClientBanque ? ` (n° ${res.codeClientBanque})` : ''}.\nOuvrez ensuite un compte depuis sa ligne.`,
    )
  }

  const enregistrerOuverture = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!clientPourCompte) return
    if (!caissierId) {
      setErreur('Indiquez le caissier qui validera l’ouverture.')
      return
    }
    const resultat = await ouvrirCompte(clientPourCompte.id, typeCompte, promo, caissierId, {
      payerPartSociale,
      payerAdhesion,
    })
    if ('erreur' in resultat) {
      setErreur(resultat.erreur)
      return
    }
    const frais = fraisOuvertureComptePour(fraisCompte, promo, {
      payerPartSociale,
      payerAdhesion,
    })
    const caissier = data.employes.find((x) => x.id === caissierId)
    setModaleOuvertureCompte(false)
    setClientPourCompte(null)
    setErreur('')
    await alerter(
      'Demande envoyée',
      texteAlerteDemandeOuverture(caissier?.nomComplet ?? 'le caissier', frais),
    )
  }

  return (
    <div>
      <Link
        to="/clients/banque"
        className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-brand-600 hover:text-brand-700"
      >
        <ArrowLeft className="h-4 w-4" />
        Retour aux agences
      </Link>

      <EnTetePage
        titre={`Clients banque — ${agence.nom}`}
        sousTitre={`${clientsFiltres.length} client${clientsFiltres.length > 1 ? 's' : ''} banque`}
        action={
          peutGererClients && !estCaissier ? (
            <button className="btn-primary" onClick={ouvrirCreation} disabled={!agence.actif}>
              <Plus className="h-4 w-4" />
              Nouveau client banque
            </button>
          ) : undefined
        }
      />

      {!agence.actif && (
        <div className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-950 ring-1 ring-amber-200">
          Cette agence est inactive — vous ne pouvez pas y ajouter de client banque.
        </div>
      )}

      <div className="relative mb-6 max-w-md">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          className="input pl-10"
          placeholder="Rechercher un client banque…"
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
        />
      </div>

      {demandesAgence.length > 0 && !estCaissier && (
        <div className="card mb-6 border-amber-200 bg-amber-50/50">
          <h3 className="mb-3 font-semibold text-slate-900">
            Ouvertures en attente de validation caisse ({demandesAgence.length})
          </h3>
          <div className="space-y-2">
            {demandesAgence.map((d) => {
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
                      {d.type === 'courant' ? 'Compte courant' : 'Compte épargne'}
                      {d.promotion ? ' (promo)' : ''}
                    </p>
                    <p className="text-xs text-slate-500">
                      Caisse : {caissier?.nomComplet ?? '—'} —{' '}
                      {d.partSociale + d.droitAdhesion <= 0
                        ? 'aucun frais'
                        : `total ${formatMontant(d.partSociale + d.droitAdhesion)}`}{' '}
                      — {formatDateHeure(d.dateDemande)}
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
                            message: texteConfirmationOuvertureCompte(total),
                            labelValider: 'Valider et créer',
                          })
                          if (!ok) return
                          const err = await validerOuvertureCompte(d.id)
                          if (err) await alerter('Validation impossible', err)
                          else await alerter('Compte ouvert', texteAlerteCompteOuvert(total))
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

      {clientsFiltres.length === 0 ? (
        <EtatVide
          titre="Aucun client banque"
          description={
            peutGererClients && agence.actif
              ? 'Ajoutez le premier client banque. L’ouverture de compte se fait ensuite depuis sa ligne.'
              : 'Aucun client banque pour cette agence.'
          }
        />
      ) : (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3.5">N° Client</th>
                <th className="px-5 py-3.5">Client</th>
                <th className="px-5 py-3.5">Téléphone</th>
                <th className="px-5 py-3.5">Comptes</th>
                <th className="px-5 py-3.5">Soldes</th>
                <th className="px-5 py-3.5">Statut</th>
                <th className="px-5 py-3.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {clientsFiltres.map((c) => {
                const comptes = data.comptes.filter((co) => co.clientId === c.id)
                const aTontine = data.carnets.some((ca) => ca.clientId === c.id)
                const total = comptes.reduce((s, co) => s + co.solde, 0)
                return (
                  <tr key={c.id} className="transition hover:bg-slate-50">
                    <td className="px-5 py-3 font-mono text-xs font-semibold tabular-nums tracking-wide text-sky-700">
                      {c.codeClientBanque ?? '—'}
                    </td>
                    <td className="px-5 py-3">
                      <Link
                        to={`/clients/${c.id}?depuis=banque`}
                        className="flex items-center gap-3"
                      >
                        <Avatar nom={c.nom} prenom={c.prenom} />
                        <span>
                          <span className="font-medium text-slate-900">
                            {c.prenom} {c.nom}
                          </span>
                          {aTontine && (
                            <span className="mt-0.5 block text-xs text-slate-400">Aussi client tontine</span>
                          )}
                        </span>
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{c.telephone}</td>
                    <td className="px-5 py-3 text-slate-600">
                      {comptes.length === 0 ? (
                        <span className="text-xs text-slate-400">Aucun compte</span>
                      ) : (
                        comptes.map((co) => (
                          <div key={co.id} className="flex items-center gap-1.5 text-xs">
                            <Wallet className="h-3 w-3 text-sky-500" />
                            <span className="font-mono">{co.numero}</span>
                            <span className="text-slate-400">{co.type === 'courant' ? 'courant' : 'épargne'}</span>
                          </div>
                        ))
                      )}
                    </td>
                    <td className="px-5 py-3 font-medium tabular-nums text-slate-800">{formatMontant(total)}</td>
                    <td className="px-5 py-3">
                      <span
                        className={`badge ${c.actif ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}
                      >
                        {c.actif ? 'Actif' : 'Inactif'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {!estCaissier && peutGererClients && (
                          <button
                            type="button"
                            className="text-xs font-medium text-slate-500 hover:text-brand-600"
                            onClick={() => ouvrirEdition(c)}
                          >
                            Modifier
                          </button>
                        )}
                        {peutOuvrirCompte && c.actif && (
                          <button
                            type="button"
                            className="text-xs font-medium text-sky-700 hover:text-sky-900"
                            onClick={() => ouvrirOuvertureCompte(c)}
                          >
                            Ouvrir un compte
                          </button>
                        )}
                        <Link
                          to={`/clients/${c.id}?depuis=banque`}
                          className="text-brand-600 hover:text-brand-700"
                          title="Voir la fiche"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Link>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modale
        titre={
          clientEnEdition
            ? `Modifier ${clientEnEdition.codeClientBanque ?? `${clientEnEdition.prenom} ${clientEnEdition.nom}`}`
            : 'Nouveau client banque'
        }
        ouverte={!!clientEnEdition}
        onFermer={() => setClientEnEdition(null)}
      >
        <ModaleClient
          onFermer={() => setClientEnEdition(null)}
          clientEnEdition={clientEnEdition}
          form={form}
          setForm={setForm}
          erreur={erreur}
          modeBanque
          onSubmit={enregistrerEdition}
        />
      </Modale>

      <Modale
        titre="Nouveau client banque"
        ouverte={modaleOuverte}
        onFermer={() => setModaleOuverte(false)}
        large
      >
        <form onSubmit={enregistrerClient} className="space-y-4">
          {peutGererClients && (
            <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
              <button
                type="button"
                className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  modeAjout === 'nouveau' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
                onClick={() => {
                  setModeAjout('nouveau')
                  setErreur('')
                }}
              >
                Nouveau client
              </button>
              <button
                type="button"
                className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  modeAjout === 'existant' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
                onClick={() => {
                  setModeAjout('existant')
                  setErreur('')
                }}
              >
                Client déjà inscrit
              </button>
            </div>
          )}

          {modeAjout === 'nouveau' ? (
            <>
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Agence :{' '}
                <span className="font-semibold text-slate-900">
                  {agence.code} — {agence.nom}
                </span>
                <span className="mt-0.5 block text-slate-400">
                  Fiche rattachée à l’agence (pas à une zone). Le n° banque (0001, 0002…) est attribué
                  tout de suite. L’ouverture de compte se fait ensuite.
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Prénom *</label>
                  <input className="input" required value={form.prenom} onChange={champ('prenom')} />
                </div>
                <div>
                  <label className="label">Nom *</label>
                  <input className="input" required value={form.nom} onChange={champ('nom')} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Téléphone *</label>
                  <input
                    className="input"
                    required
                    value={form.telephone}
                    onChange={champ('telephone')}
                    placeholder="+225 07 00 00 00 00"
                  />
                </div>
                <div>
                  <label className="label">Sexe</label>
                  <select className="input" value={form.sexe} onChange={champ('sexe')}>
                    <option value="F">Femme</option>
                    <option value="M">Homme</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Pièce d&apos;identité</label>
                <input
                  className="input"
                  value={form.pieceIdentite}
                  onChange={champ('pieceIdentite')}
                  placeholder="ex. CNI C123456789"
                />
              </div>
              <div>
                <label className="label">Profession</label>
                <input className="input" value={form.profession} onChange={champ('profession')} />
              </div>
              <div>
                <label className="label">Adresse</label>
                <input className="input" value={form.adresse} onChange={champ('adresse')} />
              </div>
            </>
          ) : (
            <div>
              <label className="label">Client *</label>
              <select
                className="input"
                required={modeAjout === 'existant'}
                value={clientExistantId}
                onChange={(e) => setClientExistantId(e.target.value)}
              >
                <option value="">— Choisir un client de l’agence (sans n° banque) —</option>
                {clientsAInscrire.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.zoneId ? `${afficherNumeroClient(c.codeClient)} — ` : ''}
                    {c.prenom} {c.nom}
                  </option>
                ))}
              </select>
              {clientsAInscrire.length === 0 && (
                <p className="mt-1 text-xs text-slate-400">
                  Tous les clients de cette agence ont déjà un n° banque.
                </p>
              )}
            </div>
          )}

          {erreur && <p className="text-sm font-medium text-rose-600">{erreur}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setModaleOuverte(false)}>
              Annuler
            </button>
            <button type="submit" className="btn-primary">
              Enregistrer le client
            </button>
          </div>
        </form>
      </Modale>

      <Modale
        titre={
          clientPourCompte
            ? `Ouvrir un compte — ${clientPourCompte.prenom} ${clientPourCompte.nom}`
            : 'Ouvrir un compte'
        }
        ouverte={modaleOuvertureCompte}
        onFermer={() => {
          setModaleOuvertureCompte(false)
          setClientPourCompte(null)
        }}
      >
        {clientPourCompte && (
          <form onSubmit={enregistrerOuverture} className="space-y-4">
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Client banque n°{' '}
              <span className="font-mono font-semibold text-sky-700">
                {clientPourCompte.codeClientBanque}
              </span>
            </p>
            <div>
              <label className="label">Type de compte *</label>
              <select
                className="input"
                value={typeCompte}
                onChange={(e) => setTypeCompte(e.target.value as TypeCompte)}
              >
                <option value="courant">Compte courant — dépôts et retraits (n° Bxxxx)</option>
                <option value="epargne">Compte épargne — dépôts et retraits (n° Bxxxx)</option>
              </select>
            </div>
            <div>
              <label className="label">Caisse (encaissement) *</label>
              <select
                className="input"
                required
                value={caissierId}
                onChange={(e) => setCaissierId(e.target.value)}
              >
                <option value="">— Choisir le caissier —</option>
                {caissiersAgence.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nomComplet}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-400">
                Le compte est créé après validation en caisse.
              </p>
            </div>
            <CasesFraisOuvertureCompte
              tarifs={fraisCompte}
              payerPartSociale={payerPartSociale}
              onPayerPartSociale={setPayerPartSociale}
              payerAdhesion={payerAdhesion}
              onPayerAdhesion={setPayerAdhesion}
              promo={promo}
              onPromo={setPromo}
            />
            <RecapFraisOuvertureCompte
              frais={fraisOuvertureComptePour(fraisCompte, promo, {
                payerPartSociale,
                payerAdhesion,
              })}
            />
            {erreur && <p className="text-sm font-medium text-rose-600">{erreur}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setModaleOuvertureCompte(false)
                  setClientPourCompte(null)
                }}
              >
                Annuler
              </button>
              <button type="submit" className="btn-primary">
                <Wallet className="h-4 w-4" />
                Envoyer la demande
              </button>
            </div>
          </form>
        )}
      </Modale>
    </div>
  )
}

