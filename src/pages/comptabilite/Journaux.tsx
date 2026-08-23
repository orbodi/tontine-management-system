import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Plus } from 'lucide-react'
import { comptaApi } from '../../api/comptabilite'
import { EnTetePage, Modale } from '../../components/ui'
import { formatMontant } from '../../utils'
import { useStore } from '../../store'
import { useConfirmation } from '../../components/Confirmation'
import type { CompteComptable, EcritureComptable, JournalComptable } from '../../types'

const JOURNAUX_ONGLETS = ['CAISSE', 'BANQUE', 'ACHAT', 'OD'] as const

export default function JournauxPage() {
  const { estAdmin, aDroit } = useStore()
  const { alerter } = useConfirmation()
  const [onglet, setOnglet] = useState<(typeof JOURNAUX_ONGLETS)[number]>('CAISSE')
  const [ecritures, setEcritures] = useState<EcritureComptable[]>([])
  const [journaux, setJournaux] = useState<JournalComptable[]>([])
  const [plan, setPlan] = useState<CompteComptable[]>([])
  const [detail, setDetail] = useState<EcritureComptable | null>(null)
  const [modale, setModale] = useState(false)
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [libelle, setLibelle] = useState('')
  const [lig1, setLig1] = useState({ compteNumero: '571', debit: 0, credit: 0 })
  const [lig2, setLig2] = useState({ compteNumero: '521', debit: 0, credit: 0 })
  const peutEcrire = estAdmin || aDroit('gerer_comptabilite')

  const charger = async () => {
    try {
      const [e, j, p] = await Promise.all([
        comptaApi.ecritures({ journal_code: onglet }),
        comptaApi.journaux(),
        comptaApi.plan({ actifs_seulement: true }),
      ])
      setEcritures(e)
      setJournaux(j)
      setPlan(p)
    } catch (err) {
      await alerter('Erreur', err instanceof Error ? err.message : 'Chargement impossible')
    }
  }

  useEffect(() => {
    void charger()
  }, [onglet])

  const creer = async (ev: React.FormEvent) => {
    ev.preventDefault()
    try {
      await comptaApi.creerEcriture({
        journalCode: onglet,
        date,
        libelle,
        lignes: [lig1, lig2],
      })
      setModale(false)
      setLibelle('')
      await charger()
    } catch (err) {
      await alerter('Impossible', err instanceof Error ? err.message : 'Erreur')
    }
  }

  return (
    <div>
      <Link to="/comptabilite" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700">
        <ArrowLeft className="h-4 w-4" /> Comptabilité
      </Link>
      <EnTetePage
        titre="Journaux comptables"
        sousTitre={journaux.find((j) => j.code === onglet)?.libelle}
        action={
          peutEcrire ? (
            <button type="button" className="btn-primary" onClick={() => setModale(true)}>
              <Plus className="h-4 w-4" /> Écriture
            </button>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {JOURNAUX_ONGLETS.map((code) => (
          <button
            key={code}
            type="button"
            onClick={() => setOnglet(code)}
            className={`rounded-xl px-3.5 py-2 text-sm font-medium ${
              onglet === code ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'
            }`}
          >
            {code}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Pièce</th>
              <th className="px-4 py-3">Libellé</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3 text-right">Débit</th>
              <th className="px-4 py-3 text-right">Crédit</th>
            </tr>
          </thead>
          <tbody>
            {ecritures.map((e) => (
              <tr
                key={e.id}
                className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                onClick={() => setDetail(e)}
              >
                <td className="px-4 py-2.5">{e.date}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{e.numeroPiece}</td>
                <td className="px-4 py-2.5">{e.libelle}</td>
                <td className="px-4 py-2.5 text-xs text-slate-500">{e.source}</td>
                <td className="px-4 py-2.5 text-right">{formatMontant(e.totalDebit)}</td>
                <td className="px-4 py-2.5 text-right">{formatMontant(e.totalCredit)}</td>
              </tr>
            ))}
            {ecritures.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  Aucune écriture dans ce journal.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modale titre="Détail écriture" ouverte={!!detail} onFermer={() => setDetail(null)} large>
        {detail && (
          <div className="space-y-3 text-sm">
            <p>
              <strong>{detail.numeroPiece}</strong> — {detail.libelle}
            </p>
            <p className="text-slate-500">
              {detail.date} · {detail.source}
            </p>
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="py-1">Compte</th>
                  <th className="py-1 text-right">Débit</th>
                  <th className="py-1 text-right">Crédit</th>
                </tr>
              </thead>
              <tbody>
                {detail.lignes.map((l) => (
                  <tr key={l.id} className="border-t border-slate-100">
                    <td className="py-1.5 font-mono">{l.compteNumero}</td>
                    <td className="py-1.5 text-right">{l.debit ? formatMontant(l.debit) : '—'}</td>
                    <td className="py-1.5 text-right">{l.credit ? formatMontant(l.credit) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modale>

      <Modale titre={`Nouvelle écriture — ${onglet}`} ouverte={modale} onFermer={() => setModale(false)} large>
        <form className="space-y-3" onSubmit={(e) => void creer(e)}>
          <div>
            <label className="text-xs text-slate-500">Date</label>
            <input type="date" className="input mt-1" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div>
            <label className="text-xs text-slate-500">Libellé</label>
            <input className="input mt-1" value={libelle} onChange={(e) => setLibelle(e.target.value)} required />
          </div>
          {([lig1, lig2] as const).map((lig, idx) => (
            <div key={idx} className="grid grid-cols-3 gap-2">
              <select
                className="input col-span-1"
                value={lig.compteNumero}
                onChange={(e) => {
                  const v = { ...lig, compteNumero: e.target.value }
                  if (idx === 0) setLig1(v)
                  else setLig2(v)
                }}
              >
                {plan.map((c) => (
                  <option key={c.id} value={c.numero}>
                    {c.numero}
                  </option>
                ))}
              </select>
              <input
                type="number"
                className="input"
                placeholder="Débit"
                value={lig.debit || ''}
                onChange={(e) => {
                  const v = { ...lig, debit: Number(e.target.value), credit: 0 }
                  if (idx === 0) setLig1(v)
                  else setLig2(v)
                }}
              />
              <input
                type="number"
                className="input"
                placeholder="Crédit"
                value={lig.credit || ''}
                onChange={(e) => {
                  const v = { ...lig, credit: Number(e.target.value), debit: 0 }
                  if (idx === 0) setLig1(v)
                  else setLig2(v)
                }}
              />
            </div>
          ))}
          <button type="submit" className="btn-primary w-full">
            Enregistrer
          </button>
        </form>
      </Modale>
    </div>
  )
}
