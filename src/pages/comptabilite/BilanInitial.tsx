import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Plus, Scale, Trash2 } from 'lucide-react'
import { comptaApi, type BilanResponse } from '../../api/comptabilite'
import { EnTetePage, EtatVide } from '../../components/ui'
import { RechercheCompte } from '../../components/RechercheCompte'
import { formatMontant } from '../../utils'
import { useStore } from '../../store'
import { useConfirmation } from '../../components/Confirmation'
import type { CompteComptable, SensBilan } from '../../types'

type LigneDraft = { compteNumero: string; intitule: string; sens: SensBilan; montant: number }

const COMPTES_FREQUENTS = ['571', '521', '4119', '4671', '4673', '1013']

function formatJour(yyyyMmDd: string) {
  const [y, m, d] = yyyyMmDd.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function Colonne({
  titre,
  couleur,
  lignes,
  totauxOk,
  total,
  verrouille,
  peutEcrire,
  comptes,
  exclus,
  onAjouter,
  onMontant,
  onSupprimer,
  onBasculer,
}: {
  titre: string
  couleur: string
  lignes: LigneDraft[]
  totauxOk: boolean
  total: number
  verrouille: boolean
  peutEcrire: boolean
  comptes: CompteComptable[]
  exclus: Set<string>
  onAjouter: (c: CompteComptable) => void
  onMontant: (numero: string, montant: number) => void
  onSupprimer: (numero: string) => void
  onBasculer: (numero: string) => void
}) {
  return (
    <div className="flex min-h-[320px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className={`border-b px-4 py-3 ${couleur}`}>
        <h2 className="text-sm font-bold uppercase tracking-wide">{titre}</h2>
      </div>
      {!verrouille && peutEcrire && (
        <div className="border-b border-slate-100 p-3">
          <RechercheCompte comptes={comptes} exclus={exclus} viderApresChoix onChoisir={onAjouter} />
        </div>
      )}
      <div className="flex-1">
        {lignes.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-400">Aucun compte</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {lignes.map((l) => (
                <tr key={l.compteNumero} className="border-t border-slate-100 first:border-t-0">
                  <td className="px-4 py-2.5">
                    <p className="font-mono text-xs font-semibold text-slate-900">{l.compteNumero}</p>
                    <p className="text-slate-600">{l.intitule || '—'}</p>
                  </td>
                  <td className="w-36 px-3 py-2.5 text-right">
                    {verrouille ? (
                      <span className="font-medium tabular-nums">{formatMontant(l.montant)}</span>
                    ) : (
                      <input
                        type="number"
                        min={0}
                        step={1}
                        className="input text-right"
                        disabled={!peutEcrire}
                        value={l.montant || ''}
                        onChange={(e) => onMontant(l.compteNumero, Number(e.target.value) || 0)}
                      />
                    )}
                  </td>
                  {!verrouille && peutEcrire && (
                    <td className="w-16 px-2 py-2.5">
                      <div className="flex flex-col items-end gap-1">
                        <button
                          type="button"
                          className="text-slate-400 hover:text-rose-600"
                          title="Retirer"
                          onClick={() => onSupprimer(l.compteNumero)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          className="text-[10px] text-slate-400 hover:text-brand-700"
                          title="Passer de l’autre côté"
                          onClick={() => onBasculer(l.compteNumero)}
                        >
                          ↔
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div
        className={`flex items-center justify-between border-t px-4 py-3 text-sm font-semibold ${
          totauxOk ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-50 text-slate-800'
        }`}
      >
        <span>Total</span>
        <span className="tabular-nums">{formatMontant(total)}</span>
      </div>
    </div>
  )
}

export default function BilanInitialPage() {
  const { estAdmin, aDroit } = useStore()
  const { alerter, confirmer } = useConfirmation()
  const [bilan, setBilan] = useState<BilanResponse | null>(null)
  const [plan, setPlan] = useState<CompteComptable[]>([])
  const [lignes, setLignes] = useState<LigneDraft[]>([])
  const [chargement, setChargement] = useState(true)
  const [anneeOuverture, setAnneeOuverture] = useState(new Date().getFullYear())
  const peutEcrire = estAdmin || aDroit('gerer_comptabilite')

  const comptesBilan = useMemo(
    () =>
      plan.filter(
        (c) => c.classe >= 1 && c.classe <= 5 && (c.type === 'actif' || c.type === 'passif') && c.numero.length >= 3,
      ),
    [plan],
  )

  const charger = async () => {
    try {
      const ov = await comptaApi.overview()
      if (!ov.exerciceOuvert) {
        setBilan(null)
        setLignes([])
        return
      }
      const [b, p] = await Promise.all([
        comptaApi.getBilan(ov.exerciceOuvert.id),
        comptaApi.plan({ actifs_seulement: true }),
      ])
      setBilan(b)
      setPlan(p)
      setLignes(
        b.lignes.map((l) => ({
          compteNumero: l.compteNumero,
          intitule: l.intitule || p.find((c) => c.numero === l.compteNumero)?.intitule || '',
          sens: l.sens,
          montant: l.montant,
        })),
      )
    } catch (e) {
      await alerter('Erreur', e instanceof Error ? e.message : 'Chargement impossible')
    } finally {
      setChargement(false)
    }
  }

  useEffect(() => {
    void charger()
  }, [])

  const totaux = useMemo(() => {
    const actif = lignes.filter((l) => l.sens === 'actif').reduce((s, l) => s + (Number(l.montant) || 0), 0)
    const passif = lignes.filter((l) => l.sens === 'passif').reduce((s, l) => s + (Number(l.montant) || 0), 0)
    const ecart = actif - passif
    return { actif, passif, ecart, ok: Math.abs(ecart) < 0.005 && actif > 0 }
  }, [lignes])

  const exclus = useMemo(() => new Set(lignes.map((l) => l.compteNumero)), [lignes])

  const ajouter = (c: CompteComptable, sens?: SensBilan) => {
    if (exclus.has(c.numero)) return
    setLignes([
      ...lignes,
      {
        compteNumero: c.numero,
        intitule: c.intitule,
        sens: sens ?? (c.type === 'passif' ? 'passif' : 'actif'),
        montant: 0,
      },
    ])
  }

  const frequentsDispo = COMPTES_FREQUENTS.map((n) => plan.find((c) => c.numero === n)).filter(
    (c): c is CompteComptable => !!c && !exclus.has(c.numero),
  )

  const sauvegarder = async () => {
    if (!bilan) return
    try {
      const b = await comptaApi.saveBilan(
        bilan.exercice.id,
        lignes.filter((l) => l.compteNumero && l.montant > 0),
      )
      setBilan(b)
      await alerter('Enregistré', 'Brouillon du bilan d’ouverture enregistré.')
    } catch (e) {
      await alerter('Impossible', e instanceof Error ? e.message : 'Erreur')
    }
  }

  const valider = async () => {
    if (!bilan) return
    if (!totaux.ok) {
      await alerter('Déséquilibre', 'Le total de l’actif doit égaler le total du passif, et être supérieur à zéro.')
      return
    }
    const ok = await confirmer({
      titre: 'Valider le bilan d’ouverture',
      message:
        `Une écriture d’ouverture (journal OD, pièce BO-${bilan.exercice.annee}) sera passée au ${formatJour(bilan.exercice.dateDebut)}. ` +
        'La saisie sera ensuite verrouillée. Continuer ?',
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
      setLignes(
        b.lignes.map((l) => ({
          compteNumero: l.compteNumero,
          intitule: l.intitule || '',
          sens: l.sens,
          montant: l.montant,
        })),
      )
      await alerter(
        'Validé',
        `Bilan d’ouverture comptabilisé${b.pieceOuverture ? ` (pièce ${b.pieceOuverture})` : ''}.`,
      )
    } catch (e) {
      await alerter('Impossible', e instanceof Error ? e.message : 'Erreur')
    }
  }

  const ouvrirExercice = async () => {
    try {
      await comptaApi.ouvrirExercice(anneeOuverture)
      setChargement(true)
      await charger()
    } catch (e) {
      await alerter('Impossible', e instanceof Error ? e.message : 'Erreur')
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

  if (!bilan) {
    return (
      <div>
        <Link to="/comptabilite" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700">
          <ArrowLeft className="h-4 w-4" /> Comptabilité
        </Link>
        <EnTetePage titre="Bilan initial" sousTitre="Photographie du patrimoine au premier jour de l’exercice" />
        <EtatVide
          titre="Aucun exercice ouvert"
          description="Ouvrez un exercice pour saisir le bilan d’ouverture (caisse, banque, dépôts, capital…)."
        />
        {peutEcrire && (
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div>
              <label className="label">Année</label>
              <input
                type="number"
                className="input w-28"
                value={anneeOuverture}
                onChange={(e) => setAnneeOuverture(Number(e.target.value))}
              />
            </div>
            <button type="button" className="btn-primary" onClick={() => void ouvrirExercice()}>
              Ouvrir l’exercice
            </button>
          </div>
        )}
      </div>
    )
  }

  const verrouille = bilan.exercice.bilanValide
  const actifs = lignes.filter((l) => l.sens === 'actif')
  const passifs = lignes.filter((l) => l.sens === 'passif')

  return (
    <div>
      <Link to="/comptabilite" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700">
        <ArrowLeft className="h-4 w-4" /> Comptabilité
      </Link>
      <EnTetePage
        titre={`Bilan initial ${bilan.exercice.annee}`}
        sousTitre={
          verrouille
            ? `Validé — écriture d’ouverture ${bilan.pieceOuverture ?? ''} au ${formatJour(bilan.exercice.dateDebut)}`
            : `Saisie d’ouverture au ${formatJour(bilan.exercice.dateDebut)} — l’actif doit égaler le passif`
        }
        action={
          !verrouille && peutEcrire ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary" onClick={() => void sauvegarder()}>
                Enregistrer
              </button>
              <button type="button" className="btn-primary" onClick={() => void valider()}>
                <Scale className="h-4 w-4" /> Valider le bilan
              </button>
            </div>
          ) : undefined
        }
      />

      <p className="mb-6 max-w-3xl text-sm text-slate-600">
        Le bilan initial décrit ce que l’entreprise <strong>possède</strong> (actif : caisse, banque, crédits…) et ce
        qu’elle <strong>doit</strong> (passif : capital, dépôts clients, tontines…). Valider génère une seule écriture
        au journal des opérations diverses.
      </p>

      {!verrouille && peutEcrire && frequentsDispo.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Fréquents</span>
          {frequentsDispo.map((c) => (
            <button
              key={c.numero}
              type="button"
              className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200 hover:ring-brand-400"
              onClick={() => ajouter(c)}
            >
              <Plus className="mr-1 inline h-3 w-3" />
              {c.numero} {c.intitule}
            </button>
          ))}
        </div>
      )}

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Colonne
          titre="Actif"
          couleur="bg-sky-50 text-sky-900"
          lignes={actifs}
          totauxOk={totaux.ok}
          total={totaux.actif}
          verrouille={verrouille}
          peutEcrire={peutEcrire}
          comptes={comptesBilan.filter((c) => c.type === 'actif')}
          exclus={exclus}
          onAjouter={(c) => ajouter(c, 'actif')}
          onMontant={(n, m) => setLignes(lignes.map((l) => (l.compteNumero === n ? { ...l, montant: m } : l)))}
          onSupprimer={(n) => setLignes(lignes.filter((l) => l.compteNumero !== n))}
          onBasculer={(n) =>
            setLignes(lignes.map((l) => (l.compteNumero === n ? { ...l, sens: 'passif' as const } : l)))
          }
        />
        <Colonne
          titre="Passif"
          couleur="bg-amber-50 text-amber-900"
          lignes={passifs}
          totauxOk={totaux.ok}
          total={totaux.passif}
          verrouille={verrouille}
          peutEcrire={peutEcrire}
          comptes={comptesBilan.filter((c) => c.type === 'passif')}
          exclus={exclus}
          onAjouter={(c) => ajouter(c, 'passif')}
          onMontant={(n, m) => setLignes(lignes.map((l) => (l.compteNumero === n ? { ...l, montant: m } : l)))}
          onSupprimer={(n) => setLignes(lignes.filter((l) => l.compteNumero !== n))}
          onBasculer={(n) =>
            setLignes(lignes.map((l) => (l.compteNumero === n ? { ...l, sens: 'actif' as const } : l)))
          }
        />
      </div>

      <div
        className={`rounded-2xl border px-4 py-3 text-sm ${
          totaux.ok
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
            : 'border-rose-200 bg-rose-50 text-rose-800'
        }`}
      >
        {totaux.ok ? (
          <span>Équilibré — {formatMontant(totaux.actif)} de chaque côté.</span>
        ) : totaux.actif === 0 && totaux.passif === 0 ? (
          <span>Ajoutez les soldes d’ouverture (caisse, banque, dépôts, capital…).</span>
        ) : (
          <span>
            Écart : {formatMontant(Math.abs(totaux.ecart))}
            {totaux.ecart > 0 ? ' (actif trop élevé)' : ' (passif trop élevé)'}
          </span>
        )}
      </div>
    </div>
  )
}
