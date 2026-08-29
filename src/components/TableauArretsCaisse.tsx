import { useMemo, useState } from 'react'
import { arretClotureEnRetard, dateClotureArret } from '../metier'
import type { ArretCaisse } from '../types'
import { formatDate, formatDateHeure, formatMontant } from '../utils'
import { EtatVide } from './ui'

function BadgeEcart({ ecart }: { ecart: number }) {
  if (ecart === 0) return <span className="badge bg-emerald-100 text-emerald-700">Juste</span>
  return (
    <span className={`badge ${ecart > 0 ? 'bg-sky-100 text-sky-700' : 'bg-rose-100 text-rose-700'}`}>
      {ecart > 0 ? '+' : ''}
      {formatMontant(ecart)}
    </span>
  )
}

function aujourdhuiLocalIso(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function moisEnCoursLocal(): string {
  return aujourdhuiLocalIso().slice(0, 7)
}

function bornesMois(mois: string): { debut: string; fin: string } {
  const [y, m] = mois.split('-').map(Number)
  const dernierJour = new Date(y, m, 0).getDate()
  return {
    debut: `${mois}-01`,
    fin: `${mois}-${String(dernierJour).padStart(2, '0')}`,
  }
}

export type FiltreEcartArret = 'tous' | 'manquant' | 'surplus' | 'juste'

type Props = {
  /** Jeu de données brut (filtres gérés dans le DataTable). */
  arrets: ArretCaisse[]
  titre?: string
  afficherCaissier?: boolean
  onSelectionJournee?: (journee: string) => void
  journeeSelectionnee?: string
  /** Masquer le filtre période (ex. historique déjà restreint). */
  sansFiltrePeriode?: boolean
  onAnnulerCloture?: (arret: ArretCaisse) => void
}

/**
 * DataTable unique des arrêts / clôtures de caisse.
 * Filtres intégrés : période (mois ou intervalle) + type d’écart.
 */
export function TableauArretsCaisse({
  arrets,
  titre = 'Arrêts de caisse',
  afficherCaissier = false,
  onSelectionJournee,
  journeeSelectionnee,
  sansFiltrePeriode = false,
  onAnnulerCloture,
}: Props) {
  const [modePeriode, setModePeriode] = useState<'mois' | 'intervalle'>('mois')
  const [mois, setMois] = useState(moisEnCoursLocal)
  const bornes = bornesMois(moisEnCoursLocal())
  const [debut, setDebut] = useState(bornes.debut)
  const [fin, setFin] = useState(bornes.fin)
  const [filtreEcart, setFiltreEcart] = useState<FiltreEcartArret>('tous')

  const arretsFiltres = useMemo(() => {
    let liste = [...arrets]
    if (!sansFiltrePeriode) {
      liste = liste.filter((a) => {
        const jour = a.journee ?? dateClotureArret(a).slice(0, 10)
        if (modePeriode === 'mois') return jour.startsWith(mois || moisEnCoursLocal())
        const d0 = debut || bornesMois(moisEnCoursLocal()).debut
        const d1 = fin || bornesMois(moisEnCoursLocal()).fin
        return jour >= d0 && jour <= d1
      })
    }
    if (filtreEcart === 'manquant') liste = liste.filter((a) => a.ecart < 0)
    else if (filtreEcart === 'surplus') liste = liste.filter((a) => a.ecart > 0)
    else if (filtreEcart === 'juste') liste = liste.filter((a) => a.ecart === 0)
    return liste.sort((a, b) => dateClotureArret(b).localeCompare(dateClotureArret(a)))
  }, [arrets, sansFiltrePeriode, modePeriode, mois, debut, fin, filtreEcart])

  const descriptionVide =
    filtreEcart === 'manquant'
      ? 'Aucun arrêt avec manquant pour ces filtres.'
      : filtreEcart === 'surplus'
        ? 'Aucun arrêt avec surplus pour ces filtres.'
        : filtreEcart === 'juste'
          ? 'Aucun arrêt juste pour ces filtres.'
          : 'Aucun arrêt pour ces filtres.'

  return (
    <div className="card !p-0">
      <div className="space-y-3 border-b border-slate-200 px-5 py-4">
        <h3 className="font-semibold text-slate-900">
          {titre} ({arretsFiltres.length})
        </h3>

        <div className="flex flex-wrap items-end gap-3">
          {!sansFiltrePeriode && (
            <>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setModePeriode('mois')
                    setMois(moisEnCoursLocal())
                  }}
                  className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${
                    modePeriode === 'mois'
                      ? 'bg-brand-600 text-white'
                      : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
                  }`}
                >
                  Par mois
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setModePeriode('intervalle')
                    const b = bornesMois(mois || moisEnCoursLocal())
                    setDebut(b.debut)
                    setFin(b.fin)
                  }}
                  className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${
                    modePeriode === 'intervalle'
                      ? 'bg-brand-600 text-white'
                      : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
                  }`}
                >
                  Par intervalle
                </button>
              </div>
              {modePeriode === 'mois' ? (
                <div>
                  <label className="label !mb-1">Mois</label>
                  <input
                    className="input !w-auto"
                    type="month"
                    value={mois || moisEnCoursLocal()}
                    max={moisEnCoursLocal()}
                    onChange={(e) => setMois(e.target.value)}
                  />
                </div>
              ) : (
                <>
                  <div>
                    <label className="label !mb-1">Du</label>
                    <input
                      className="input !w-auto"
                      type="date"
                      value={debut}
                      max={fin || aujourdhuiLocalIso()}
                      onChange={(e) => setDebut(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="label !mb-1">Au</label>
                    <input
                      className="input !w-auto"
                      type="date"
                      value={fin}
                      min={debut || undefined}
                      max={aujourdhuiLocalIso()}
                      onChange={(e) => setFin(e.target.value)}
                    />
                  </div>
                  <button
                    type="button"
                    className="btn-secondary !py-2 text-xs"
                    onClick={() => {
                      const b = bornesMois(moisEnCoursLocal())
                      setDebut(b.debut)
                      setFin(b.fin)
                    }}
                  >
                    Mois en cours
                  </button>
                </>
              )}
            </>
          )}

          <div className="flex flex-wrap gap-2">
            {(
              [
                ['tous', 'Tous'],
                ['manquant', 'Manquants'],
                ['surplus', 'Surplus'],
                ['juste', 'Justes'],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setFiltreEcart(v)}
                className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${
                  filtreEcart === v
                    ? v === 'manquant'
                      ? 'bg-rose-600 text-white'
                      : v === 'surplus'
                        ? 'bg-sky-600 text-white'
                        : 'bg-brand-600 text-white'
                    : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {arretsFiltres.length === 0 ? (
        <div className="p-5">
          <EtatVide titre="Aucun arrêt" description={descriptionVide} />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table
            className={`w-full text-sm ${afficherCaissier ? 'min-w-[640px]' : 'min-w-[560px]'}`}
          >
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3">Journée</th>
                <th className="px-5 py-3">Clôture</th>
                {afficherCaissier && <th className="px-5 py-3">Caissier</th>}
                <th className="px-5 py-3 text-right">Ouverture</th>
                <th className="px-5 py-3 text-right">Fermeture th.</th>
                <th className="px-5 py-3 text-right">Compté</th>
                <th className="px-5 py-3">Écart</th>
                {onAnnulerCloture && <th className="px-5 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {arretsFiltres.map((a) => {
                const journee = a.journee ?? dateClotureArret(a).slice(0, 10)
                const selectionnee = journeeSelectionnee === journee
                return (
                  <tr
                    key={a.id}
                    className={`hover:bg-slate-50 ${onSelectionJournee ? 'cursor-pointer' : ''} ${
                      selectionnee ? 'bg-brand-50/60' : ''
                    }`}
                    onClick={onSelectionJournee ? () => onSelectionJournee(journee) : undefined}
                  >
                    <td className="px-5 py-3">
                      <div className="font-medium">{formatDate(journee + 'T12:00:00')}</div>
                      {arretClotureEnRetard(a) && (
                        <span className="badge mt-1 bg-amber-100 text-amber-800">
                          Clôturé en retard
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-slate-600">
                      <div className="text-sm">{formatDateHeure(dateClotureArret(a))}</div>
                      {a.valideParNom && (
                        <div className="text-xs text-slate-400">par {a.valideParNom}</div>
                      )}
                    </td>
                    {afficherCaissier && <td className="px-5 py-3">{a.employeNom}</td>}
                    <td className="px-5 py-3 text-right">
                      {formatMontant(a.soldeOuverture ?? 0)}
                    </td>
                    <td className="px-5 py-3 text-right font-semibold">
                      {formatMontant(a.soldeTheorique)}
                    </td>
                    <td className="px-5 py-3 text-right">{formatMontant(a.montantCompte)}</td>
                    <td className="px-5 py-3">
                      <BadgeEcart ecart={a.ecart} />
                    </td>
                    {onAnnulerCloture && (
                      <td className="px-5 py-3 text-right">
                        <button
                          type="button"
                          className="text-xs font-medium text-rose-700 hover:underline"
                          onClick={(e) => {
                            e.stopPropagation()
                            onAnnulerCloture(a)
                          }}
                        >
                          Annuler la clôture
                        </button>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
