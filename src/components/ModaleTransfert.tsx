import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowRightLeft, Search, X } from 'lucide-react'
import { useStore } from '../store'
import type { CarnetTontine, Client, Compte } from '../types'
import { eligibiliteRetraitCarnet, situationsCycles } from '../metier'
import { formatMontant } from '../utils'
import { Modale } from './ui'
import { useConfirmation } from './Confirmation'

export type TypeTransfert = 'compte' | 'tontine'

export interface InitialTransfert {
  type?: TypeTransfert
  compteSourceId?: string
  carnetId?: string
  cycle?: number
}

const MOT_CONFIRMATION = 'confirmer'

const nomClient = (c?: Client) => (c ? `${c.prenom} ${c.nom}` : 'Client inconnu')
const natureCompte = (c: Compte) => (c.type === 'epargne' ? 'Épargne' : 'Courant')
const normaliser = (s?: string | null) =>
  (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

/** Liste déroulante avec recherche (n°, nom, prénom, téléphone). */
function Selecteur<T extends { id: string }>({
  options,
  valeur,
  onChoisir,
  libelle,
  detail,
  texteRecherche,
  placeholder,
  vide,
}: {
  options: T[]
  valeur: string
  onChoisir: (id: string) => void
  libelle: (o: T) => string
  detail: (o: T) => string
  texteRecherche: (o: T) => string
  placeholder: string
  vide: string
}) {
  const [q, setQ] = useState('')
  const choisi = options.find((o) => o.id === valeur)
  const filtres = useMemo(() => {
    const n = normaliser(q)
    return options.filter((o) => !n || normaliser(texteRecherche(o)).includes(n)).slice(0, 8)
  }, [q, options, texteRecherche])

  if (choisi) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
        <div className="min-w-0 text-sm">
          <div className="truncate font-semibold text-slate-900">{libelle(choisi)}</div>
          <div className="truncate text-xs text-slate-500">{detail(choisi)}</div>
        </div>
        <button
          type="button"
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
          title="Changer"
          onClick={() => {
            onChoisir('')
            setQ('')
          }}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input className="input !pl-9" placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {options.length === 0 ? (
        <p className="mt-1.5 text-xs text-rose-600">{vide}</p>
      ) : (
        <ul className="mt-1.5 max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-xl ring-1 ring-slate-200">
          {filtres.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-sm hover:bg-brand-50"
                onClick={() => onChoisir(o.id)}
              >
                <div className="font-medium text-slate-900">{libelle(o)}</div>
                <div className="text-xs text-slate-500">{detail(o)}</div>
              </button>
            </li>
          ))}
          {filtres.length === 0 && <li className="px-3 py-2 text-xs text-slate-500">Aucun résultat.</li>}
        </ul>
      )}
    </div>
  )
}

function LigneRecap({ titre, lignes }: { titre: string; lignes: string[] }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3 text-sm ring-1 ring-slate-100">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{titre}</div>
      {lignes.map((l) => (
        <div key={l} className="text-slate-800">
          {l}
        </div>
      ))}
    </div>
  )
}

