import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BookOpen,
  Calculator,
  FileSpreadsheet,
  Landmark,
  Scale,
  ScrollText,
} from 'lucide-react'
import { comptaApi, type ComptaOverview } from '../../api/comptabilite'
import { EnTetePage } from '../../components/ui'
import { useStore } from '../../store'
import { useConfirmation } from '../../components/Confirmation'

const sousMenus = [
  { to: '/comptabilite/plan', label: 'Plan comptable', icon: BookOpen, desc: 'SYSCOHADA' },
  { to: '/comptabilite/bilan', label: 'Bilan initial', icon: Scale, desc: 'Ouverture d’exercice' },
  { to: '/comptabilite/journaux', label: 'Journaux', icon: ScrollText, desc: 'Caisse, banque, OD…' },
  { to: '/comptabilite/grand-livre', label: 'Grand livre', icon: Landmark, desc: 'Par compte' },
  { to: '/comptabilite/balance', label: 'Balance générale', icon: FileSpreadsheet, desc: 'Soldes' },
]

export default function ComptabiliteAccueil() {
  const { aDroit, estAdmin } = useStore()
  const { alerter, confirmer } = useConfirmation()
  const [ov, setOv] = useState<ComptaOverview | null>(null)
  const [annee, setAnnee] = useState(new Date().getFullYear() + 1)
  const peutEcrire = estAdmin || aDroit('gerer_comptabilite')

  const charger = async () => {
    try {
      setOv(await comptaApi.overview())
    } catch (e) {
      await alerter('Erreur', e instanceof Error ? e.message : 'Chargement impossible')
    }
  }

  useEffect(() => {
    void charger()
  }, [])

  const ouvrir = async () => {
    try {
      await comptaApi.ouvrirExercice(annee)
      await charger()
      await alerter('OK', `Exercice ${annee} ouvert.`)
    } catch (e) {
      await alerter('Impossible', e instanceof Error ? e.message : 'Erreur')
    }
  }

  const cloturer = async () => {
    if (!ov?.exerciceOuvert) return
    const ok = await confirmer({
      titre: 'Clôturer l’exercice',
      message: `Clôturer ${ov.exerciceOuvert.annee} et générer les à-nouveaux sur ${ov.exerciceOuvert.annee + 1} ?`,
      labelValider: 'Clôturer',
      danger: true,
    })
    if (!ok) return
    try {
      await comptaApi.cloturerExercice(ov.exerciceOuvert.id, true)
      await charger()
      await alerter('Clôturé', 'Exercice clôturé. À-nouveaux générés si possible.')
    } catch (e) {
      await alerter('Impossible', e instanceof Error ? e.message : 'Erreur')
    }
  }

  const sync = async () => {
    try {
      await comptaApi.syncAuto()
      await alerter('Synchronisé', 'Écritures auto générées depuis les opérations métier.')
    } catch (e) {
      await alerter('Impossible', e instanceof Error ? e.message : 'Erreur')
    }
  }

  return (
    <div>
      <EnTetePage
        titre="Comptabilité"
        sousTitre="Comptabilité générale SYSCOHADA — double entrée"
        action={
          peutEcrire ? (
            <button type="button" className="btn-secondary text-sm" onClick={() => void sync()}>
              Sync. écritures auto
            </button>
          ) : undefined
        }
      />

      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Exercice ouvert</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {ov?.exerciceOuvert ? ov.exerciceOuvert.annee : '—'}
          </p>
          {ov?.exerciceOuvert && (
            <p className="mt-1 text-xs text-slate-500">
              Bilan {ov.exerciceOuvert.bilanValide ? 'validé' : 'non validé'} · {ov.exerciceOuvert.dateDebut} →{' '}
              {ov.exerciceOuvert.dateFin}
            </p>
          )}
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Comptes</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{ov?.nbComptes ?? '—'}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Journaux</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{ov?.nbJournaux ?? '—'}</p>
        </div>
      </div>

      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sousMenus.map(({ to, label, icon: Icon, desc }) => (
          <Link
            key={to}
            to={to}
            className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-brand-300 hover:shadow-sm"
          >
            <div className="rounded-xl bg-brand-50 p-2.5 text-brand-700">
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold text-slate-900">{label}</p>
              <p className="text-sm text-slate-500">{desc}</p>
            </div>
          </Link>
        ))}
      </div>

      {peutEcrire && (
        <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-5">
          <div>
            <label className="text-xs font-medium text-slate-500">Nouvel exercice</label>
            <input
              type="number"
              className="input mt-1 w-28"
              value={annee}
              onChange={(e) => setAnnee(Number(e.target.value))}
            />
          </div>
          <button type="button" className="btn-primary" onClick={() => void ouvrir()}>
            <Calculator className="h-4 w-4" /> Ouvrir
          </button>
          {ov?.exerciceOuvert && (
            <button type="button" className="btn-secondary text-rose-700" onClick={() => void cloturer()}>
              Clôturer {ov.exerciceOuvert.annee}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
