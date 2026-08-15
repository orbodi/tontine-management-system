import { useMemo, useState } from 'react'
import { Download, Printer } from 'lucide-react'
import { MODULE_CREDITS_ACTIF } from '../config'
import { useStore } from '../store'
import { LIBELLES_TYPE, TYPES_SORTIE, situationCredit } from '../metier'
import { exporterCsv, formatDate, formatMontant } from '../utils'
import { EnTetePage } from '../components/ui'

function aujourdHuiIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export default function Rapports() {
  const { data } = useStore()
  const [dateCaisse, setDateCaisse] = useState(aujourdHuiIso())

  // ----- État de caisse du jour choisi -----
  const caisse = useMemo(() => {
    const duJour = data.transactions.filter((t) => t.date.slice(0, 10) === dateCaisse)
    const parType = new Map<string, { entrees: number; sorties: number; nombre: number }>()
    let entrees = 0
    let sorties = 0
    duJour.forEach((t) => {
      const ligne = parType.get(t.type) ?? { entrees: 0, sorties: 0, nombre: 0 }
      ligne.nombre++
      if (TYPES_SORTIE.includes(t.type)) {
        ligne.sorties += t.montant
        sorties += t.montant
      } else {
        ligne.entrees += t.montant
        entrees += t.montant
      }
      parType.set(t.type, ligne)
    })
    return { duJour, parType, entrees, sorties }
  }, [data.transactions, dateCaisse])

  // ----- Portefeuille de crédits -----
  const portefeuille = useMemo(() => {
    const actifs = data.credits.filter((c) => c.statut === 'en_cours' || c.statut === 'en_retard')
    const lignes = actifs.map((c) => {
      const client = data.clients.find((x) => x.id === c.clientId)
      const sit = situationCredit(c, data.remboursements)
      return { credit: c, client, sit }
    })
    const encours = lignes.reduce((s, l) => s + l.sit.resteAPayer, 0)
    const enRetard = lignes.filter((l) => l.credit.statut === 'en_retard')
    return { lignes, encours, enRetard }
  }, [data])

  // ----- Comptes et carnets -----
  const epargne = useMemo(() => {
    const totalCourant = data.comptes.filter((c) => c.type === 'courant').reduce((s, c) => s + c.solde, 0)
    const totalEpargne = data.comptes.filter((c) => c.type === 'epargne').reduce((s, c) => s + c.solde, 0)
    const encoursTontine = data.carnets
      .filter((c) => c.actif)
      .reduce((s, carnet) => {
        const mises = data.mises
          .filter((m) => m.carnetId === carnet.id && m.cycle === carnet.cycleActuel)
          .reduce((x, m) => x + m.nombreMises, 0)
        return s + mises * carnet.mise
      }, 0)
    // Revenus de la microfinance : premières cotisations (P.C) + ventes de carnets
    const revenus = data.transactions
      .filter((t) => t.type === 'commission_tontine' || t.type === 'vente_carnet')
      .reduce((s, t) => s + t.montant, 0)
    return { totalCourant, totalEpargne, encoursTontine, revenus }
  }, [data])

  const exporterClients = () => {
    exporterCsv(`clients_${aujourdHuiIso()}.csv`, [
      ['ID client', 'Nom', 'Prénom', 'Sexe', 'Téléphone', 'Email', 'Profession', 'Adresse', 'Pièce d\'identité', 'Inscrit le', 'Statut'],
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
    exporterCsv(`portefeuille_credits_${aujourdHuiIso()}.csv`, [
      ['N° crédit', 'Client', 'Montant', 'Taux (%)', 'Durée (mois)', 'Total dû', 'Déjà payé', 'Reste à payer', 'Statut'],
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

  const exporterCaisse = () => {
    exporterCsv(`caisse_${dateCaisse}.csv`, [
      ['Type', 'Nombre', 'Entrées (FCFA)', 'Sorties (FCFA)'],
      ...[...caisse.parType.entries()].map(([type, l]) => [
        LIBELLES_TYPE[type as keyof typeof LIBELLES_TYPE],
        l.nombre,
        l.entrees,
        l.sorties,
      ]),
      ['TOTAL', caisse.duJour.length, caisse.entrees, caisse.sorties],
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

      {/* Synthèse générale */}
      <div className={`mb-6 grid grid-cols-2 gap-4 ${MODULE_CREDITS_ACTIF ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
        <div className="card">
          <div className="text-xs text-slate-500">Encours comptes courants</div>
          <div className="mt-1 text-lg font-bold text-slate-900">{formatMontant(epargne.totalCourant)}</div>
        </div>
        <div className="card">
          <div className="text-xs text-slate-500">Encours d'épargne</div>
          <div className="mt-1 text-lg font-bold text-slate-900">{formatMontant(epargne.totalEpargne)}</div>
        </div>
        <div className="card">
          <div className="text-xs text-slate-500">Encours tontine & cartes</div>
          <div className="mt-1 text-lg font-bold text-slate-900">{formatMontant(epargne.encoursTontine)}</div>
        </div>
        {MODULE_CREDITS_ACTIF && (
          <div className="card">
            <div className="text-xs text-slate-500">Encours de crédits</div>
            <div className="mt-1 text-lg font-bold text-slate-900">{formatMontant(portefeuille.encours)}</div>
          </div>
        )}
        <div className="card">
          <div className="text-xs text-slate-500">Revenus microfinance (P.C + carnets)</div>
          <div className="mt-1 text-lg font-bold text-brand-700">{formatMontant(epargne.revenus)}</div>
        </div>
      </div>

      {/* État de caisse */}
      <div className="card mb-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold text-slate-900">État de caisse journalier</h3>
          <div className="flex items-center gap-2 print:hidden">
            <input
              className="input !w-auto"
              type="date"
              value={dateCaisse}
              onChange={(e) => setDateCaisse(e.target.value)}
            />
            <button className="btn-secondary !py-2 text-xs" onClick={exporterCaisse} disabled={caisse.duJour.length === 0}>
              <Download className="h-3.5 w-3.5" />
              Excel
            </button>
          </div>
        </div>
        {caisse.duJour.length === 0 ? (
          <p className="text-sm text-slate-500">Aucune opération le {formatDate(dateCaisse + 'T12:00:00')}.</p>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2.5 pr-4">Type d'opération</th>
                  <th className="py-2.5 pr-4 text-right">Nombre</th>
                  <th className="py-2.5 pr-4 text-right">Entrées</th>
                  <th className="py-2.5 text-right">Sorties</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[...caisse.parType.entries()].map(([type, l]) => (
                  <tr key={type}>
                    <td className="py-2.5 pr-4 text-slate-800">{LIBELLES_TYPE[type as keyof typeof LIBELLES_TYPE]}</td>
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
                  <td className="py-2.5 pr-4 text-right">{caisse.duJour.length}</td>
                  <td className="py-2.5 pr-4 text-right text-emerald-700">{formatMontant(caisse.entrees)}</td>
                  <td className="py-2.5 text-right text-rose-700">{formatMontant(caisse.sorties)}</td>
                </tr>
              </tfoot>
            </table>
            <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm">
              Solde net de la journée :{' '}
              <span className={`font-bold ${caisse.entrees - caisse.sorties >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                {formatMontant(caisse.entrees - caisse.sorties)}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Portefeuille de crédits */}
      {MODULE_CREDITS_ACTIF && (
      <div className="card mb-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold text-slate-900">
            Portefeuille de crédits actifs ({portefeuille.lignes.length}
            {portefeuille.enRetard.length > 0 && (
              <span className="text-rose-600"> dont {portefeuille.enRetard.length} en retard</span>
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
                    <td className="py-2.5 pr-4 font-mono text-xs font-semibold text-brand-700">{credit.numero}</td>
                    <td className="py-2.5 pr-4 text-slate-800">
                      {client ? `${client.prenom} ${client.nom}` : 'Inconnu'}
                    </td>
                    <td className="py-2.5 pr-4 text-right text-slate-600">{formatMontant(credit.montant)}</td>
                    <td className="py-2.5 pr-4 text-right text-slate-600">{formatMontant(Math.round(sit.dejaPaye))}</td>
                    <td className="py-2.5 pr-4 text-right font-semibold text-slate-900">
                      {formatMontant(Math.round(sit.resteAPayer))}
                    </td>
                    <td className="py-2.5">
                      <span className={`badge ${credit.statut === 'en_retard' ? 'bg-rose-100 text-rose-700' : 'bg-sky-100 text-sky-700'}`}>
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

      {/* Export clients */}
      <div className="card flex flex-wrap items-center justify-between gap-3">
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
