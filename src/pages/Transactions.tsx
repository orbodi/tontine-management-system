import { useMemo, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, Download, Pencil, Search } from 'lucide-react'
import { MODULE_CREDITS_ACTIF } from '../config'
import { useStore } from '../store'
import type { Transaction, TypeTransaction } from '../types'
import { estOperationCaisse, LIBELLES_TYPE, TYPES_SORTIE } from '../metier'
import { exporterCsv, formatDateHeure, formatMontant } from '../utils'
import { EnTetePage, EtatVide, Modale } from '../components/ui'
import { useConfirmation } from '../components/Confirmation'

const TYPES_MODIFIABLES = new Set<TypeTransaction>([
  'depot_compte',
  'retrait_compte',
  'mise_tontine',
  'retrait_tontine',
  'commission_tontine',
  'complement_mise',
  'remboursement_credit',
  'part_sociale',
  'droit_adhesion',
])

export default function Transactions() {
  const {
    data,
    employeConnecte,
    estAdmin,
    estChefAgence,
    estCaissier,
    agenceFiltreOperations,
    corrigerMontantTransaction,
  } = useStore()
  const { alerter } = useConfirmation()
  const [recherche, setRecherche] = useState('')
  const [typeFiltre, setTypeFiltre] = useState<'tous' | TypeTransaction>('tous')
  const [dateDebut, setDateDebut] = useState('')
  const [dateFin, setDateFin] = useState('')
  const [txEdition, setTxEdition] = useState<Transaction | null>(null)
  const [nouveauMontant, setNouveauMontant] = useState('')
  const [motif, setMotif] = useState('')
  const [erreur, setErreur] = useState('')

  const perimetre =
    estAdmin
      ? 'toutes les caisses'
      : estChefAgence
        ? 'caisses de votre agence'
        : 'vos opérations uniquement'

  const peutCorriger = (t: Transaction) => {
    if (!TYPES_MODIFIABLES.has(t.type)) return false
    if (estAdmin) return true
    if ((estChefAgence || estCaissier) && employeConnecte && t.operateurId === employeConnecte.id) {
      return true
    }
    return false
  }

  const transactionsFiltrees = useMemo(() => {
    const q = recherche.trim().toLowerCase()
    return data.transactions.filter((t) => {
      // Périmètre caisse selon le rôle
      if (!estOperationCaisse(t.type)) return false
      if (estCaissier) {
        if (!employeConnecte || t.operateurId !== employeConnecte.id) return false
      } else if (estChefAgence && agenceFiltreOperations) {
        if (t.agenceId !== agenceFiltreOperations) return false
      } else if (!estAdmin) {
        if (!employeConnecte || t.operateurId !== employeConnecte.id) return false
      }
      if (typeFiltre !== 'tous' && t.type !== typeFiltre) return false
      if (dateDebut && t.date < dateDebut) return false
      if (dateFin && t.date > dateFin + 'T23:59:59') return false
      if (q && !t.description.toLowerCase().includes(q) && !t.operateur.toLowerCase().includes(q)) {
        return false
      }
      return true
    })
  }, [
    data.transactions,
    recherche,
    typeFiltre,
    dateDebut,
    dateFin,
    estAdmin,
    estChefAgence,
    estCaissier,
    agenceFiltreOperations,
    employeConnecte,
  ])

  const totaux = useMemo(() => {
    let entrees = 0
    let sorties = 0
    transactionsFiltrees.forEach((t) => {
      if (TYPES_SORTIE.includes(t.type)) sorties += t.montant
      else entrees += t.montant
    })
    return { entrees, sorties }
  }, [transactionsFiltrees])

  const exporter = () => {
    exporterCsv(`transactions_${new Date().toISOString().slice(0, 10)}.csv`, [
      ['Date', 'Type', 'Description', 'Montant (FCFA)', 'Sens', 'Opérateur'],
      ...transactionsFiltrees.map((t) => [
        formatDateHeure(t.date),
        LIBELLES_TYPE[t.type],
        t.description,
        t.montant,
        TYPES_SORTIE.includes(t.type) ? 'Sortie' : 'Entrée',
        t.operateur,
      ]),
    ])
  }

  const ouvrirCorrection = (t: Transaction) => {
    setTxEdition(t)
    setNouveauMontant(String(t.montant))
    setMotif('')
    setErreur('')
  }

  const validerCorrection = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!txEdition) return
    const montant = Number(nouveauMontant)
    if (!Number.isFinite(montant) || montant <= 0) {
      setErreur('Montant invalide.')
      return
    }
    if (montant === txEdition.montant) {
      setErreur('Saisissez un montant différent.')
      return
    }
    const err = await corrigerMontantTransaction(txEdition.id, montant, motif.trim() || undefined)
    if (err) {
      setErreur(err)
      await alerter('Correction impossible', err)
      return
    }
    setTxEdition(null)
    const estTontine = [
      'mise_tontine',
      'commission_tontine',
      'retrait_tontine',
      'complement_mise',
    ].includes(txEdition.type)
    await alerter(
      'Transaction corrigée',
      `Montant passé de ${formatMontant(txEdition.montant)} à ${formatMontant(montant)}.\n` +
        (estTontine
          ? 'Les mises / carreaux du carnet et le cycle ont été recalculés.'
          : 'Le compte concerné et la caisse ont été recalculés.'),
    )
  }

  return (
    <div>
      <EnTetePage
        titre="Transactions"
        sousTitre={`${transactionsFiltrees.length} opération${transactionsFiltrees.length > 1 ? 's' : ''} (${perimetre}) — entrées : ${formatMontant(totaux.entrees)} — sorties : ${formatMontant(totaux.sorties)}`}
        action={
          <button className="btn-secondary" onClick={exporter} disabled={transactionsFiltrees.length === 0}>
            <Download className="h-4 w-4" />
            Exporter (Excel)
          </button>
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-10"
            placeholder="Rechercher…"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
          />
        </div>
        <select className="input" value={typeFiltre} onChange={(e) => setTypeFiltre(e.target.value as typeof typeFiltre)}>
          <option value="tous">Tous les types</option>
          {Object.entries(LIBELLES_TYPE)
            .filter(
              ([valeur]) =>
                MODULE_CREDITS_ACTIF || (valeur !== 'octroi_credit' && valeur !== 'remboursement_credit'),
            )
            .map(([valeur, label]) => (
              <option key={valeur} value={valeur}>
                {label}
              </option>
            ))}
        </select>
        <input className="input" type="date" value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} title="Date de début" />
        <input className="input" type="date" value={dateFin} onChange={(e) => setDateFin(e.target.value)} title="Date de fin" />
      </div>

      {transactionsFiltrees.length === 0 ? (
        <EtatVide titre="Aucune transaction" description="Modifiez vos filtres." />
      ) : (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full min-w-[780px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3.5">Date</th>
                <th className="px-5 py-3.5">Type</th>
                <th className="px-5 py-3.5">Description</th>
                <th className="px-5 py-3.5">Opérateur</th>
                <th className="px-5 py-3.5 text-right">Montant</th>
                <th className="px-5 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {transactionsFiltrees.map((t) => {
                const sortie = TYPES_SORTIE.includes(t.type)
                return (
                  <tr key={t.id} className="transition hover:bg-slate-50">
                    <td className="whitespace-nowrap px-5 py-3 text-slate-600">{formatDateHeure(t.date)}</td>
                    <td className="px-5 py-3">
                      <span className="badge bg-slate-100 text-slate-600">{LIBELLES_TYPE[t.type]}</span>
                    </td>
                    <td className="max-w-md truncate px-5 py-3 text-slate-800">{t.description}</td>
                    <td className="px-5 py-3 text-slate-600">{t.operateur}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-right">
                      <span
                        className={`inline-flex items-center gap-1 font-bold ${sortie ? 'text-rose-600' : 'text-emerald-600'}`}
                      >
                        {sortie ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                        {sortie ? '-' : '+'}
                        {formatMontant(t.montant)}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      {peutCorriger(t) && (
                        <button
                          type="button"
                          className="btn-secondary !px-2.5 !py-1.5 text-xs"
                          title="Corriger le montant"
                          onClick={() => ouvrirCorrection(t)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Corriger
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modale
        titre="Corriger le montant"
        ouverte={txEdition !== null}
        onFermer={() => setTxEdition(null)}
      >
        {txEdition && (
          <form onSubmit={validerCorrection} className="space-y-4">
            <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
              <p>
                <span className="text-slate-500">Type :</span> {LIBELLES_TYPE[txEdition.type]}
              </p>
              <p className="mt-1 truncate">
                <span className="text-slate-500">Opération :</span> {txEdition.description}
              </p>
              <p className="mt-1">
                Montant actuel : <strong>{formatMontant(txEdition.montant)}</strong>
              </p>
            </div>
            <div>
              <label className="label">Nouveau montant (FCFA) *</label>
              <input
                className="input"
                type="number"
                min={1}
                required
                autoFocus
                value={nouveauMontant}
                onChange={(e) => setNouveauMontant(e.target.value)}
              />
              <p className="mt-1 text-xs text-slate-400">
                Ex. corriger 30 000 en 3 000. La caisse et les soldes liés sont recalculés.
              </p>
            </div>
            <div>
              <label className="label">Motif (facultatif)</label>
              <input
                className="input"
                value={motif}
                onChange={(e) => setMotif(e.target.value)}
                placeholder="Erreur de saisie…"
              />
            </div>
            {erreur && <p className="text-sm font-medium text-rose-600">{erreur}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setTxEdition(null)}>
                Annuler
              </button>
              <button type="submit" className="btn-primary">
                <Pencil className="h-4 w-4" />
                Enregistrer
              </button>
            </div>
          </form>
        )}
      </Modale>
    </div>
  )
}
