import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { comptaApi, type ComptaOverview } from '../../api/comptabilite'
import { EnTetePage, EtatVide, Modale } from '../../components/ui'
import { RechercheCompte } from '../../components/RechercheCompte'
import { formatMontant } from '../../utils'
import { useStore } from '../../store'
import { useConfirmation } from '../../components/Confirmation'
import type { CompteComptable, EcritureComptable, JournalComptable } from '../../types'

type LigneDraft = { compteNumero: string; debit: number; credit: number; libelle: string }

const LIBELLES_SOURCE: Record<string, string> = {
  manuel: 'Saisie',
  ouverture: 'Ouverture',
  anouveaux: 'À-nouveaux',
  auto: 'Auto',
}

const COMPTE_JOURNAL: Record<string, string> = {
  CAISSE: '571',
  BANQUE: '521',
}

function formatJour(yyyyMmDd: string) {
  const [y, m, d] = yyyyMmDd.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString('fr-FR')
}

function clampDate(iso: string, debut: string, fin: string) {
  if (iso < debut) return debut
  if (iso > fin) return fin
  return iso
}

function lignesDefaut(code: string): LigneDraft[] {
  if (code === 'ACHAT') {
    return [
      { compteNumero: '', debit: 0, credit: 0, libelle: '' },
      { compteNumero: '401', debit: 0, credit: 0, libelle: '' },
    ]
  }
  const premier = COMPTE_JOURNAL[code] ?? ''
  return [
    { compteNumero: premier, debit: 0, credit: 0, libelle: '' },
    { compteNumero: '', debit: 0, credit: 0, libelle: '' },
  ]
}

