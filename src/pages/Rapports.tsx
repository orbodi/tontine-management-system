import { useMemo, useState } from 'react'
import { Download, Printer } from 'lucide-react'
import { MODULE_CREDITS_ACTIF } from '../config'
import { useStore } from '../store'
import {
  dateClotureArret,
  estOperationCaisse,
  LIBELLES_TYPE,
  TYPES_SORTIE,
  situationCredit,
} from '../metier'
import { exporterCsv, formatDate, formatDateHeure, formatMontant } from '../utils'
import { EnTetePage } from '../components/ui'

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

function libelleMois(mois: string): string {
  const [y, m] = mois.split('-').map(Number)
  const label = new Date(y, m - 1, 1).toLocaleDateString('fr-FR', {
    month: 'long',
    year: 'numeric',
  })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export default function Rapports() {
  const { data, estAdmin, estChefAgence, agenceFiltreOperations, employeConnecte } = useStore()

  const [modePeriode, setModePeriode] = useState<'mois' | 'intervalle'>('mois')
  const [mois, setMois] = useState(moisEnCoursLocal)
  const bornesInit = bornesMois(moisEnCoursLocal())
  const [debut, setDebut] = useState(bornesInit.debut)
  const [fin, setFin] = useState(bornesInit.fin)
  const [caissierId, setCaissierId] = useState<'tous' | string>('tous')

  const periode = useMemo(() => {
    if (modePeriode === 'mois') return bornesMois(mois || moisEnCoursLocal())
    return {
      debut: debut || bornesMois(moisEnCoursLocal()).debut,
      fin: fin || bornesMois(moisEnCoursLocal()).fin,
    }
  }, [modePeriode, mois, debut, fin])

  const libellePeriode =
    modePeriode === 'mois'
      ? libelleMois(mois || moisEnCoursLocal())
      : `du ${formatDate(periode.debut + 'T12:00:00')} au ${formatDate(periode.fin + 'T12:00:00')}`

  const caissiersDisponibles = useMemo(() => {
    return data.employes
      .filter((e) => {
        if (!e.actif) return false
        if (e.role !== 'caissier' && e.role !== 'chef_agence') return false
        if (estAdmin) return true
        if (estChefAgence && agenceFiltreOperations) return e.agenceId === agenceFiltreOperations
        return employeConnecte ? e.id === employeConnecte.id : false
      })
      .sort((a, b) => a.nomComplet.localeCompare(b.nomComplet, 'fr'))
  }, [data.employes, estAdmin, estChefAgence, agenceFiltreOperations, employeConnecte])

  const dansPerimetre = (agenceId: string, operateurId: string) => {
    if (estAdmin) return true
    if (estChefAgence && agenceFiltreOperations) return agenceId === agenceFiltreOperations
    if (employeConnecte) return operateurId === employeConnecte.id
    return false
  }

  const dansPeriode = (jourIso: string) => jourIso >= periode.debut && jourIso <= periode.fin

  const rapportCaisse = useMemo(() => {
    const ops = data.transactions.filter((t) => {
      if (!estOperationCaisse(t.type)) return false
      if (!dansPerimetre(t.agenceId, t.operateurId)) return false
      if (!dansPeriode(t.date.slice(0, 10))) return false
      if (caissierId !== 'tous' && t.operateurId !== caissierId) return false
      return true
    })

    const parType = new Map<string, { entrees: number; sorties: number; nombre: number }>()
    const parCaissier = new Map<
      string,
      { nom: string; agenceId: string; entrees: number; sorties: number; nombre: number }
    >()
    let entrees = 0
    let sorties = 0

    ops.forEach((t) => {
      const ligneType = parType.get(t.type) ?? { entrees: 0, sorties: 0, nombre: 0 }
      ligneType.nombre++
      if (TYPES_SORTIE.includes(t.type)) {
        ligneType.sorties += t.montant
        sorties += t.montant
      } else {
        ligneType.entrees += t.montant
        entrees += t.montant
      }
      parType.set(t.type, ligneType)

      const emp = data.employes.find((e) => e.id === t.operateurId)
      const ligneC = parCaissier.get(t.operateurId) ?? {
        nom: emp?.nomComplet ?? t.operateur,
        agenceId: t.agenceId,
        entrees: 0,
        sorties: 0,
        nombre: 0,
      }
      ligneC.nombre++
      if (TYPES_SORTIE.includes(t.type)) ligneC.sorties += t.montant
      else ligneC.entrees += t.montant
      parCaissier.set(t.operateurId, ligneC)
    })

    const arrets = data.arretsCaisse.filter((a) => {
      if (!dansPerimetre(a.agenceId, a.employeId)) return false
      const jour = a.journee ?? dateClotureArret(a).slice(0, 10)
      if (!dansPeriode(jour)) return false
      if (caissierId !== 'tous' && a.employeId !== caissierId) return false
      return true
    })

    let totalManquant = 0
    let totalSurplus = 0
    const ecartsParCaissier = new Map<string, { manquant: number; surplus: number }>()
    arrets.forEach((a) => {
      const e = ecartsParCaissier.get(a.employeId) ?? { manquant: 0, surplus: 0 }
      if (a.ecart < 0) {
        e.manquant += -a.ecart
        totalManquant += -a.ecart
      } else if (a.ecart > 0) {
        e.surplus += a.ecart
        totalSurplus += a.ecart
      }
      ecartsParCaissier.set(a.employeId, e)
    })

    const lignesCaissiers = [...parCaissier.entries()]
      .map(([id, l]) => {
        const ecart = ecartsParCaissier.get(id) ?? { manquant: 0, surplus: 0 }
        const agence = data.agences.find((a) => a.id === l.agenceId)
        return {
          id,
          nom: l.nom,
          agenceNom: agence?.nom ?? '—',
          nombre: l.nombre,
          entrees: l.entrees,
          sorties: l.sorties,
          net: l.entrees - l.sorties,
          manquant: ecart.manquant,
          surplus: ecart.surplus,
        }
      })
      .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))

    arrets.forEach((a) => {
      if (parCaissier.has(a.employeId)) return
      if (lignesCaissiers.some((l) => l.id === a.employeId)) return
      const emp = data.employes.find((e) => e.id === a.employeId)
      const agence = data.agences.find((x) => x.id === a.agenceId)
      const ecart = ecartsParCaissier.get(a.employeId) ?? { manquant: 0, surplus: 0 }
      lignesCaissiers.push({
        id: a.employeId,
        nom: emp?.nomComplet ?? a.employeNom,
        agenceNom: agence?.nom ?? '—',
        nombre: 0,
        entrees: 0,
        sorties: 0,
        net: 0,
        manquant: ecart.manquant,
        surplus: ecart.surplus,
      })
    })

    const detail = [...ops].sort((a, b) => b.date.localeCompare(a.date))

    return {
      ops,
      parType,
      lignesCaissiers,
      entrees,
      sorties,
      totalManquant,
      totalSurplus,
      detail,
    }
  }, [
    data.transactions,
    data.arretsCaisse,
    data.employes,
    data.agences,
    periode,
    caissierId,
    estAdmin,
    estChefAgence,
    agenceFiltreOperations,
    employeConnecte,
  ])

  const portefeuille = useMemo(() => {
    const actifs = data.credits.filter((c) => c.statut === 'en_cours' || c.statut === 'en_retard')
    const lignes = actifs.map((c) => {
      const client = data.clients.find((x) => x.id === c.clientId)
      const sit = situationCredit(c, data.remboursements)
      return { credit: c, client, sit }
    })
    const enRetard = lignes.filter((l) => l.credit.statut === 'en_retard')
    return { lignes, enRetard }
  }, [data])

  const exporterClients = () => {
    exporterCsv(`clients_${aujourdhuiLocalIso()}.csv`, [
      [
        'ID client',
        'Nom',
        'Prénom',
        'Sexe',
        'Téléphone',
        'Email',
        'Profession',
        'Adresse',
        "Pièce d'identité",
        'Inscrit le',
        'Statut',
      ],
      ...data.clients.map((c) => [
        c.codeClient,
        c.nom,
        c.prenom,
        c.sexe,
        c.telephone,
        c.email ?? '',
        c.profession ?? '',
        c.adresse ?? '',
        c.pieceIdentite ?? '',
        formatDate(c.dateInscription),
        c.actif ? 'Actif' : 'Inactif',
      ]),
    ])
  }

  const exporterPortefeuille = () => {
    exporterCsv(`portefeuille_credits_${aujourdhuiLocalIso()}.csv`, [
      [
        'N° crédit',
        'Client',
        'Montant',
        'Taux (%)',
        'Durée (mois)',
        'Total dû',
        'Déjà payé',
        'Reste à payer',
        'Statut',
      ],
      ...portefeuille.lignes.map(({ credit, client, sit }) => [
        credit.numero,
        client ? `${client.prenom} ${client.nom}` : 'Inconnu',
        credit.montant,
        credit.tauxInteret,
        credit.dureeMois,
        Math.round(sit.totalDu),
        Math.round(sit.dejaPaye),
        Math.round(sit.resteAPayer),
        credit.statut === 'en_retard' ? 'En retard' : 'En cours',
      ]),
    ])
  }

  const exporterRapportCaisse = () => {
    const suffixe =
      modePeriode === 'mois' ? mois || moisEnCoursLocal() : `${periode.debut}_${periode.fin}`
    exporterCsv(`rapport_caisses_${suffixe}.csv`, [
      ['Caissier', 'Agence', 'Nb opérations', 'Dépôts', 'Retraits', 'Net', 'Manquant', 'Surplus'],
      ...rapportCaisse.lignesCaissiers.map((l) => [
        l.nom,
        l.agenceNom,
        l.nombre,
        l.entrees,
        l.sorties,
        l.net,
        l.manquant,
        l.surplus,
      ]),
      [],
      ['Type', 'Nombre', 'Entrées', 'Sorties'],
      ...[...rapportCaisse.parType.entries()].map(([type, l]) => [
        LIBELLES_TYPE[type as keyof typeof LIBELLES_TYPE],
        l.nombre,
        l.entrees,
        l.sorties,
      ]),
      ['TOTAL', rapportCaisse.ops.length, rapportCaisse.entrees, rapportCaisse.sorties],
    ])
  }

  return (
    <div>
      <EnTetePage
        titre="Rapports"
        sousTitre="États de synthèse, exports Excel et impression"
        action={
          <button className="btn-secondary" onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            Imprimer / PDF
          </button>
        }
      />

      <div className="card mb-6 !p-0 overflow-hidden print:overflow-visible">
        <div className="space-y-3 border-b border-slate-200 px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-slate-900">Rapport des caisses</h3>
              <p className="text-sm text-slate-500">
                Opérations (dépôts / retraits) — {libellePeriode}
              </p>
            </div>
            <button
              className="btn-secondary !py-2 text-xs print:hidden"
              onClick={exporterRapportCaisse}
              disabled={
                rapportCaisse.ops.length === 0 && rapportCaisse.lignesCaissiers.length === 0
              }
            >
              <Download className="h-3.5 w-3.5" />
              Excel
            </button>
          </div>

          <div className="flex flex-wrap items-end gap-3 print:hidden">
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

            {caissiersDisponibles.length > 1 && (
              <div>
                <label className="label !mb-1">Caisse</label>
                <select
                  className="input !w-auto min-w-[12rem]"
                  value={caissierId}
                  onChange={(e) => setCaissierId(e.target.value)}
                >
                  <option value="tous">Toutes les caisses</option>
                  {caissiersDisponibles.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.nomComplet}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 p-5 lg:grid-cols-5">
          <div className="rounded-xl bg-emerald-50 px-3 py-2">
            <div className="text-xs text-emerald-700">Dépôts</div>
            <div className="font-bold text-emerald-800">{formatMontant(rapportCaisse.entrees)}</div>
          </div>
          <div className="rounded-xl bg-rose-50 px-3 py-2">
            <div className="text-xs text-rose-700">Retraits</div>
            <div className="font-bold text-rose-800">{formatMontant(rapportCaisse.sorties)}</div>
          </div>
          <div className="rounded-xl bg-slate-50 px-3 py-2">
            <div className="text-xs text-slate-500">Net</div>
            <div
              className={`font-bold ${
                rapportCaisse.entrees - rapportCaisse.sorties >= 0
                  ? 'text-emerald-700'
                  : 'text-rose-700'
              }`}
            >
              {formatMontant(rapportCaisse.entrees - rapportCaisse.sorties)}
            </div>
          </div>
          <div className="rounded-xl bg-rose-50/70 px-3 py-2">
            <div className="text-xs text-rose-700">Manquants (clôtures)</div>
            <div className="font-bold text-rose-800">
              {formatMontant(rapportCaisse.totalManquant)}
            </div>
          </div>
          <div className="rounded-xl bg-sky-50 px-3 py-2">
            <div className="text-xs text-sky-700">Surplus (clôtures)</div>
            <div className="font-bold text-sky-800">
              {formatMontant(rapportCaisse.totalSurplus)}
            </div>
          </div>
        </div>

        <div className="border-t border-slate-100 px-5 pb-5">
          <h4 className="mb-3 text-sm font-semibold text-slate-800">
            Synthèse par caisse ({rapportCaisse.lignesCaissiers.length})
          </h4>
          {rapportCaisse.lignesCaissiers.length === 0 ? (
            <p className="text-sm text-slate-500">Aucune opération ni clôture sur cette période.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2.5 pr-4">Caissier</th>
                    <th className="py-2.5 pr-4">Agence</th>
                    <th className="py-2.5 pr-4 text-right">Ops</th>
                    <th className="py-2.5 pr-4 text-right">Dépôts</th>
                    <th className="py-2.5 pr-4 text-right">Retraits</th>
                    <th className="py-2.5 pr-4 text-right">Net</th>
                    <th className="py-2.5 pr-4 text-right">Manquant</th>
                    <th className="py-2.5 text-right">Surplus</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rapportCaisse.lignesCaissiers.map((l) => (
                    <tr key={l.id}>
                      <td className="py-2.5 pr-4 font-medium text-slate-800">{l.nom}</td>
                      <td className="py-2.5 pr-4 text-slate-600">{l.agenceNom}</td>
                      <td className="py-2.5 pr-4 text-right text-slate-600">{l.nombre}</td>
                      <td className="py-2.5 pr-4 text-right font-semibold text-emerald-600">
                        {formatMontant(l.entrees)}
                      </td>
                      <td className="py-2.5 pr-4 text-right font-semibold text-rose-600">
                        {formatMontant(l.sorties)}
                      </td>
                      <td className="py-2.5 pr-4 text-right font-semibold text-slate-800">
                        {formatMontant(l.net)}
                      </td>
                      <td className="py-2.5 pr-4 text-right text-rose-700">
                        {l.manquant ? formatMontant(l.manquant) : '—'}
                      </td>
                      <td className="py-2.5 text-right text-sky-700">
                        {l.surplus ? formatMontant(l.surplus) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="border-t border-slate-100 px-5 pb-5">
          <h4 className="mb-3 text-sm font-semibold text-slate-800">Par type d’opération</h4>
          {rapportCaisse.parType.size === 0 ? (
            <p className="text-sm text-slate-500">Aucun mouvement sur la période.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2.5 pr-4">Type</th>
                  <th className="py-2.5 pr-4 text-right">Nombre</th>
                  <th className="py-2.5 pr-4 text-right">Dépôts</th>
                  <th className="py-2.5 text-right">Retraits</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[...rapportCaisse.parType.entries()].map(([type, l]) => (
                  <tr key={type}>
                    <td className="py-2.5 pr-4 text-slate-800">
                      {LIBELLES_TYPE[type as keyof typeof LIBELLES_TYPE]}
                    </td>
                    <td className="py-2.5 pr-4 text-right text-slate-600">{l.nombre}</td>
                    <td className="py-2.5 pr-4 text-right font-semibold text-emerald-600">
                      {l.entrees ? formatMontant(l.entrees) : '—'}
                    </td>
                    <td className="py-2.5 text-right font-semibold text-rose-600">
                      {l.sorties ? formatMontant(l.sorties) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 font-bold">
                  <td className="py-2.5 pr-4">TOTAL</td>
                  <td className="py-2.5 pr-4 text-right">{rapportCaisse.ops.length}</td>
                  <td className="py-2.5 pr-4 text-right text-emerald-700">
                    {formatMontant(rapportCaisse.entrees)}
                  </td>
                  <td className="py-2.5 text-right text-rose-700">
                    {formatMontant(rapportCaisse.sorties)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        <div className="border-t border-slate-100 px-5 pb-5">
          <h4 className="mb-3 text-sm font-semibold text-slate-800">
            Détail des opérations ({rapportCaisse.detail.length})
          </h4>
          {rapportCaisse.detail.length === 0 ? (
            <p className="text-sm text-slate-500">Aucune opération à lister.</p>
          ) : (
            <div className="max-h-[28rem] overflow-auto print:max-h-none print:overflow-visible">
              <table className="w-full min-w-[640px] text-sm print:min-w-0">
                <thead className="sticky top-0 bg-white print:static">
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2.5 pr-4">Date</th>
                    <th className="py-2.5 pr-4">Type</th>
                    <th className="py-2.5 pr-4">Description</th>
                    <th className="py-2.5 pr-4">Caissier</th>
                    <th className="py-2.5 text-right">Montant</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rapportCaisse.detail.map((t) => {
                    const sortie = TYPES_SORTIE.includes(t.type)
                    return (
                      <tr key={t.id}>
                        <td className="py-2 pr-4 whitespace-nowrap text-slate-600">
                          {formatDateHeure(t.date)}
                        </td>
                        <td className="py-2 pr-4 text-slate-700">{LIBELLES_TYPE[t.type]}</td>
                        <td className="py-2 pr-4 text-slate-800">{t.description}</td>
                        <td className="py-2 pr-4 text-slate-600">{t.operateur}</td>
                        <td
                          className={`py-2 text-right font-semibold ${
                            sortie ? 'text-rose-600' : 'text-emerald-600'
                          }`}
                        >
                          {sortie ? '−' : '+'}
                          {formatMontant(t.montant)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {MODULE_CREDITS_ACTIF && (
        <div className="card mb-6 print:hidden">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-semibold text-slate-900">
              Portefeuille de crédits actifs ({portefeuille.lignes.length}
              {portefeuille.enRetard.length > 0 && (
                <span className="text-rose-600">
                  {' '}
                  dont {portefeuille.enRetard.length} en retard
                </span>
              )}
              )
            </h3>
            <button
              className="btn-secondary !py-2 text-xs print:hidden"
              onClick={exporterPortefeuille}
              disabled={portefeuille.lignes.length === 0}
            >
              <Download className="h-3.5 w-3.5" />
              Excel
            </button>
          </div>
          {portefeuille.lignes.length === 0 ? (
            <p className="text-sm text-slate-500">Aucun crédit actif.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2.5 pr-4">N°</th>
                    <th className="py-2.5 pr-4">Client</th>
                    <th className="py-2.5 pr-4 text-right">Montant</th>
                    <th className="py-2.5 pr-4 text-right">Déjà payé</th>
                    <th className="py-2.5 pr-4 text-right">Reste dû</th>
                    <th className="py-2.5">Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {portefeuille.lignes.map(({ credit, client, sit }) => (
                    <tr key={credit.id}>
                      <td className="py-2.5 pr-4 font-mono text-xs font-semibold text-brand-700">
                        {credit.numero}
                      </td>
                      <td className="py-2.5 pr-4 text-slate-800">
                        {client ? `${client.prenom} ${client.nom}` : 'Inconnu'}
                      </td>
                      <td className="py-2.5 pr-4 text-right text-slate-600">
                        {formatMontant(credit.montant)}
                      </td>
                      <td className="py-2.5 pr-4 text-right text-slate-600">
                        {formatMontant(Math.round(sit.dejaPaye))}
                      </td>
                      <td className="py-2.5 pr-4 text-right font-semibold text-slate-900">
                        {formatMontant(Math.round(sit.resteAPayer))}
                      </td>
                      <td className="py-2.5">
                        <span
                          className={`badge ${
                            credit.statut === 'en_retard'
                              ? 'bg-rose-100 text-rose-700'
                              : 'bg-sky-100 text-sky-700'
                          }`}
                        >
                          {credit.statut === 'en_retard' ? 'En retard' : 'En cours'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="card flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h3 className="font-semibold text-slate-900">Liste des clients</h3>
          <p className="text-sm text-slate-500">
            Export complet des {data.clients.length} clients avec leurs informations personnelles.
          </p>
        </div>
        <button className="btn-secondary print:hidden" onClick={exporterClients}>
          <Download className="h-4 w-4" />
          Exporter (Excel)
        </button>
      </div>
    </div>
  )
}
