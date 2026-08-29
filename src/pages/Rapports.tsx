import { useMemo, useState } from 'react'
import { Download, Printer } from 'lucide-react'
import { MODULE_CREDITS_ACTIF, NOM_APPLICATION } from '../config'
import { LIBELLES_ROLE, useStore } from '../store'
import {
  dateClotureArret,
  estOperationCaisse,
  LIBELLES_TYPE,
  TYPES_SORTIE,
  situationCredit,
} from '../metier'
import type { TypeCompte } from '../types'
import { exporterCsv, formatDate, formatDateHeure, formatMontant, afficherNumeroClient } from '../utils'
import { EnTetePage } from '../components/ui'

const LIBELLES_COMPTE: Record<TypeCompte, string> = {
  courant: 'Compte courant',
  epargne: 'Compte épargne',
}

type OngletRapport = 'caisses' | 'compte' | 'clients' | 'employes'

const ONGLETS_RAPPORT: { id: OngletRapport; label: string }[] = [
  { id: 'caisses', label: 'Caisse' },
  { id: 'compte', label: 'Compte' },
  { id: 'clients', label: 'Client' },
  { id: 'employes', label: 'Employés' },
]

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
  const [onglet, setOnglet] = useState<OngletRapport>('caisses')

  const [rechercheCompte, setRechercheCompte] = useState('')
  const [compteId, setCompteId] = useState('')
  const [modePeriodeCompte, setModePeriodeCompte] = useState<'mois' | 'intervalle' | 'tout'>('mois')
  const [moisCompte, setMoisCompte] = useState(moisEnCoursLocal)
  const [debutCompte, setDebutCompte] = useState(bornesInit.debut)
  const [finCompte, setFinCompte] = useState(bornesInit.fin)
  const [rechercheClient, setRechercheClient] = useState('')
  const [rechercheEmploye, setRechercheEmploye] = useState('')

  const imprimer = (zone: OngletRapport = onglet) => {
    setOnglet(zone)
    window.setTimeout(() => window.print(), 80)
  }

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

  const comptesDisponibles = useMemo(() => {
    const q = rechercheCompte.trim().toLowerCase()
    return data.comptes
      .filter((c) => {
        const client = data.clients.find((x) => x.id === c.clientId)
        if (!client) return false
        if (estAdmin) {
          // tout
        } else if (estChefAgence && agenceFiltreOperations) {
          if (client.agenceId !== agenceFiltreOperations) return false
        }
        if (!q) return true
        return (
          c.numero.toLowerCase().includes(q) ||
          client.codeClient?.toLowerCase().includes(q) ||
          afficherNumeroClient(client.codeClient).includes(q) ||
          `${client.prenom} ${client.nom}`.toLowerCase().includes(q)
        )
      })
      .sort((a, b) => a.numero.localeCompare(b.numero))
  }, [
    data.comptes,
    data.clients,
    rechercheCompte,
    estAdmin,
    estChefAgence,
    agenceFiltreOperations,
  ])

  const periodeCompte = useMemo(() => {
    if (modePeriodeCompte === 'tout') return null
    if (modePeriodeCompte === 'mois') return bornesMois(moisCompte || moisEnCoursLocal())
    return {
      debut: debutCompte || bornesMois(moisEnCoursLocal()).debut,
      fin: finCompte || bornesMois(moisEnCoursLocal()).fin,
    }
  }, [modePeriodeCompte, moisCompte, debutCompte, finCompte])

  const libellePeriodeCompte =
    modePeriodeCompte === 'tout'
      ? 'historique complet'
      : modePeriodeCompte === 'mois'
        ? libelleMois(moisCompte || moisEnCoursLocal())
        : `du ${formatDate((periodeCompte?.debut ?? '') + 'T12:00:00')} au ${formatDate((periodeCompte?.fin ?? '') + 'T12:00:00')}`

  const rapportCompte = useMemo(() => {
    const compte = data.comptes.find((c) => c.id === compteId)
    if (!compte) return null
    const client = data.clients.find((c) => c.id === compte.clientId)
    const agence = client ? data.agences.find((a) => a.id === client.agenceId) : undefined
    let mouvements = data.mouvements
      .filter((m) => m.compteId === compte.id)
      .sort((a, b) => a.date.localeCompare(b.date))
    if (periodeCompte) {
      mouvements = mouvements.filter((m) => {
        const jour = m.date.slice(0, 10)
        return jour >= periodeCompte.debut && jour <= periodeCompte.fin
      })
    }
    let totalDepots = 0
    let totalRetraits = 0
    mouvements.forEach((m) => {
      if (m.type === 'depot') totalDepots += m.montant
      else totalRetraits += m.montant
    })
    return {
      compte,
      client,
      agence,
      mouvements: [...mouvements].sort((a, b) => b.date.localeCompare(a.date)),
      totalDepots,
      totalRetraits,
      net: totalDepots - totalRetraits,
    }
  }, [data.comptes, data.clients, data.agences, data.mouvements, compteId, periodeCompte])

  const clientsRapport = useMemo(() => {
    const q = rechercheClient.trim().toLowerCase()
    return data.clients
      .filter((c) => {
        if (estChefAgence && agenceFiltreOperations && c.agenceId !== agenceFiltreOperations) {
          return false
        }
        if (!q) return true
        return (
          (c.codeClient ?? '').toLowerCase().includes(q) ||
          afficherNumeroClient(c.codeClient).includes(q) ||
          c.nom.toLowerCase().includes(q) ||
          c.prenom.toLowerCase().includes(q) ||
          c.telephone.toLowerCase().includes(q)
        )
      })
      .sort((a, b) => (a.codeClient ?? '').localeCompare(b.codeClient ?? ''))
  }, [data.clients, rechercheClient, estChefAgence, agenceFiltreOperations])

  const employesRapport = useMemo(() => {
    const q = rechercheEmploye.trim().toLowerCase()
    return data.employes
      .filter((e) => {
        if (!estAdmin) {
          if (estChefAgence && agenceFiltreOperations) {
            if (e.agenceId !== agenceFiltreOperations) return false
          } else {
            return false
          }
        }
        if (!q) return true
        return (
          e.nomComplet.toLowerCase().includes(q) ||
          e.identifiant.toLowerCase().includes(q) ||
          LIBELLES_ROLE[e.role].toLowerCase().includes(q)
        )
      })
      .sort((a, b) => a.nomComplet.localeCompare(b.nomComplet, 'fr'))
  }, [
    data.employes,
    rechercheEmploye,
    estAdmin,
    estChefAgence,
    agenceFiltreOperations,
  ])

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
        'Agence',
        'Zone',
        'Statut',
      ],
      ...clientsRapport.map((c) => {
        const agence = data.agences.find((a) => a.id === c.agenceId)
        const zoneClient = data.zones.find((z) => z.id === c.zoneId)
        return [
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
          agence?.nom ?? '',
          zoneClient ? `${zoneClient.code}${zoneClient.nom ? ` — ${zoneClient.nom}` : ''}` : '',
          c.actif ? 'Actif' : 'Inactif',
        ]
      }),
    ])
  }

  const exporterEmployes = () => {
    exporterCsv(`employes_${aujourdhuiLocalIso()}.csv`, [
      [
        'Nom',
        'Identifiant',
        'Rôle',
        'Agence',
        'Téléphone',
        'Email',
        'Embauche',
        'Statut',
      ],
      ...employesRapport.map((e) => {
        const agence = data.agences.find((a) => a.id === e.agenceId)
        return [
          e.nomComplet,
          e.identifiant,
          LIBELLES_ROLE[e.role],
          agence ? `${agence.code} — ${agence.nom}` : '',
          e.telephone ?? '',
          e.email ?? '',
          formatDate(e.dateEmbauche),
          e.actif ? 'Actif' : 'Inactif',
        ]
      }),
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

  const ongletsVisibles = useMemo(() => {
    return ONGLETS_RAPPORT.filter((o) => {
      if (o.id === 'employes') return estAdmin || estChefAgence
      return true
    })
  }, [estAdmin, estChefAgence])

  return (
    <div>
      <EnTetePage
        titre="Rapports"
        sousTitre="États de synthèse, exports Excel et impression"
        action={
          <button
            className="btn-secondary"
            onClick={() => imprimer()}
            disabled={onglet === 'compte' && !rapportCompte}
          >
            <Printer className="h-4 w-4" />
            Imprimer
          </button>
        }
      />

      <div className="mb-6 flex flex-wrap gap-2 print:hidden">
        {ongletsVisibles.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setOnglet(id)}
            className={`rounded-xl px-3.5 py-2 text-sm font-medium transition ${
              onglet === id
                ? 'bg-brand-600 text-white'
                : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {onglet === 'caisses' && (
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
      )}

      {onglet === 'compte' && (
      <div className="card mb-6 !p-0 overflow-hidden print:overflow-visible">
        <div className="space-y-3 border-b border-slate-200 px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-slate-900">Rapport de compte</h3>
              <p className="text-sm text-slate-500">
                Choisissez un compte courant ou épargne, puis imprimez le relevé.
              </p>
            </div>
            <button
              className="btn-secondary !py-2 text-xs print:hidden"
              onClick={() => imprimer('compte')}
              disabled={!rapportCompte}
            >
              <Printer className="h-3.5 w-3.5" />
              Imprimer
            </button>
          </div>

          <div className="flex flex-wrap items-end gap-3 print:hidden">
            <div className="min-w-[12rem] flex-1">
              <label className="label !mb-1">Rechercher</label>
              <input
                className="input"
                placeholder="N° compte, client…"
                value={rechercheCompte}
                onChange={(e) => setRechercheCompte(e.target.value)}
              />
            </div>
            <div className="min-w-[16rem] flex-[2]">
              <label className="label !mb-1">Compte</label>
              <select
                className="input"
                value={compteId}
                onChange={(e) => setCompteId(e.target.value)}
              >
                <option value="">— Sélectionner un compte —</option>
                {comptesDisponibles.map((c) => {
                  const client = data.clients.find((x) => x.id === c.clientId)
                  return (
                    <option key={c.id} value={c.id}>
                      {c.numero} — {LIBELLES_COMPTE[c.type]}
                      {client ? ` — ${client.prenom} ${client.nom}` : ''}
                    </option>
                  )
                })}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3 print:hidden">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['mois', 'Par mois'],
                  ['intervalle', 'Par intervalle'],
                  ['tout', 'Tout l’historique'],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => {
                    setModePeriodeCompte(v)
                    if (v === 'mois') setMoisCompte(moisEnCoursLocal())
                    if (v === 'intervalle') {
                      const b = bornesMois(moisCompte || moisEnCoursLocal())
                      setDebutCompte(b.debut)
                      setFinCompte(b.fin)
                    }
                  }}
                  className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${
                    modePeriodeCompte === v
                      ? 'bg-brand-600 text-white'
                      : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {modePeriodeCompte === 'mois' && (
              <div>
                <label className="label !mb-1">Mois</label>
                <input
                  className="input !w-auto"
                  type="month"
                  value={moisCompte || moisEnCoursLocal()}
                  max={moisEnCoursLocal()}
                  onChange={(e) => setMoisCompte(e.target.value)}
                />
              </div>
            )}
            {modePeriodeCompte === 'intervalle' && (
              <>
                <div>
                  <label className="label !mb-1">Du</label>
                  <input
                    className="input !w-auto"
                    type="date"
                    value={debutCompte}
                    max={finCompte || aujourdhuiLocalIso()}
                    onChange={(e) => setDebutCompte(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label !mb-1">Au</label>
                  <input
                    className="input !w-auto"
                    type="date"
                    value={finCompte}
                    min={debutCompte || undefined}
                    max={aujourdhuiLocalIso()}
                    onChange={(e) => setFinCompte(e.target.value)}
                  />
                </div>
              </>
            )}
          </div>
        </div>

        {!rapportCompte ? (
          <div className="p-5">
            <p className="text-sm text-slate-500">
              Sélectionnez un compte pour afficher et imprimer son relevé.
            </p>
          </div>
        ) : (
          <>
            <div className="hidden border-b border-slate-200 px-5 py-4 print:block">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {NOM_APPLICATION} — Relevé de compte
              </div>
              <div className="mt-1 text-lg font-bold text-slate-900">
                {rapportCompte.compte.numero} — {LIBELLES_COMPTE[rapportCompte.compte.type]}
              </div>
              <p className="text-sm text-slate-600">Période : {libellePeriodeCompte}</p>
            </div>

            <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4">
              <div className="rounded-xl bg-slate-50 px-3 py-2 sm:col-span-2">
                <div className="text-xs text-slate-500">Titulaire</div>
                <div className="font-semibold text-slate-900">
                  {rapportCompte.client
                    ? `${rapportCompte.client.prenom} ${rapportCompte.client.nom}`
                    : '—'}
                </div>
                <div className="text-xs text-slate-500">
                  {afficherNumeroClient(rapportCompte.client.codeClient)}
                  {rapportCompte.agence ? ` · ${rapportCompte.agence.nom}` : ''}
                </div>
              </div>
              <div className="rounded-xl bg-brand-50 px-3 py-2">
                <div className="text-xs text-brand-700">Solde actuel</div>
                <div className="font-bold text-brand-800">
                  {formatMontant(rapportCompte.compte.solde)}
                </div>
              </div>
              <div className="rounded-xl bg-slate-50 px-3 py-2">
                <div className="text-xs text-slate-500">Ouvert le</div>
                <div className="font-semibold text-slate-800">
                  {formatDate(rapportCompte.compte.dateOuverture)}
                </div>
                {rapportCompte.compte.verrouille && (
                  <span className="badge mt-1 bg-rose-100 text-rose-700">Verrouillé</span>
                )}
              </div>
              <div className="rounded-xl bg-emerald-50 px-3 py-2">
                <div className="text-xs text-emerald-700">Dépôts (période)</div>
                <div className="font-bold text-emerald-800">
                  {formatMontant(rapportCompte.totalDepots)}
                </div>
              </div>
              <div className="rounded-xl bg-rose-50 px-3 py-2">
                <div className="text-xs text-rose-700">Retraits (période)</div>
                <div className="font-bold text-rose-800">
                  {formatMontant(rapportCompte.totalRetraits)}
                </div>
              </div>
              <div className="rounded-xl bg-slate-50 px-3 py-2 sm:col-span-2">
                <div className="text-xs text-slate-500">Net période — {libellePeriodeCompte}</div>
                <div
                  className={`font-bold ${
                    rapportCompte.net >= 0 ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {formatMontant(rapportCompte.net)}
                </div>
                <div className="text-xs text-slate-500">
                  {rapportCompte.mouvements.length} mouvement
                  {rapportCompte.mouvements.length > 1 ? 's' : ''}
                </div>
              </div>
            </div>

            <div className="border-t border-slate-100 px-5 pb-5">
              <h4 className="mb-3 text-sm font-semibold text-slate-800">
                Mouvements ({rapportCompte.mouvements.length})
              </h4>
              {rapportCompte.mouvements.length === 0 ? (
                <p className="text-sm text-slate-500">Aucun mouvement sur cette période.</p>
              ) : (
                <div className="max-h-[28rem] overflow-auto print:max-h-none print:overflow-visible">
                  <table className="w-full min-w-[520px] text-sm print:min-w-0">
                    <thead className="sticky top-0 bg-white print:static">
                      <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                        <th className="py-2.5 pr-4">Date</th>
                        <th className="py-2.5 pr-4">Type</th>
                        <th className="py-2.5 pr-4">Note</th>
                        <th className="py-2.5 text-right">Montant</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {rapportCompte.mouvements.map((m) => (
                        <tr key={m.id}>
                          <td className="py-2 pr-4 whitespace-nowrap text-slate-600">
                            {formatDateHeure(m.date)}
                          </td>
                          <td className="py-2 pr-4 text-slate-800">
                            {m.type === 'depot' ? 'Dépôt' : 'Retrait'}
                          </td>
                          <td className="py-2 pr-4 text-slate-500">{m.note || '—'}</td>
                          <td
                            className={`py-2 text-right font-semibold ${
                              m.type === 'depot' ? 'text-emerald-600' : 'text-rose-600'
                            }`}
                          >
                            {m.type === 'depot' ? '+' : '−'}
                            {formatMontant(m.montant)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
      )}

      {onglet === 'clients' && (
        <div className="card mb-6 !p-0 overflow-hidden print:overflow-visible">
          <div className="space-y-3 border-b border-slate-200 px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-slate-900">
                  Rapport clients ({clientsRapport.length})
                </h3>
                <p className="text-sm text-slate-500">
                  Liste des clients — recherche, export et impression
                </p>
              </div>
              <div className="flex flex-wrap gap-2 print:hidden">
                <button
                  className="btn-secondary !py-2 text-xs"
                  onClick={exporterClients}
                  disabled={clientsRapport.length === 0}
                >
                  <Download className="h-3.5 w-3.5" />
                  Excel
                </button>
                <button
                  className="btn-secondary !py-2 text-xs"
                  onClick={() => imprimer('clients')}
                  disabled={clientsRapport.length === 0}
                >
                  <Printer className="h-3.5 w-3.5" />
                  Imprimer
                </button>
              </div>
            </div>
            <div className="print:hidden">
              <label className="label !mb-1">Rechercher</label>
              <input
                className="input max-w-md"
                placeholder="Code, nom, téléphone…"
                value={rechercheClient}
                onChange={(e) => setRechercheClient(e.target.value)}
              />
            </div>
          </div>

          <div className="hidden border-b border-slate-200 px-5 py-4 print:block">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {NOM_APPLICATION} — Rapport clients
            </div>
            <p className="text-sm text-slate-600">{clientsRapport.length} client(s)</p>
          </div>

          {clientsRapport.length === 0 ? (
            <div className="p-5">
              <p className="text-sm text-slate-500">Aucun client trouvé.</p>
            </div>
          ) : (
            <div className="overflow-x-auto px-5 pb-5">
              <table className="w-full min-w-[720px] text-sm print:min-w-0">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2.5 pr-4">N° Client</th>
                    <th className="py-2.5 pr-4">Nom</th>
                    <th className="py-2.5 pr-4">Téléphone</th>
                    <th className="py-2.5 pr-4">Agence</th>
                    <th className="py-2.5 pr-4">Zone</th>
                    <th className="py-2.5 pr-4">Inscrit le</th>
                    <th className="py-2.5">Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {clientsRapport.map((c) => {
                    const agence = data.agences.find((a) => a.id === c.agenceId)
                    const zoneClient = data.zones.find((z) => z.id === c.zoneId)
                    return (
                      <tr key={c.id}>
                        <td className="py-2.5 pr-4 font-mono text-xs font-semibold text-brand-700">
                          {afficherNumeroClient(c.codeClient)}
                        </td>
                        <td className="py-2.5 pr-4 text-slate-800">
                          {c.prenom} {c.nom}
                        </td>
                        <td className="py-2.5 pr-4 text-slate-600">{c.telephone}</td>
                        <td className="py-2.5 pr-4 text-slate-600">{agence?.nom ?? '—'}</td>
                        <td className="py-2.5 pr-4 font-mono text-xs font-semibold text-slate-700">
                          {zoneClient
                            ? `${zoneClient.code}${zoneClient.nom ? ` — ${zoneClient.nom}` : ''}`
                            : '—'}
                        </td>
                        <td className="py-2.5 pr-4 text-slate-600">
                          {formatDate(c.dateInscription)}
                        </td>
                        <td className="py-2.5">
                          <span
                            className={`badge ${
                              c.actif ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {c.actif ? 'Actif' : 'Inactif'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {onglet === 'employes' && (
        <div className="card mb-6 !p-0 overflow-hidden print:overflow-visible">
          <div className="space-y-3 border-b border-slate-200 px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-slate-900">
                  Rapport employés ({employesRapport.length})
                </h3>
                <p className="text-sm text-slate-500">
                  Liste des employés — recherche, export et impression
                </p>
              </div>
              <div className="flex flex-wrap gap-2 print:hidden">
                <button
                  className="btn-secondary !py-2 text-xs"
                  onClick={exporterEmployes}
                  disabled={employesRapport.length === 0}
                >
                  <Download className="h-3.5 w-3.5" />
                  Excel
                </button>
                <button
                  className="btn-secondary !py-2 text-xs"
                  onClick={() => imprimer('employes')}
                  disabled={employesRapport.length === 0}
                >
                  <Printer className="h-3.5 w-3.5" />
                  Imprimer
                </button>
              </div>
            </div>
            <div className="print:hidden">
              <label className="label !mb-1">Rechercher</label>
              <input
                className="input max-w-md"
                placeholder="Nom, identifiant, rôle…"
                value={rechercheEmploye}
                onChange={(e) => setRechercheEmploye(e.target.value)}
              />
            </div>
          </div>

          <div className="hidden border-b border-slate-200 px-5 py-4 print:block">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {NOM_APPLICATION} — Rapport employés
            </div>
            <p className="text-sm text-slate-600">{employesRapport.length} employé(s)</p>
          </div>

          {employesRapport.length === 0 ? (
            <div className="p-5">
              <p className="text-sm text-slate-500">Aucun employé trouvé.</p>
            </div>
          ) : (
            <div className="overflow-x-auto px-5 pb-5">
              <table className="w-full min-w-[720px] text-sm print:min-w-0">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2.5 pr-4">Nom</th>
                    <th className="py-2.5 pr-4">Identifiant</th>
                    <th className="py-2.5 pr-4">Rôle</th>
                    <th className="py-2.5 pr-4">Agence</th>
                    <th className="py-2.5 pr-4">Téléphone</th>
                    <th className="py-2.5">Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {employesRapport.map((e) => {
                    const agence = data.agences.find((a) => a.id === e.agenceId)
                    return (
                      <tr key={e.id}>
                        <td className="py-2.5 pr-4 font-medium text-slate-800">{e.nomComplet}</td>
                        <td className="py-2.5 pr-4 font-mono text-xs text-slate-600">
                          {e.identifiant}
                        </td>
                        <td className="py-2.5 pr-4 text-slate-700">{LIBELLES_ROLE[e.role]}</td>
                        <td className="py-2.5 pr-4 text-slate-600">
                          {agence ? `${agence.code} — ${agence.nom}` : '—'}
                        </td>
                        <td className="py-2.5 pr-4 text-slate-600">{e.telephone || '—'}</td>
                        <td className="py-2.5">
                          <span
                            className={`badge ${
                              e.actif ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {e.actif ? 'Actif' : 'Inactif'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {MODULE_CREDITS_ACTIF && onglet === 'caisses' && (
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
    </div>
  )
}