export default function JournauxPage() {
  const { estAdmin, aDroit } = useStore()
  const { alerter } = useConfirmation()
  const [onglet, setOnglet] = useState('CAISSE')
  const [ecritures, setEcritures] = useState<EcritureComptable[]>([])
  const [journaux, setJournaux] = useState<JournalComptable[]>([])
  const [plan, setPlan] = useState<CompteComptable[]>([])
  const [overview, setOverview] = useState<ComptaOverview | null>(null)
  const [detail, setDetail] = useState<EcritureComptable | null>(null)
  const [modale, setModale] = useState(false)
  const [modaleJournal, setModaleJournal] = useState(false)
  const [codeJournal, setCodeJournal] = useState('')
  const [libelleJournal, setLibelleJournal] = useState('')
  const [dateDebut, setDateDebut] = useState('')
  const [dateFin, setDateFin] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [libelle, setLibelle] = useState('')
  const [lignes, setLignes] = useState<LigneDraft[]>(lignesDefaut('CAISSE'))
  const [chargement, setChargement] = useState(true)
  const peutEcrire = estAdmin || aDroit('gerer_comptabilite')

  const exercice = overview?.exerciceOuvert ?? null
  const journauxActifs = journaux.filter((j) => j.actif)

  const comptesSaisie = useMemo(
    () => plan.filter((c) => c.actif && c.numero.length >= 3),
    [plan],
  )

  const charger = async () => {
    try {
      const [e, j, p, ov] = await Promise.all([
        comptaApi.ecritures({
          journal_code: onglet,
          date_debut: dateDebut || undefined,
          date_fin: dateFin || undefined,
        }),
        comptaApi.journaux(),
        comptaApi.plan({ actifs_seulement: true }),
        comptaApi.overview(),
      ])
      setEcritures(e)
      setJournaux(j)
      setPlan(p)
      setOverview(ov)
    } catch (err) {
      await alerter('Erreur', err instanceof Error ? err.message : 'Chargement impossible')
    } finally {
      setChargement(false)
    }
  }

  useEffect(() => {
    void charger()
  }, [onglet, dateDebut, dateFin])

  const totauxListe = useMemo(() => {
    let debit = 0
    let credit = 0
    for (const e of ecritures) {
      for (const l of e.lignes) {
        debit += l.debit || 0
        credit += l.credit || 0
      }
    }
    return { debit, credit }
  }, [ecritures])

  const prefixeTreso = onglet === 'CAISSE' ? '57' : onglet === 'BANQUE' ? '52' : null
  const treso = useMemo(() => {
    if (!prefixeTreso) return null
    let recettes = 0
    let depenses = 0
    for (const e of ecritures) {
      for (const l of e.lignes) {
        if (!(l.compteNumero || '').startsWith(prefixeTreso)) continue
        recettes += l.debit || 0
        depenses += l.credit || 0
      }
    }
    return { recettes, depenses, solde: recettes - depenses }
  }, [ecritures, prefixeTreso])

  const totauxSaisie = useMemo(() => {
    const debit = lignes.reduce((s, l) => s + (Number(l.debit) || 0), 0)
    const credit = lignes.reduce((s, l) => s + (Number(l.credit) || 0), 0)
    return { debit, credit, ok: Math.abs(debit - credit) < 0.005 && debit > 0 }
  }, [lignes])

  const creerJournal = async (ev: React.FormEvent) => {
    ev.preventDefault()
    try {
      const res = await comptaApi.creerJournal({ code: codeJournal, libelle: libelleJournal })
      setModaleJournal(false)
      setCodeJournal('')
      setLibelleJournal('')
      setOnglet(res.journal.code)
      await charger()
    } catch (err) {
      await alerter('Impossible', err instanceof Error ? err.message : 'Erreur')
    }
  }

  const ouvrirSaisie = () => {
    const today = new Date().toISOString().slice(0, 10)
    setDate(exercice ? clampDate(today, exercice.dateDebut, exercice.dateFin) : today)
    setLibelle('')
    setLignes(lignesDefaut(onglet))
    setModale(true)
  }

  const majLigne = (i: number, patch: Partial<LigneDraft>) => {
    setLignes(lignes.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  }

  const creer = async (ev: React.FormEvent) => {
    ev.preventDefault()
    const aPoster = lignes.filter((l) => l.compteNumero && (l.debit > 0 || l.credit > 0))
    if (!totauxSaisie.ok) {
      await alerter('Déséquilibre', 'Le total des débits doit égaler le total des crédits, et être supérieur à zéro.')
      return
    }
    try {
      await comptaApi.creerEcriture({
        journalCode: onglet,
        date,
        libelle,
        lignes: aPoster,
      })
      setModale(false)
      await charger()
    } catch (err) {
      await alerter('Impossible', err instanceof Error ? err.message : 'Erreur')
    }
  }

  if (chargement) {
    return (
      <div>
        <Link to="/comptabilite" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700">
          <ArrowLeft className="h-4 w-4" /> Comptabilité
        </Link>
        <p className="text-sm text-slate-500">Chargement…</p>
      </div>
    )
  }

  if (!exercice) {
    return (
      <div>
        <Link to="/comptabilite" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700">
          <ArrowLeft className="h-4 w-4" /> Comptabilité
        </Link>
        <EnTetePage titre="Journaux" sousTitre="Enregistrement chronologique des opérations" />
        <EtatVide
          titre="Aucun exercice ouvert"
          description="Ouvrez un exercice (et validez le bilan initial) avant de passer des écritures."
        />
        <Link to="/comptabilite" className="mt-4 inline-block text-sm font-medium text-brand-700 hover:underline">
          Retour à la comptabilité
        </Link>
      </div>
    )
  }

  const journalCourant = journauxActifs.find((j) => j.code === onglet)

  return (
    <div>
      <Link to="/comptabilite" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700">
        <ArrowLeft className="h-4 w-4" /> Comptabilité
      </Link>
      <EnTetePage
        titre="Journaux comptables"
        sousTitre={journalCourant?.libelle ?? 'Saisie chronologique — partie double'}
        action={
          peutEcrire ? (
            <button type="button" className="btn-primary" onClick={ouvrirSaisie}>
              <Plus className="h-4 w-4" /> Écriture
            </button>
          ) : undefined
        }
      />

      <p className="mb-6 max-w-3xl text-sm text-slate-600">
        Chaque opération se saisit dans le journal adapté. Débit = crédit. La pièce est numérotée automatiquement (
        {onglet}-{exercice.annee}-0001…).
      </p>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-2">
          {journauxActifs.map((j) => (
            <button
              key={j.code}
              type="button"
              onClick={() => setOnglet(j.code)}
              className={`rounded-xl px-3.5 py-2 text-sm font-medium ${
                onglet === j.code ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'
              }`}
            >
              {j.code}
            </button>
          ))}
          {peutEcrire && (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-xl bg-white px-3 py-2 text-sm font-medium text-brand-700 ring-1 ring-slate-200 hover:ring-brand-400"
              onClick={() => {
                setCodeJournal('')
                setLibelleJournal('')
                setModaleJournal(true)
              }}
            >
              <Plus className="h-4 w-4" /> Journal
            </button>
          )}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input
            type="date"
            className="input w-auto"
            min={exercice.dateDebut}
            max={exercice.dateFin}
            value={dateDebut}
            onChange={(e) => setDateDebut(e.target.value)}
            title="Du"
          />
          <span className="text-xs text-slate-400">→</span>
          <input
            type="date"
            className="input w-auto"
            min={exercice.dateDebut}
            max={exercice.dateFin}
            value={dateFin}
            onChange={(e) => setDateFin(e.target.value)}
            title="Au"
          />
          {(dateDebut || dateFin) && (
            <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => { setDateDebut(''); setDateFin('') }}>
              Tout l’exercice
            </button>
          )}
        </div>
      </div>

      {treso && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              {onglet === 'CAISSE' ? 'Recettes' : 'Encaissements'}
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-emerald-700">{formatMontant(treso.recettes)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              {onglet === 'CAISSE' ? 'Dépenses' : 'Décaissements'}
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-rose-700">{formatMontant(treso.depenses)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Solde des mouvements</p>
            <p className={`mt-1 text-lg font-semibold tabular-nums ${treso.solde >= 0 ? 'text-slate-900' : 'text-rose-700'}`}>
              {formatMontant(treso.solde)}
            </p>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Pièce</th>
              <th className="px-4 py-3">Compte</th>
              <th className="px-4 py-3">Libellé</th>
              <th className="px-4 py-3 text-right">Débit</th>
              <th className="px-4 py-3 text-right">Crédit</th>
            </tr>
          </thead>
          <tbody>
            {ecritures.flatMap((e) => {
              const ligs = [...e.lignes].sort((a, b) => (b.debit || 0) - (a.debit || 0) || (a.credit || 0) - (b.credit || 0))
              return ligs.map((l, i) => (
                <tr
                  key={l.id}
                  className={`cursor-pointer hover:bg-slate-50 ${i === 0 ? 'border-t border-slate-200' : 'border-t border-slate-50'}`}
                  onClick={() => setDetail(e)}
                >
                  <td className="whitespace-nowrap px-4 py-2">{i === 0 ? formatJour(e.date) : ''}</td>
                  <td className="px-4 py-2 font-mono text-xs">{i === 0 ? e.numeroPiece : ''}</td>
                  <td className="px-4 py-2">
                    <span className="font-mono text-xs font-semibold text-slate-900">{l.compteNumero}</span>
                    {l.intitule ? <span className="ml-2 text-slate-500">{l.intitule}</span> : null}
                  </td>
                  <td className="px-4 py-2 text-slate-700">{i === 0 ? e.libelle : l.libelle || ''}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{l.debit ? formatMontant(l.debit) : ''}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{l.credit ? formatMontant(l.credit) : ''}</td>
                </tr>
              ))
            })}
            {ecritures.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  Aucune écriture dans ce journal.
                </td>
              </tr>
            )}
          </tbody>
          {ecritures.length > 0 && (
            <tfoot>
              <tr className="border-t border-slate-200 bg-slate-50 text-sm font-semibold">
                <td className="px-4 py-3" colSpan={4}>
                  Total ({ecritures.length} pièce{ecritures.length > 1 ? 's' : ''})
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{formatMontant(totauxListe.debit)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatMontant(totauxListe.credit)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <Modale titre="Détail de l’écriture" ouverte={!!detail} onFermer={() => setDetail(null)} large>
        {detail && (
          <div className="space-y-4 text-sm">
            <div>
              <p className="font-mono text-xs text-slate-500">{detail.numeroPiece}</p>
              <p className="mt-1 font-semibold text-slate-900">{detail.libelle}</p>
              <p className="mt-1 text-slate-500">
                {formatJour(detail.date)} · {LIBELLES_SOURCE[detail.source] ?? detail.source}
                {detail.auteurNom ? ` · ${detail.auteurNom}` : ''}
              </p>
            </div>
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-400">
                  <th className="py-1">Compte</th>
                  <th className="py-1 text-right">Débit</th>
                  <th className="py-1 text-right">Crédit</th>
                </tr>
              </thead>
              <tbody>
                {detail.lignes.map((l) => (
                  <tr key={l.id} className="border-t border-slate-100">
                    <td className="py-2">
                      <span className="font-mono text-xs font-semibold">{l.compteNumero}</span>
                      <span className="ml-2 text-slate-600">{l.intitule || l.libelle || ''}</span>
                    </td>
                    <td className="py-2 text-right tabular-nums">{l.debit ? formatMontant(l.debit) : '—'}</td>
                    <td className="py-2 text-right tabular-nums">{l.credit ? formatMontant(l.credit) : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 font-semibold">
                  <td className="py-2">Totaux</td>
                  <td className="py-2 text-right tabular-nums">{formatMontant(detail.totalDebit)}</td>
                  <td className="py-2 text-right tabular-nums">{formatMontant(detail.totalCredit)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Modale>

      <Modale
        titre={`Nouvelle écriture — ${journalCourant?.libelle ?? onglet}`}
        ouverte={modale}
        onFermer={() => setModale(false)}
        xl
      >
        <form className="space-y-4" onSubmit={(e) => void creer(e)}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Date</label>
              <input
                type="date"
                className="input"
                min={exercice.dateDebut}
                max={exercice.dateFin}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label">Libellé</label>
              <input
                className="input"
                value={libelle}
                onChange={(e) => setLibelle(e.target.value)}
                placeholder="Ex. Dépôt en banque, loyer janvier…"
                required
              />
            </div>
          </div>

          <div className="overflow-visible">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-400">
                  <th className="pb-2">Compte</th>
                  <th className="w-28 pb-2 text-right">Débit</th>
                  <th className="w-28 pb-2 text-right">Crédit</th>
                  <th className="w-10 pb-2" />
                </tr>
              </thead>
              <tbody>
                {lignes.map((lig, idx) => (
                  <tr key={idx}>
                    <td className="py-1 pr-2">
                      <RechercheCompte
                        comptes={comptesSaisie}
                        compteNumero={lig.compteNumero || undefined}
                        onChoisir={(c) => majLigne(idx, { compteNumero: c.numero })}
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        className="input text-right"
                        placeholder="0"
                        value={lig.debit || ''}
                        onChange={(e) =>
                          majLigne(idx, { debit: Number(e.target.value) || 0, credit: 0 })
                        }
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        className="input text-right"
                        placeholder="0"
                        value={lig.credit || ''}
                        onChange={(e) =>
                          majLigne(idx, { credit: Number(e.target.value) || 0, debit: 0 })
                        }
                      />
                    </td>
                    <td className="py-1">
                      {lignes.length > 2 && (
                        <button
                          type="button"
                          className="text-slate-400 hover:text-rose-600"
                          onClick={() => setLignes(lignes.filter((_, j) => j !== idx))}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            className="text-sm font-medium text-brand-700 hover:underline"
            onClick={() => setLignes([...lignes, { compteNumero: '', debit: 0, credit: 0, libelle: '' }])}
          >
            + Ajouter une ligne
          </button>

          <div
            className={`flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-3 text-sm ${
              totauxSaisie.ok
                ? 'bg-emerald-50 text-emerald-800'
                : 'bg-slate-50 text-slate-700'
            }`}
          >
            <span>
              Débit {formatMontant(totauxSaisie.debit)} · Crédit {formatMontant(totauxSaisie.credit)}
            </span>
            <span>
              {totauxSaisie.ok
                ? 'Équilibré'
                : `Écart ${formatMontant(Math.abs(totauxSaisie.debit - totauxSaisie.credit))}`}
            </span>
          </div>

          <button type="submit" className="btn-primary w-full" disabled={!totauxSaisie.ok || !libelle.trim()}>
            Enregistrer l’écriture
          </button>
        </form>
      </Modale>

      <Modale titre="Nouveau journal" ouverte={modaleJournal} onFermer={() => setModaleJournal(false)}>
        <form className="space-y-4" onSubmit={(e) => void creerJournal(e)}>
          <div>
            <label className="label">Code</label>
            <input
              className="input font-mono uppercase"
              value={codeJournal}
              maxLength={12}
              placeholder="Ex. VENTES, PAIE"
              onChange={(e) => setCodeJournal(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              required
            />
            <p className="mt-1 text-xs text-slate-500">2 à 12 lettres ou chiffres, unique (ex. VENTES).</p>
          </div>
          <div>
            <label className="label">Libellé</label>
            <input
              className="input"
              value={libelleJournal}
              maxLength={120}
              placeholder="Ex. Journal des ventes"
              onChange={(e) => setLibelleJournal(e.target.value)}
              required
            />
          </div>
          <button
            type="submit"
            className="btn-primary w-full"
            disabled={codeJournal.trim().length < 2 || libelleJournal.trim().length < 2}
          >
            Créer le journal
          </button>
        </form>
      </Modale>
    </div>
  )
}
