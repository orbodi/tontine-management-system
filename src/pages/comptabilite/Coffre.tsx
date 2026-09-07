import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { comptaApi, type CoffreFort } from '../../api/comptabilite'
import { EnTetePage } from '../../components/ui'
import { formatMontant } from '../../utils'
import { useConfirmation } from '../../components/Confirmation'

function lectureEcart(coffre: CoffreFort): { texte: string; tone: 'ok' | 'info' | 'warn' } {
  const comparable = !coffre.perimetreAgenceId
  if (coffre.caisseComptable == null || coffre.ecart == null) {
    return { texte: 'Pas encore de chiffre dans les livres.', tone: 'info' }
  }
  if (!comparable) {
    return { texte: 'Livres = réseau. Caisses = votre agence. Les deux ne se comparent pas.', tone: 'info' }
  }
  if (Math.abs(coffre.ecart) < 1) {
    return { texte: 'Livres et caisses concordent.', tone: 'ok' }
  }
  if ((coffre.caisseComptable ?? 0) < 0) {
    return { texte: 'Livres incomplets : passez les encaissements au journal de caisse.', tone: 'warn' }
  }
  if (coffre.ecart > 0) {
    return { texte: 'Plus d’espèces en caisse que dans les livres.', tone: 'warn' }
  }
  return { texte: 'Plus d’espèces dans les livres qu’en caisse.', tone: 'warn' }
}

function classesCarte(tone: 'ok' | 'info' | 'warn') {
  if (tone === 'ok') return 'border-emerald-200 bg-emerald-50/60'
  if (tone === 'warn') return 'border-amber-200 bg-amber-50/70'
  return 'border-slate-200 bg-white'
}

export default function CoffreFortPage() {
  const { alerter } = useConfirmation()
  const [coffre, setCoffre] = useState<CoffreFort | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const ov = await comptaApi.overview()
        setCoffre(ov.coffre ?? null)
      } catch (e) {
        await alerter('Erreur', e instanceof Error ? e.message : 'Chargement impossible')
      }
    })()
  }, [])

  const lecture = coffre ? lectureEcart(coffre) : null
  const ecartClass =
    !coffre || coffre.ecart == null || Math.abs(coffre.ecart) < 1
      ? 'text-emerald-700'
      : coffre.ecart > 0
        ? 'text-amber-800'
        : 'text-rose-700'

  return (
    <div>
      <Link to="/comptabilite" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700">
        <ArrowLeft className="h-4 w-4" /> Comptabilité
      </Link>
      <EnTetePage titre="Coffre-fort" sousTitre="Livres et caisses" />

      {!coffre ? (
        <p className="text-sm text-slate-500">Chargement…</p>
      ) : (
        <>
          <div className={`mb-6 rounded-2xl border p-5 ${lecture ? classesCarte(lecture.tone) : 'border-slate-200 bg-white'}`}>
            <div className="grid gap-6 sm:grid-cols-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Dans les livres</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">
                  {coffre.caisseComptable == null ? '—' : formatMontant(coffre.caisseComptable)}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Dans les caisses</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">
                  {formatMontant(coffre.caisseOperationnelle)}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Différence</p>
                <p className={`mt-1 text-2xl font-bold ${ecartClass}`}>
                  {coffre.ecart == null
                    ? '—'
                    : `${coffre.ecart > 0 ? '+' : ''}${formatMontant(coffre.ecart)}`}
                </p>
              </div>
            </div>
            {lecture && (
              <p className="mt-4 text-sm text-slate-600">{lecture.texte}</p>
            )}
          </div>

          {coffre.parAgence.length > 0 && (
            <div className="mb-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <p className="border-b border-slate-100 px-5 py-3 text-sm font-medium text-slate-800">
                Par agence
              </p>
              <ul className="divide-y divide-slate-100">
                {coffre.parAgence.map((a) => (
                  <li key={a.agenceId} className="flex items-center justify-between px-5 py-3 text-sm">
                    <span className="text-slate-700">{a.agenceNom}</span>
                    <span className="font-semibold text-slate-900">{formatMontant(a.solde)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  )
}
