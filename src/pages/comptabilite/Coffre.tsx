import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Landmark, Wallet } from 'lucide-react'
import { comptaApi, type CoffreFort } from '../../api/comptabilite'
import { EnTetePage } from '../../components/ui'
import { formatMontant } from '../../utils'
import { useConfirmation } from '../../components/Confirmation'

function lectureEcart(coffre: CoffreFort): { titre: string; texte: string; tone: 'ok' | 'info' | 'warn' } {
  const comparable = !coffre.perimetreAgenceId
  if (coffre.caisseComptable == null || coffre.ecart == null) {
    return {
      titre: 'Pas encore de chiffre comptable',
      texte:
        'Ouvrez un exercice et saisissez le bilan ou les journaux. Ensuite, la colonne « Dans les livres » s’affichera.',
      tone: 'info',
    }
  }
  if (!comparable) {
    return {
      titre: 'On ne peut pas tout comparer ici',
      texte:
        'Les livres concernent tout le réseau. Le montant de l’application ne montre que votre agence. Utilisez ces deux chiffres séparément.',
      tone: 'info',
    }
  }
  if (Math.abs(coffre.ecart) < 1) {
    return {
      titre: 'Les deux côtés disent la même chose',
      texte:
        'L’argent en tiroir dans l’application correspond à ce qui est écrit en comptabilité. Ce n’est pas un signal pour aller à la banque.',
      tone: 'ok',
    }
  }
  if ((coffre.caisseComptable ?? 0) < 0) {
    return {
      titre: 'Les livres de caisse sont incomplets',
      texte:
        'Un montant négatif « dans les livres » ne veut pas dire que le tiroir est à découvert. Les dépôts et cotisations saisis dans l’application n’apparaissent pas tout seuls en comptabilité. Passez-les au journal de caisse. Ne versez pas à la banque uniquement à cause de cet écart.',
      tone: 'warn',
    }
  }
  if (coffre.ecart > 0) {
    return {
      titre: 'L’application montre plus d’espèces que les livres',
      texte:
        'Souvent, les encaissements du jour n’ont pas encore été saisis en comptabilité. Vérifiez le journal de caisse. Cet écart n’est pas un ordre de verser à la banque.',
      tone: 'warn',
    }
  }
  return {
    titre: 'Les livres montrent plus d’espèces que l’application',
    texte:
      'Des écritures ont peut-être été passées sans que la caisse de l’agence ait bougé, ou l’argent a déjà été porté à la banque. Si c’est un versement, il doit aussi être enregistré en banque dans les journaux.',
    tone: 'warn',
  }
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
      <EnTetePage
        titre="Coffre-fort"
        sousTitre="L’argent en espèces vu de deux manières : les livres, et les caisses de l’application"
      />

      <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-700">
        <p className="font-medium text-slate-900">À quoi ça sert ?</p>
        <p className="mt-2">
          L’application compte l’argent du tiroir à chaque dépôt ou retrait. La comptabilité ne le
          sait que si vous passez une écriture au journal. Cette page pose les deux chiffres côte
          à côte pour voir s’ils se suivent.
        </p>
        <p className="mt-2">
          Un gros écart veut surtout dire : « il manque des écritures », pas « il faut aller à la
          banque ». On verse à la banque quand le tiroir est trop plein, pas parce que les livres
          ne sont pas à jour.
        </p>
      </div>

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
                <p className="mt-1 text-sm text-slate-600">
                  Espèces selon la comptabilité (journal de caisse).
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Dans les caisses</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">
                  {formatMontant(coffre.caisseOperationnelle)}
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  {coffre.perimetreAgenceId
                    ? 'Argent réellement dans le tiroir de votre agence.'
                    : 'Argent réellement dans les tiroirs des agences.'}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Différence</p>
                <p className={`mt-1 text-2xl font-bold ${ecartClass}`}>
                  {coffre.ecart == null
                    ? '—'
                    : `${coffre.ecart > 0 ? '+' : ''}${formatMontant(coffre.ecart)}`}
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  Caisses moins livres. À expliquer, pas à verser tel quel.
                </p>
              </div>
            </div>
            {lecture && (
              <div className="mt-4 rounded-xl bg-white/80 p-3 ring-1 ring-slate-200/80">
                <p className="text-sm font-medium text-slate-800">{lecture.titre}</p>
                <p className="mt-1 text-sm text-slate-600">{lecture.texte}</p>
              </div>
            )}
          </div>

          <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">À la banque (livres)</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">
              {coffre.banqueComptable == null ? '—' : formatMontant(coffre.banqueComptable)}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              Argent déjà sur le compte bancaire, selon la comptabilité. Ce n’est pas l’argent du
              tiroir.
            </p>
          </div>

          {coffre.parAgence.length > 0 && (
            <div className="mb-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <p className="border-b border-slate-100 px-5 py-3 text-sm font-medium text-slate-800">
                Argent dans chaque tiroir d’agence
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

          <div className="grid gap-3 sm:grid-cols-2">
            <Link
              to="/comptabilite/grand-livre"
              className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-brand-300 hover:shadow-sm"
            >
              <div className="rounded-xl bg-brand-50 p-2.5 text-brand-700">
                <Landmark className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold text-slate-900">Voir les écritures de caisse</p>
                <p className="text-sm text-slate-500">Grand livre — ce qui a été saisi en comptabilité</p>
              </div>
            </Link>
            <Link
              to="/caisse"
              className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-brand-300 hover:shadow-sm"
            >
              <div className="rounded-xl bg-brand-50 p-2.5 text-brand-700">
                <Wallet className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold text-slate-900">Voir les caisses des agences</p>
                <p className="text-sm text-slate-500">Soldes et journées dans l’application</p>
              </div>
            </Link>
          </div>
        </>
      )}
    </div>
  )
}