export function ModaleTransfert({
  ouverte,
  onFermer,
  initial,
}: {
  ouverte: boolean
  onFermer: () => void
  initial?: InitialTransfert
}) {
  const { data, employeConnecte, estAdmin, estChefAgence, transfertCompteCompte, transfertTontineCompte } =
    useStore()
  const { alerter } = useConfirmation()

  const [type, setType] = useState<TypeTransfert>('compte')
  const [compteSourceId, setCompteSourceId] = useState('')
  const [carnetId, setCarnetId] = useState('')
  const [cycle, setCycle] = useState(0)
  const [nbCarreaux, setNbCarreaux] = useState('1')
  const [compteDestId, setCompteDestId] = useState('')
  const [montant, setMontant] = useState('')
  const [motif, setMotif] = useState('')
  const [etape, setEtape] = useState<'saisie' | 'confirmation'>('saisie')
  const [saisieConfirmation, setSaisieConfirmation] = useState('')
  const [erreur, setErreur] = useState('')
  const [envoi, setEnvoi] = useState(false)

  useEffect(() => {
    if (!ouverte) return
    setType(initial?.type ?? 'compte')
    setCompteSourceId(initial?.compteSourceId ?? '')
    setCarnetId(initial?.carnetId ?? '')
    setCycle(initial?.cycle ?? 0)
    setNbCarreaux('1')
    setCompteDestId('')
    setMontant('')
    setMotif('')
    setEtape('saisie')
    setSaisieConfirmation('')
    setErreur('')
    // Réinitialise seulement à l'ouverture (initial peut être recréé à chaque rendu du parent)
  }, [ouverte]) // eslint-disable-line react-hooks/exhaustive-deps

  const peutAutreClient = estAdmin || estChefAgence
  const clients = useMemo(() => new Map(data.clients.map((c) => [c.id, c])), [data.clients])
  // Admin : toutes agences ; chef / caissier : leur agence uniquement
  const agenceUtilisateur = estAdmin ? null : (employeConnecte?.agenceId ?? '')
  const dansMonAgence = (clientId: string) =>
    agenceUtilisateur === null || clients.get(clientId)?.agenceId === agenceUtilisateur

  const comptesSource = useMemo(
    () => data.comptes.filter((c) => !c.verrouille && c.solde > 0 && dansMonAgence(c.clientId)),
    [data.comptes, clients, agenceUtilisateur], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const carnetsSource = useMemo(
    () =>
      data.carnets.filter(
        (k) =>
          k.actif &&
          !k.verrouille &&
          dansMonAgence(k.clientId) &&
          eligibiliteRetraitCarnet(k, data.mises).autorise &&
          situationsCycles(k, data.mises, data.transactions).some((et) => et.retirables > 0),
      ),
    [data.carnets, data.mises, data.transactions, clients, agenceUtilisateur], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const compteSource = data.comptes.find((c) => c.id === compteSourceId)
  const carnet = data.carnets.find((k) => k.id === carnetId)
  const cyclesDispo = useMemo(
    () => (carnet ? situationsCycles(carnet, data.mises, data.transactions).filter((et) => et.retirables > 0) : []),
    [carnet, data.mises, data.transactions],
  )
  const etatCycle = cyclesDispo.find((et) => et.cycle === cycle)

  // Cycle par défaut : celui demandé, sinon le premier disponible
  useEffect(() => {
    if (carnet && !cyclesDispo.some((et) => et.cycle === cycle)) setCycle(cyclesDispo[0]?.cycle ?? 0)
  }, [carnet, cyclesDispo, cycle])

  const clientSourceId = type === 'compte' ? compteSource?.clientId : carnet?.clientId
  const comptesDest = useMemo(
    () =>
      data.comptes.filter(
        (c) =>
          !c.verrouille &&
          c.id !== compteSourceId &&
          dansMonAgence(c.clientId) &&
          (peutAutreClient || !clientSourceId || c.clientId === clientSourceId),
      ),
    [data.comptes, compteSourceId, clientSourceId, peutAutreClient, clients, agenceUtilisateur], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const compteDest = comptesDest.find((c) => c.id === compteDestId)

  const n = Number(nbCarreaux)
  const montantTransfert = type === 'compte' ? Number(montant) : carnet && Number.isInteger(n) ? carnet.mise * n : 0
  const clientSource = clientSourceId ? clients.get(clientSourceId) : undefined
  const clientDest = compteDest ? clients.get(compteDest.clientId) : undefined
  const autreClient = !!clientSource && !!clientDest && clientSource.id !== clientDest.id
  const memeIdentite =
    autreClient &&
    (normaliser(nomClient(clientSource)) === normaliser(nomClient(clientDest)) ||
      (!!clientSource!.telephone && normaliser(clientSource!.telephone) === normaliser(clientDest!.telephone)))

  const libelleCompte = (c: Compte) => `${c.numero} — ${natureCompte(c)} — ${nomClient(clients.get(c.clientId))}`
  const detailCompte = (c: Compte) => {
    const cl = clients.get(c.clientId)
    return `Solde ${formatMontant(c.solde)}${cl?.telephone ? ` · ${cl.telephone}` : ''}${cl?.codeClientBanque ? ` · client ${cl.codeClientBanque}` : ''}`
  }
  const rechercheCompte = (c: Compte) => {
    const cl = clients.get(c.clientId)
    return `${c.numero} ${cl?.nom} ${cl?.prenom} ${cl?.telephone ?? ''} ${cl?.codeClientBanque ?? ''}`
  }
  const libelleCarnet = (k: CarnetTontine) => `Carnet ${k.numero} — ${nomClient(clients.get(k.clientId))}`
  const detailCarnet = (k: CarnetTontine) => `Mise ${formatMontant(k.mise)}${clients.get(k.clientId)?.telephone ? ` · ${clients.get(k.clientId)!.telephone}` : ''}`
  const rechercheCarnet = (k: CarnetTontine) => {
    const cl = clients.get(k.clientId)
    return `${k.numero} ${cl?.nom} ${cl?.prenom} ${cl?.telephone ?? ''}`
  }

  const verifierSaisie = (): string | null => {
    if (type === 'compte') {
      if (!compteSource) return 'Choisissez le compte source.'
      if (!Number.isFinite(montantTransfert) || montantTransfert <= 0) return 'Montant invalide.'
      if (montantTransfert > compteSource.solde) return 'Solde insuffisant sur le compte source.'
    } else {
      if (!carnet) return 'Choisissez le carnet source.'
      if (!etatCycle) return 'Choisissez le cycle à débiter.'
      if (!Number.isInteger(n) || n <= 0) return 'Nombre de mises invalide.'
      if (n > etatCycle.retirables) return `Au maximum ${etatCycle.retirables} mise(s) sur ce cycle.`
    }
    if (!compteDest) return 'Choisissez le compte destinataire.'
    if (autreClient && !peutAutreClient)
      return "Transfert vers un autre client : réservé à l'administrateur ou au chef d'agence."
    return null
  }

  const passerConfirmation = () => {
    const err = verifierSaisie()
    setErreur(err ?? '')
    if (!err) {
      setSaisieConfirmation('')
      setEtape('confirmation')
    }
  }

  const valider = async () => {
    if (normaliser(saisieConfirmation) !== MOT_CONFIRMATION || !compteDest) return
    setEnvoi(true)
    setErreur('')
    const motifPropre = motif.trim() || undefined
    const res =
      type === 'compte'
        ? await transfertCompteCompte(compteSourceId, compteDest.id, montantTransfert, motifPropre)
        : await transfertTontineCompte(carnetId, cycle, n, compteDest.id, motifPropre)
    setEnvoi(false)
    if (res) {
      setErreur(res)
      setEtape('saisie')
      await alerter('Transfert échoué', res)
      return
    }
    onFermer()
    await alerter(
      'Transfert effectué',
      `${formatMontant(montantTransfert)} transférés vers ${compteDest.numero} (${nomClient(clientDest)}).\nLa caisse ne bouge pas.`,
    )
  }

  return (
    <Modale titre={etape === 'saisie' ? 'Transfert' : 'Confirmer le transfert'} ouverte={ouverte} onFermer={onFermer} large>
      {etape === 'saisie' ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            passerConfirmation()
          }}
        >
          <div>
            <label className="label">Type de transfert *</label>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ['compte', 'Compte → compte'],
                  ['tontine', 'Tontine → compte'],
                ] as const
              ).map(([val, lib]) => (
                <button
                  key={val}
                  type="button"
                  className={type === val ? 'btn-primary' : 'btn-secondary'}
                  onClick={() => {
                    setType(val)
                    setCompteDestId('')
                    setErreur('')
                  }}
                >
                  {lib}
                </button>
              ))}
            </div>
          </div>

          {type === 'compte' ? (
            <div className="space-y-3">
              <div>
                <label className="label">Compte source *</label>
                <Selecteur
                  options={comptesSource}
                  valeur={compteSourceId}
                  onChoisir={(id) => {
                    setCompteSourceId(id)
                    setCompteDestId('')
                  }}
                  libelle={libelleCompte}
                  detail={detailCompte}
                  texteRecherche={rechercheCompte}
                  placeholder="N° de compte, nom, téléphone…"
                  vide="Aucun compte déverrouillé avec un solde disponible."
                />
              </div>
              <div>
                <label className="label">Montant (FCFA) *</label>
                <input
                  type="number"
                  min={1}
                  className="input"
                  value={montant}
                  onChange={(e) => setMontant(e.target.value)}
                  placeholder={compteSource ? `Au maximum ${formatMontant(compteSource.solde)}` : ''}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="label">Carnet source *</label>
                <Selecteur
                  options={carnetsSource}
                  valeur={carnetId}
                  onChoisir={(id) => {
                    setCarnetId(id)
                    setCompteDestId('')
                  }}
                  libelle={libelleCarnet}
                  detail={detailCarnet}
                  texteRecherche={rechercheCarnet}
                  placeholder="N° de carnet, nom, téléphone…"
                  vide="Aucun carnet avec des mises disponibles au retrait."
                />
              </div>
              {carnet && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Cycle *</label>
                    <select className="input" value={cycle} onChange={(e) => setCycle(Number(e.target.value))}>
                      {cyclesDispo.map((et) => (
                        <option key={et.cycle} value={et.cycle}>
                          {et.moisLabel} — {et.retirables} mise(s) dispo
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">Nombre de mises *</label>
                    <input
                      type="number"
                      min={1}
                      max={etatCycle?.retirables}
                      className="input"
                      value={nbCarreaux}
                      onChange={(e) => setNbCarreaux(e.target.value)}
                    />
                    <p className="mt-1 text-xs text-slate-500">= {formatMontant(montantTransfert || 0)}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          <div>
            <label className="label">Compte destinataire *</label>
            <Selecteur
              options={comptesDest}
              valeur={compteDestId}
              onChoisir={setCompteDestId}
              libelle={libelleCompte}
              detail={detailCompte}
              texteRecherche={rechercheCompte}
              placeholder="N° de compte, nom, téléphone…"
              vide={
                peutAutreClient
                  ? 'Aucun compte déverrouillé disponible.'
                  : 'Ce client n’a pas d’autre compte déverrouillé. Transfert vers un autre client : réservé à l’administrateur ou au chef d’agence.'
              }
            />
            {!peutAutreClient && (
              <p className="mt-1 text-xs text-slate-500">
                Seuls les comptes du même client sont proposés (autre client : admin ou chef d’agence).
              </p>
            )}
          </div>

          {autreClient && (
            <div className="flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                Transfert entre <strong>deux clients différents</strong> : {nomClient(clientSource)} →{' '}
                {nomClient(clientDest)}.
                {memeIdentite && (
                  <div className="mt-1">
                    Même nom ou même téléphone mais <strong>fiches distinctes</strong> : possible doublon de client.
                  </div>
                )}
              </div>
            </div>
          )}

          <div>
            <label className="label">Motif (facultatif)</label>
            <input
              className="input"
              maxLength={200}
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
              placeholder="Ex. virement demandé par le client"
            />
          </div>

          {erreur && <p className="text-sm font-medium text-rose-600">{erreur}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={onFermer}>
              Annuler
            </button>
            <button type="submit" className="btn-primary">
              <ArrowRightLeft className="h-4 w-4" />
              Continuer
            </button>
          </div>
        </form>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            void valider()
          }}
        >
          <div className="text-center">
            <div className="text-xs uppercase tracking-wide text-slate-500">Montant transféré</div>
            <div className="text-2xl font-bold text-sky-700">{formatMontant(montantTransfert)}</div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {type === 'compte' && compteSource ? (
              <LigneRecap
                titre="Source"
                lignes={[
                  `${compteSource.numero} (${natureCompte(compteSource)})`,
                  nomClient(clientSource),
                  `Solde : ${formatMontant(compteSource.solde)} → ${formatMontant(compteSource.solde - montantTransfert)}`,
                ]}
              />
            ) : (
              carnet &&
              etatCycle && (
                <LigneRecap
                  titre="Source"
                  lignes={[
                    `Carnet ${carnet.numero} — ${etatCycle.moisLabel}`,
                    nomClient(clientSource),
                    `${n} mise(s) de ${formatMontant(carnet.mise)} — reste ${etatCycle.retirables - n} dispo`,
                  ]}
                />
              )
            )}
            {compteDest && (
              <LigneRecap
                titre="Destination"
                lignes={[
                  `${compteDest.numero} (${natureCompte(compteDest)})`,
                  nomClient(clientDest),
                  `Solde : ${formatMontant(compteDest.solde)} → ${formatMontant(compteDest.solde + montantTransfert)}`,
                ]}
              />
            )}
          </div>
          {motif.trim() && <p className="text-sm text-slate-600">Motif : {motif.trim()}</p>}
          {autreClient && (
            <p className="flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-sm font-medium text-amber-900 ring-1 ring-amber-200">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Attention : le bénéficiaire n’est pas le titulaire de la source.
            </p>
          )}
          <div>
            <label className="label">
              Tapez <strong>{MOT_CONFIRMATION}</strong> pour valider
            </label>
            <input
              className="input"
              autoFocus
              value={saisieConfirmation}
              onChange={(e) => setSaisieConfirmation(e.target.value)}
              placeholder={MOT_CONFIRMATION}
            />
          </div>
          {erreur && <p className="text-sm font-medium text-rose-600">{erreur}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setEtape('saisie')} disabled={envoi}>
              Retour
            </button>
            <button
              type="submit"
              className="btn-primary disabled:cursor-not-allowed disabled:bg-slate-300"
              disabled={envoi || normaliser(saisieConfirmation) !== MOT_CONFIRMATION}
            >
              {envoi ? 'Transfert…' : 'Valider le transfert'}
            </button>
          </div>
        </form>
      )}
    </Modale>
  )
}
