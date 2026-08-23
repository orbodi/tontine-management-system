import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { comptaApi, type BilanResponse } from '../../api/comptabilite'
import { EnTetePage } from '../../components/ui'
import { formatMontant } from '../../utils'
import { useStore } from '../../store'
import { useConfirmation } from '../../components/Confirmation'
import type { CompteComptable } from '../../types'

type LigneDraft = { compteNumero: string; sens: 'actif' | 'passif'; montant: number }

export default function BilanInitialPage() {
  const { estAdmin, aDroit } = useStore()
  const { alerter, confirmer } = useConfirmation()
  const [bilan, setBilan] = useState<BilanResponse | null>(null)
  const [plan, setPlan] = useState<CompteComptable[]>([])
  const [lignes, setLignes] = useState<LigneDraft[]>([])
  const peutEcrire = estAdmin || aDroit('gerer_comptabilite')

  const charger = async () => {
    try {
      const ov = await comptaApi.overview()
      if (!ov.exerciceOuvert) {
        setBilan(null)
        return
      }
      const [b, p] = await Promise.all([
        comptaApi.getBilan(ov.exerciceOuvert.id),
        comptaApi.plan({ actifs_seulement: true }),
      ])
      setBilan(b)
      setPlan(p.filter((c) => c.classe <= 5 || c.type === 'actif' || c.type === 'passif'))
      setLignes(
        b.lignes.map((l) => ({
          compteNumero: l.compteNumero,
          sens: l.sens,
          montant: l.montant,
        })),
      )
    } catch (e) {
      await alerter('Erreur', e instanceof Error ? e.message : 'Chargement impossible')
    }
  }

  useEffect(() => {
    void charger()
  }, [])

  const totaux = useMemo(() => {
    const actif = lignes.filter((l) => l.sens === 'actif').reduce((s, l) => s + (Number(l.montant) || 0), 0)
    const passif = lignes.filter((l) => l.sens === 'passif').reduce((s, l) => s + (Number(l.montant) || 0), 0)
    return { actif, passif, ok: Math.abs(actif - passif) < 0.005 && actif > 0 }
  }, [lignes])

  const sauvegarder = async () => {
    if (!bilan) return
    try {
      const b = await comptaApi.saveBilan(
        bilan.exercice.id,
        lignes.filter((l) => l.compteNumero && l.montant > 0),
      )
      setBilan(b)
      await alerter('Enregistré', 'Bilan initial sauvegardé (brouillon).')
    } catch (e) {
      await alerter('Impossible', e instanceof Error ? e.message : 'Erreur')
    }
  }

  const valider = async () => {
    if (!bilan) return
    if (!totaux.ok) {
      await alerter('Déséquilibre', 'Total actif doit égaler total passif (et être > 0).')
      return
    }
    const ok = await confirmer({
      titre: 'Valider le bilan',
      message: 'Génère l’écriture d’ouverture (OD) et verrouille la saisie. Continuer ?',
      labelValider: 'Valider',
    })
    if (!ok) return
    try {
      await comptaApi.saveBilan(
        bilan.exercice.id,
        lignes.filter((l) => l.compteNumero && l.montant > 0),
      )
      const b = await comptaApi.validerBilan(bilan.exercice.id)
      setBilan(b)
      setLignes(b.lignes.map((l) => ({ compteNumero: l.compteNumero, sens: l.sens, montant: l.montant })))
      await alerter('Validé', 'Bilan d’ouverture comptabilisé.')
    } catch (e) {
      await alerter('Impossible', e instanceof Error ? e.message : 'Erreur')
    }
  }

  if (!bilan) {
    return (
      <div>
        <Link to="/comptabilite" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500">
          <ArrowLeft className="h-4 w-4" /> Comptabilité
        </Link>
        <EnTetePage titre="Bilan initial" sousTitre="Aucun exercice ouvert." />
      </div>
    )
  }

  const verrouille = bilan.exercice.bilanValide

  return (
    <div>
      <Link to="/comptabilite" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700">
        <ArrowLeft className="h-4 w-4" /> Comptabilité
      </Link>
      <EnTetePage
        titre={`Bilan initial ${bilan.exercice.annee}`}
        sousTitre={verrouille ? 'Validé — saisie verrouillée' : 'Saisie d’ouverture (actif = passif)'}
      />

      <div className="mb-4 flex flex-wrap gap-4 text-sm">
        <span>
          Actif : <strong>{formatMontant(totaux.actif)}</strong>
        </span>
        <span>
          Passif : <strong>{formatMontant(totaux.passif)}</strong>
        </span>
        <span className={totaux.ok ? 'text-emerald-700' : 'text-rose-600'}>
          {totaux.ok ? 'Équilibré' : 'Déséquilibré'}
        </span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Compte</th>
              <th className="px-3 py-2 text-left">Sens</th>
              <th className="px-3 py-2 text-right">Montant</th>
              {!verrouille && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody>
            {lignes.map((l, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="px-3 py-2">
                  <select
                    className="input"
                    disabled={verrouille || !peutEcrire}
                    value={l.compteNumero}
                    onChange={(e) => {
                      const num = e.target.value
                      const c = plan.find((x) => x.numero === num)
                      const next = [...lignes]
                      next[i] = {
                        ...l,
                        compteNumero: num,
                        sens: c?.type === 'passif' ? 'passif' : 'actif',
                      }
                      setLignes(next)
                    }}
                  >
                    <option value="">—</option>
                    {plan.map((c) => (
                      <option key={c.id} value={c.numero}>
                        {c.numero} — {c.intitule}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <select
                    className="input w-28"
                    disabled={verrouille || !peutEcrire}
                    value={l.sens}
                    onChange={(e) => {
                      const next = [...lignes]
                      next[i] = { ...l, sens: e.target.value as 'actif' | 'passif' }
                      setLignes(next)
                    }}
                  >
                    <option value="actif">Actif</option>
                    <option value="passif">Passif</option>
                  </select>
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    className="input text-right"
                    disabled={verrouille || !peutEcrire}
                    value={l.montant || ''}
                    onChange={(e) => {
                      const next = [...lignes]
                      next[i] = { ...l, montant: Number(e.target.value) }
                      setLignes(next)
                    }}
                  />
                </td>
                {!verrouille && peutEcrire && (
                  <td className="px-3 py-2">
                    <button type="button" className="text-slate-400 hover:text-rose-600" onClick={() => setLignes(lignes.filter((_, j) => j !== i))}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!verrouille && peutEcrire && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setLignes([...lignes, { compteNumero: '', sens: 'actif', montant: 0 }])}
          >
            <Plus className="h-4 w-4" /> Ligne
          </button>
          <button type="button" className="btn-secondary" onClick={() => void sauvegarder()}>
            Enregistrer
          </button>
          <button type="button" className="btn-primary" onClick={() => void valider()}>
            Valider le bilan
          </button>
        </div>
      )}
    </div>
  )
}
