import { MODULE_CREDITS_ACTIF } from './config'
import {
  deltaSoldeOperationCaisse,
  estOperationCaisse,
  soldeCompteCaisseAvantJour,
  soldeCompteCaisseFinJour,
} from './metier'
import {
  CARREAUX_PAR_CYCLE,
  PRIX_CARNET,
  type Agence,
  type AppData,
  type Client,
  type CompteCaisse,
  type CompteZoneTontine,
  type Employe,
  type MouvementCompteCaisse,
  type OuvertureCaisse,
  type StatutCredit,
  type Transaction,
  type TypeCarnet,
  type TypeCompte,
  type TypeTransaction,
  type Zone,
} from './types'
import { numeroCarnet, numeroCompteCaisse, numeroCompteSolde, pad4, uid } from './utils'

function ilYa(jours: number, heure = 10): string {
  const d = new Date()
  d.setDate(d.getDate() - jours)
  d.setHours(heure, (jours * 17) % 60, 0, 0)
  return d.toISOString()
}

/** Date calendaire locale YYYY-MM-DD (alignée sur aujourdHuiIso métier). */
function aujourdHuiLocalDemo(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function genererDonneesDemo(): AppData {
  const agencePlateau: Agence = {
    id: uid(),
    code: 'A1',
    nom: 'Agence Plateau',
    adresse: 'Abidjan, Plateau',
    telephone: '+225 27 20 30 40 50',
    actif: true,
  }
  const agenceYopougon: Agence = {
    id: uid(),
    code: 'A2',
    nom: 'Agence Yopougon',
    adresse: 'Abidjan, Yopougon',
    telephone: '+225 27 20 30 40 51',
    actif: true,
  }

  const zonePlateauNord: Zone = {
    id: uid(),
    agenceId: agencePlateau.id,
    code: '01',
    nom: 'Plateau Nord',
    actif: true,
  }
  const zonePlateauSud: Zone = {
    id: uid(),
    agenceId: agencePlateau.id,
    code: '02',
    nom: 'Plateau Sud',
    actif: true,
  }
  const zoneYopCentre: Zone = {
    id: uid(),
    agenceId: agenceYopougon.id,
    code: '03',
    nom: 'Yopougon Centre',
    actif: true,
  }
  const zoneYopSideci: Zone = {
    id: uid(),
    agenceId: agenceYopougon.id,
    code: '04',
    nom: 'Yopougon Sideci',
    actif: true,
  }
  const zones = [zonePlateauNord, zonePlateauSud, zoneYopCentre, zoneYopSideci]
  const comptesZoneTontine: CompteZoneTontine[] = zones.map((z) => ({
    id: uid(),
    zoneId: z.id,
    cumulManquant: 0,
    cumulSurplus: 0,
    actif: true,
  }))

  const adminId = uid()
  const chefId = uid()
  const affoueId = uid()
  const briceId = uid()

  const employes: Employe[] = [
    {
      id: adminId,
      nomComplet: 'Kouadio Assale',
      identifiant: 'admin',
      motDePasse: 'admin123',
      role: 'admin',
      agenceId: agencePlateau.id,
      droits: [],
      telephone: '+225 07 09 11 22 33',
      email: 'direction@dondedieu.ci',
      adresse: 'Abidjan, Plateau',
      pieceIdentite: 'CNI C100000001',
      dateEmbauche: ilYa(900),
      actif: true,
    },
    {
      id: chefId,
      nomComplet: 'Konan Yao',
      identifiant: 'chef',
      motDePasse: 'chef123',
      role: 'chef_agence',
      agenceId: agencePlateau.id,
      droits: ['gerer_clients', 'operer_comptes', 'approuver_credits', 'verrouiller_comptes', 'voir_rapports'],
      telephone: '+225 07 08 44 55 66',
      email: 'k.yao@dondedieu.ci',
      adresse: 'Abidjan, Cocody',
      pieceIdentite: 'CNI C100000002',
      dateEmbauche: ilYa(700),
      actif: true,
    },
    {
      id: affoueId,
      nomComplet: 'Affoué N’Guessan',
      identifiant: 'caisse',
      motDePasse: 'caisse123',
      role: 'caissier',
      agenceId: agencePlateau.id,
      droits: ['gerer_clients', 'operer_comptes'],
      telephone: '+225 05 06 77 88 99',
      email: 'a.nguessan@dondedieu.ci',
      adresse: 'Abidjan, Yopougon',
      pieceIdentite: 'CNI C100000003',
      dateEmbauche: ilYa(420),
      actif: true,
    },
    {
      id: briceId,
      nomComplet: 'Brice Kouamé',
      identifiant: 'caisse2',
      motDePasse: 'caisse123',
      role: 'caissier',
      agenceId: agenceYopougon.id,
      droits: ['gerer_clients', 'operer_comptes'],
      telephone: '+225 01 02 33 44 55',
      adresse: 'Abidjan, Abobo',
      pieceIdentite: 'CNI C100000004',
      dateEmbauche: ilYa(180),
      actif: true,
    },
  ]

  agencePlateau.chefEmployeId = chefId
  const [, chef, affoue, brice] = employes
  const caissiers = [affoue, brice]
  const op = (i: number) => caissiers[i % 2]

  const infos: [string, string, 'M' | 'F', string, string, string][] = [
    ['Diallo', 'Aminata', 'F', 'Commerçante', 'Abidjan, Yopougon', zonePlateauNord.id],
    ['Traoré', 'Moussa', 'M', 'Chauffeur', 'Abidjan, Adjamé', zonePlateauNord.id],
    ['Koné', 'Fatoumata', 'F', 'Couturière', 'Abidjan, Cocody', zonePlateauSud.id],
    ['Ouattara', 'Ibrahim', 'M', 'Agriculteur', 'Bouaké centre', zoneYopCentre.id],
    ['Camara', 'Mariam', 'F', 'Restauratrice', 'Abidjan, Yopougon', zoneYopCentre.id],
    ['Bamba', 'Sékou', 'M', 'Menuisier', 'Abidjan, Abobo', zonePlateauSud.id],
    ['Touré', 'Awa', 'F', 'Coiffeuse', 'Abidjan, Adjamé', zoneYopSideci.id],
    ['Coulibaly', 'Adama', 'M', 'Électricien', 'Abidjan, Cocody', zonePlateauNord.id],
    ['Sanogo', 'Kadiatou', 'F', 'Vendeuse', 'Abidjan, Treichville', zoneYopSideci.id],
    ['Keïta', 'Oumar', 'M', 'Mécanicien', 'Abidjan, Abobo', zonePlateauSud.id],
    ['Doumbia', 'Rokia', 'F', 'Enseignante', 'Abidjan, Plateau', zonePlateauNord.id],
    ['Cissé', 'Lassina', 'M', 'Maçon', 'Bouaké centre', zoneYopCentre.id],
  ]

  const compteursOrdreZone: Record<string, number> = {
    [zonePlateauNord.id]: 0,
    [zonePlateauSud.id]: 0,
    [zoneYopCentre.id]: 0,
    [zoneYopSideci.id]: 0,
  }

  const zoneParId = (zoneId: string) => zones.find((z) => z.id === zoneId)!

  const clients: Client[] = infos.map(([nom, prenom, sexe, profession, adresse, zoneId], i) => {
    compteursOrdreZone[zoneId]++
    const ordre = compteursOrdreZone[zoneId]
    const zone = zoneParId(zoneId)
    return {
      id: uid(),
      codeClient: numeroCarnet(zone.code, ordre),
      agenceId: zone.agenceId,
      zoneId,
      ordreZone: ordre,
      nom,
      prenom,
      sexe,
      profession,
      adresse,
      telephone: `+225 07 ${String(10 + i)} ${String(20 + i * 3).padStart(2, '0')} ${String(40 + i * 2).padStart(2, '0')} ${String(11 + i * 7).slice(-2)}`,
      email: i % 3 === 0 ? `${prenom.toLowerCase()}.${nom.toLowerCase().replace('ï', 'i').replace('é', 'e')}@gmail.com` : undefined,
      pieceIdentite: `CNI C${String(100200300 + i * 12345)}`,
      dateInscription: ilYa(400 - i * 28),
      actif: i !== 11,
    }
  })

  const data: AppData = {
    agences: [agencePlateau, agenceYopougon],
    zones,
    comptesZoneTontine,
    journeesCompteZone: [],
    ajustementsCompteZone: [],
    employes,
    clients,
    carnets: [],
    mises: [],
    comptes: [],
    mouvements: [],
    credits: [],
    remboursements: [],
    transactions: [],
    comptesCaisse: [],
    mouvementsCompteCaisse: [],
    ajustementsCompteCaisse: [],
    ouverturesCaisse: [],
    arretsCaisse: [],
    journalConnexions: [
      {
        id: uid(),
        employeId: affoue.id,
        employeNom: affoue.nomComplet,
        agenceId: affoue.agenceId,
        date: ilYa(0, 8),
        type: 'connexion',
      },
      {
        id: uid(),
        employeId: chef.id,
        employeNom: chef.nomComplet,
        agenceId: chef.agenceId,
        date: ilYa(1, 8),
        type: 'connexion',
      },
      {
        id: uid(),
        employeId: chef.id,
        employeNom: chef.nomComplet,
        agenceId: chef.agenceId,
        date: ilYa(1, 17),
        type: 'deconnexion',
      },
    ],
    compteursOrdreZone,
    compteurs: { client: clients.length, compte: 0, credit: 0, compteCaisse: 0, clientBanque: 0 },
  }

  const nomComplet = (c: Client) => `${c.prenom} ${c.nom}`

  const tx = (
    type: TypeTransaction,
    client: Client,
    montant: number,
    date: string,
    description: string,
    operateur: Employe,
  ): Transaction => ({
    id: uid(),
    type,
    clientId: client.id,
    montant,
    date,
    description,
    operateur: operateur.nomComplet,
    operateurId: operateur.id,
    agenceId: operateur.agenceId,
  })

  // Carnets : [indexClient, type, mise, mises payées, jours, cycle, verrouillé]
  const parametresCarnets: [number, TypeCarnet, number, number, number, number, boolean][] = [
    [0, 'tontine', 1000, 24, 240, 2, false],
    [1, 'tontine', 500, 12, 40, 1, false],
    [2, 'carte_tous', 1000, 18, 35, 2, false],
    [4, 'tontine', 2000, 18, 60, 1, false],
    [5, 'carte_enfants', 500, 26, 250, 2, false],
    [6, 'carte_enfants', 500, 25, 60, 1, false],
    [8, 'carte_bloquee', 1000, 15, 215, 2, false],
    [9, 'carte_bloquee', 1500, 10, 90, 1, false],
    [10, 'tontine', 1000, 8, 30, 1, true],
  ]

  parametresCarnets.forEach(([ic, typeCarnet, mise, misesPayees, joursOuverture, cycleActuel, verrouille], k) => {
    const client = clients[ic]
    const zone = zoneParId(client.zoneId)
    const numero = numeroCarnet(zone.code, client.ordreZone)
    const carnet = {
      id: uid(),
      clientId: client.id,
      numero,
      zoneId: zone.id,
      agenceId: zone.agenceId,
      typeCarnet,
      mise,
      frequence: 'journaliere' as const,
      misesParCycle: CARREAUX_PAR_CYCLE,
      cycleActuel,
      dateOuverture: ilYa(joursOuverture),
      verrouille,
      retraitActiveParAdmin: !['carte_enfants', 'carte_bloquee'].includes(typeCarnet),
      actif: true,
    }
    data.carnets.push(carnet)

    data.transactions.push(
      tx('vente_carnet', client, PRIX_CARNET, carnet.dateOuverture, `Vente du carnet ${numero} — ${nomComplet(client)} (cycle 1/12)`, op(k)),
    )

    if (cycleActuel === 2) {
      // Cycle 1 passé : 31 carreaux (argent restant jusqu'au retrait)
      for (let j = 0; j < 31; j += 3) {
        const nombre = Math.min(3, 31 - j)
        const date = ilYa(joursOuverture - 2 - j)
        data.mises.push({ id: uid(), carnetId: carnet.id, cycle: 1, nombreMises: nombre, montant: mise * nombre, date })
        if (j === 0) {
          data.transactions.push(tx('commission_tontine', client, mise, date, `Première cotisation (P.C) — ${nomComplet(client)} (cycle 1)`, op(k)))
          if (nombre > 1) {
            data.transactions.push(tx('mise_tontine', client, mise * (nombre - 1), date, `Dépôt ×${nombre - 1} — ${nomComplet(client)} (cycle 1)`, op(k)))
          }
        } else {
          data.transactions.push(tx('mise_tontine', client, mise * nombre, date, `Dépôt ×${nombre} — ${nomComplet(client)} (cycle 1)`, op(j)))
        }
      }
      // Exemple : un cycle partiellement retiré, un autre soldé (grisé) selon le carnet
      if (k === 0) {
        // retrait partiel 10 carreaux sur cycle 1
        data.mises.push({
          id: uid(),
          carnetId: carnet.id,
          cycle: 1,
          nombreMises: -10,
          montant: -mise * 10,
          date: ilYa(joursOuverture - 45),
        })
        data.transactions.push(
          tx('retrait_tontine', client, mise * 10, ilYa(joursOuverture - 45), `Retrait partiel ×10 — cycle 1 — ${nomComplet(client)}`, chef),
        )
      }
      if (k === 4) {
        // retrait total hors P.C (30) → cycle grisé
        data.mises.push({
          id: uid(),
          carnetId: carnet.id,
          cycle: 1,
          nombreMises: -30,
          montant: -mise * 30,
          date: ilYa(joursOuverture - 42),
        })
        data.transactions.push(
          tx('retrait_tontine', client, mise * 30, ilYa(joursOuverture - 42), `Retrait total ×30 — cycle 1 — ${nomComplet(client)}`, chef),
        )
      }
    }

    for (let j = 0; j < misesPayees; j += 2) {
      const nombre = Math.min(2, misesPayees - j)
      const date = ilYa(Math.max(0, misesPayees - j), 9 + (j % 8))
      data.mises.push({ id: uid(), carnetId: carnet.id, cycle: cycleActuel, nombreMises: nombre, montant: mise * nombre, date })
      if (j === 0) {
        data.transactions.push(tx('commission_tontine', client, mise, date, `Première cotisation (P.C) — ${nomComplet(client)} (cycle ${cycleActuel})`, op(k)))
        if (nombre > 1) {
          data.transactions.push(tx('mise_tontine', client, mise * (nombre - 1), date, `Dépôt ×${nombre - 1} — ${nomComplet(client)} (cycle ${cycleActuel})`, op(k)))
        }
      } else {
        data.transactions.push(tx('mise_tontine', client, mise * nombre, date, `Dépôt ×${nombre} — ${nomComplet(client)} (cycle ${cycleActuel})`, op(j / 2 + k)))
      }
    }
  })

  const parametresComptes: [number, TypeCompte, number, boolean][] = [
    [0, 'courant', 380, false],
    [1, 'courant', 350, false],
    [3, 'courant', 300, false],
    [5, 'courant', 200, false],
    [7, 'courant', 90, true],
    [0, 'epargne', 360, false],
    [2, 'epargne', 320, false],
    [4, 'epargne', 280, false],
    [6, 'epargne', 150, false],
    [8, 'epargne', 100, false],
  ]

  const comptesParCle = new Map<string, (typeof data.comptes)[number]>()
  parametresComptes.forEach(([ic, type, jours, verrouille], i) => {
    const client = clients[ic]
    data.compteurs.compte++
    const compte = {
      id: uid(),
      clientId: client.id,
      type,
      numero: numeroCompteSolde(data.compteurs.compte),
      solde: 0,
      dateOuverture: ilYa(jours),
      verrouille,
    }
    data.comptes.push(compte)
    comptesParCle.set(`${ic}-${type}`, compte)

    if (!client.codeClientBanque) {
      data.compteurs.clientBanque = (data.compteurs.clientBanque ?? 0) + 1
      client.ordreBanque = data.compteurs.clientBanque
      client.codeClientBanque = pad4(data.compteurs.clientBanque)
    }

    const nbMouvements = 3 + (i % 4)
    for (let k = 0; k < nbMouvements; k++) {
      const estDepot = type === 'epargne' || k % 3 !== 2
      const montant = estDepot ? 15000 + ((i * 7 + k * 13) % 8) * 5000 : 10000 + (k % 3) * 5000
      if (!estDepot && compte.solde < montant) continue
      compte.solde += estDepot ? montant : -montant
      const date = ilYa(Math.max(1, jours - 30 - k * 40), 11 + (k % 6))
      data.mouvements.push({ id: uid(), compteId: compte.id, type: estDepot ? 'depot' : 'retrait', montant, date })
      data.transactions.push(
        tx(
          estDepot ? 'depot_compte' : 'retrait_compte',
          client,
          montant,
          date,
          `${estDepot ? 'Dépôt' : 'Retrait'} ${compte.numero} — ${nomComplet(client)}`,
          op(k),
        ),
      )
    }
  })

  const compteJour = comptesParCle.get('0-courant')!
  const depotJour = 25000
  compteJour.solde += depotJour
  const dateDepotJour = ilYa(0, 9)
  data.mouvements.push({ id: uid(), compteId: compteJour.id, type: 'depot', montant: depotJour, date: dateDepotJour })
  data.transactions.push(tx('depot_compte', clients[0], depotJour, dateDepotJour, `Dépôt ${compteJour.numero} — ${nomComplet(clients[0])}`, affoue))

  const epAminata = comptesParCle.get('0-epargne')!
  const montantExecute = 20000
  epAminata.solde -= montantExecute
  data.mouvements.push({ id: uid(), compteId: epAminata.id, type: 'retrait', montant: montantExecute, date: ilYa(7, 14) })
  data.transactions.push(tx('retrait_compte', clients[0], montantExecute, ilYa(7, 14), `Retrait ${epAminata.numero} — ${nomComplet(clients[0])}`, affoue))

  const parametresCredits: [number, number, number, number, string, number][] = MODULE_CREDITS_ACTIF
    ? [
        [0, 300000, 10, 6, 'Achat de marchandises', 150],
        [2, 150000, 8, 4, 'Machine à coudre', 100],
        [4, 500000, 12, 12, 'Extension du restaurant', 200],
        [6, 100000, 8, 3, 'Matériel de coiffure', 45],
        [9, 250000, 10, 6, 'Outillage garage', 20],
      ]
    : []

  parametresCredits.forEach(([ic, montant, taux, duree, motif, jours], idx) => {
    const client = clients[ic]
    const dateOctroi = ilYa(jours)
    const total = montant * (1 + taux / 100)
    const mensualite = Math.round(total / duree)
    const moisEcoules = Math.floor(jours / 30)
    const nbPaiements = idx === 2 ? 1 : Math.min(moisEcoules, duree)
    const rembourse = nbPaiements >= duree
    const enRetard = !rembourse && nbPaiements < moisEcoules

    data.compteurs.credit++
    const credit = {
      id: uid(),
      numero: `CR-${pad4(data.compteurs.credit)}`,
      clientId: client.id,
      montant,
      tauxInteret: taux,
      dureeMois: duree,
      motif,
      dateDemande: ilYa(jours + 5),
      dateOctroi,
      statut: (rembourse ? 'rembourse' : enRetard ? 'en_retard' : 'en_cours') as StatutCredit,
    }
    data.credits.push(credit)
    data.transactions.push(tx('octroi_credit', client, montant, dateOctroi, `Octroi crédit ${credit.numero} — ${nomComplet(client)} (${motif})`, chef))
    for (let k = 0; k < nbPaiements; k++) {
      const date = ilYa(jours - (k + 1) * 30, 14)
      data.remboursements.push({ id: uid(), creditId: credit.id, montant: mensualite, date })
      data.transactions.push(tx('remboursement_credit', client, mensualite, date, `Remboursement ${credit.numero} — ${nomComplet(client)}`, op(k)))
    }
  })

  if (MODULE_CREDITS_ACTIF) {
    data.compteurs.credit++
    data.credits.push({
      id: uid(),
      numero: `CR-${pad4(data.compteurs.credit)}`,
      clientId: clients[7].id,
      montant: 200000,
      tauxInteret: 10,
      dureeMois: 6,
      motif: 'Achat de câbles et disjoncteurs',
      dateDemande: ilYa(2),
      statut: 'en_attente',
    })
  }

  const arretsParametres: [Employe, number, number, number, number, number, string?][] = [
    [affoue, 8, 14, 86500, 30000, 56500],
    [brice, 8, 11, 64000, 45000, 18500, 'Billet de 500 abîmé remplacé'],
    // Pas d'arrêt hier pour Affoué (scénario « en retard ») — arrêt antérieur à J-2
    [affoue, 2, 17, 103000, 20000, 82500, 'Écart de 500 FCFA à vérifier'],
    [brice, 2, 12, 71500, 25000, 46500],
  ]
  arretsParametres.forEach(([employe, jours, nb, entrees, sorties, compte, note]) => {
    const dateCloture = ilYa(jours, 17)
    data.arretsCaisse.push({
      id: uid(),
      employeId: employe.id,
      employeNom: employe.nomComplet,
      agenceId: employe.agenceId,
      journee: dateCloture.slice(0, 10),
      dateCloture,
      date: dateCloture,
      debutPeriode: ilYa(jours, 8),
      nombreOperations: nb,
      totalEntrees: entrees,
      totalSorties: sorties,
      soldeOuverture: 0,
      soldeTheorique: entrees - sorties,
      montantCompte: compte,
      ecart: compte - (entrees - sorties),
      note,
      valideParId: chef.id,
      valideParNom: chef.nomComplet,
    })
  })

  // ----- Scénarios de test suivi caisse -----
  // Affoué (login caisse) : journée d’aujourd’hui ouverte → peut opérer
  // Brice : ouverture HIER non clôturée → « En retard »
  const dateHierMatin = ilYa(1, 10)
  const dateHierAprem = ilYa(1, 15)
  const jourHier = dateHierMatin.slice(0, 10)
  data.transactions.push(
    tx(
      'mise_tontine',
      clients[0],
      5000,
      dateHierMatin,
      `Dépôt ×5 — ${nomComplet(clients[0])} (test caisse en retard)`,
      brice,
    ),
    tx(
      'commission_tontine',
      clients[1],
      500,
      dateHierAprem,
      `Première cotisation (P.C) — ${nomComplet(clients[1])} (test caisse en retard)`,
      brice,
    ),
    tx(
      'depot_compte',
      clients[4],
      15000,
      ilYa(0, 10),
      `Dépôt test jour — ${nomComplet(clients[4])} (caisse à arrêter)`,
      affoue,
    ),
    tx(
      'mise_tontine',
      clients[4],
      4000,
      ilYa(0, 11),
      `Dépôt ×4 — ${nomComplet(clients[4])} (caisse à arrêter)`,
      affoue,
    ),
  )

  // Clôturer les journées passées encore ouvertes, SAUF les jours volontairement ouverts pour les tests
  const auj = aujourdHuiLocalDemo()
  const joursOuvertsPourTest = new Set<string>([`${brice.id}:${jourHier}`])
  const typesSortie = new Set(['retrait_tontine', 'retrait_compte', 'octroi_credit'])
  for (const employe of data.employes) {
    const joursOps = new Set(
      data.transactions
        .filter((t) => t.operateurId === employe.id && t.date.slice(0, 10) < auj)
        .map((t) => t.date.slice(0, 10)),
    )
    const joursArretes = new Set(
      data.arretsCaisse
        .filter((a) => a.employeId === employe.id)
        .map((a) => a.journee ?? a.dateCloture?.slice(0, 10) ?? a.date?.slice(0, 10)),
      )
    for (const jour of [...joursOps].filter((j) => !joursArretes.has(j)).sort()) {
      if (joursOuvertsPourTest.has(`${employe.id}:${jour}`)) continue
      const ops = data.transactions.filter(
        (t) => t.operateurId === employe.id && t.date.slice(0, 10) === jour,
      )
      let entrees = 0
      let sorties = 0
      ops.forEach((t) => {
        if (typesSortie.has(t.type)) sorties += t.montant
        else entrees += t.montant
      })
      const solde = entrees - sorties
      const dateCloture = `${jour}T17:30:00.000Z`
      data.arretsCaisse.push({
        id: uid(),
        employeId: employe.id,
        employeNom: employe.nomComplet,
        agenceId: employe.agenceId,
        journee: jour,
        dateCloture,
        date: dateCloture,
        debutPeriode: ops.map((t) => t.date).sort()[0] ?? `${jour}T08:00:00.000Z`,
        nombreOperations: ops.length,
        totalEntrees: entrees,
        totalSorties: sorties,
        soldeOuverture: 0,
        soldeTheorique: solde,
        montantCompte: solde,
        ecart: 0,
        valideParId: chef.id,
        valideParNom: chef.nomComplet,
      })
    }
  }

  data.transactions.sort((a, b) => b.date.localeCompare(a.date))
  data.arretsCaisse.sort((a, b) =>
    (b.dateCloture ?? b.date ?? '').localeCompare(a.dateCloture ?? a.date ?? ''),
  )

  // Comptes caisse : float initial + application chronologique des opérations
  const floatInitial = 200_000
  const ouvrirCompteCaisseDemo = (employe: Employe): CompteCaisse => {
    data.compteurs.compteCaisse++
    const compte: CompteCaisse = {
      id: uid(),
      employeId: employe.id,
      agenceId: employe.agenceId,
      numero: numeroCompteCaisse(data.compteurs.compteCaisse),
      solde: 0,
      cumulManquant: 0,
      cumulSurplus: 0,
      dateOuverture: ilYa(60, 8),
      actif: true,
    }
    data.comptesCaisse.push(compte)
    return compte
  }

  for (const employe of [affoue, brice]) {
    const compte = ouvrirCompteCaisseDemo(employe)
    compte.solde = floatInitial
    const mvt: MouvementCompteCaisse = {
      id: uid(),
      compteCaisseId: compte.id,
      employeId: employe.id,
      type: 'alimentation',
      montant: floatInitial,
      sens: 'credit',
      soldeApres: floatInitial,
      date: ilYa(45, 7),
      description: `Alimentation initiale — ${compte.numero}`,
      operateurId: chef.id,
      operateurNom: chef.nomComplet,
    }
    data.mouvementsCompteCaisse.push(mvt)
  }

  const chronos = [...data.transactions].sort((a, b) => a.date.localeCompare(b.date))
  for (const t of chronos) {
    if (!estOperationCaisse(t.type) || !t.operateurId) continue
    const emp = data.employes.find((e) => e.id === t.operateurId)
    if (!emp) continue
    let compte = data.comptesCaisse.find((c) => c.agenceId === emp.agenceId && c.actif)
    if (!compte) {
      if (emp.role !== 'caissier') continue
      compte = ouvrirCompteCaisseDemo(emp)
    }
    const delta = deltaSoldeOperationCaisse(t.type, t.montant)
    if (delta === 0) continue
    compte.solde += delta
    data.mouvementsCompteCaisse.push({
      id: uid(),
      compteCaisseId: compte.id,
      employeId: t.operateurId,
      type: delta > 0 ? 'entree_operation' : 'sortie_operation',
      montant: Math.abs(delta),
      sens: delta > 0 ? 'credit' : 'debit',
      soldeApres: compte.solde,
      date: t.date,
      description: t.description,
      transactionId: t.id,
      operateurId: t.operateurId,
      operateurNom: t.operateur,
    })
  }

  // Recalcule ouverture / fermeture théorique à partir du compte caisse
  for (const a of data.arretsCaisse) {
    const compte = data.comptesCaisse.find((c) => c.employeId === a.employeId && c.actif)
    const journee = a.journee ?? (a.dateCloture ?? a.date ?? '').slice(0, 10)
    a.soldeOuverture = soldeCompteCaisseAvantJour(compte, data.mouvementsCompteCaisse, journee)
    a.soldeTheorique = soldeCompteCaisseFinJour(compte, data.mouvementsCompteCaisse, journee)
    if (a.note?.includes('Écart')) {
      a.montantCompte = a.soldeTheorique - 500
      a.ecart = -500
    } else {
      a.montantCompte = a.soldeTheorique
      a.ecart = 0
    }
  }

  // Cumuls manquant / surplus (toutes dates) à partir des écarts d'arrêt
  for (const a of data.arretsCaisse) {
    const compte = data.comptesCaisse.find((c) => c.employeId === a.employeId && c.actif)
    if (!compte || !a.ecart) continue
    if (a.ecart < 0) compte.cumulManquant += Math.abs(a.ecart)
    if (a.ecart > 0) compte.cumulSurplus += a.ecart
  }

  // Ouvertures de journée (admin/chef) — une par arrêt + scénarios ouverts
  const ajouterOuverture = (
    employe: Employe,
    journee: string,
    soldeOuverture: number,
    heure = 7,
  ) => {
    if (data.ouverturesCaisse.some((o) => o.employeId === employe.id && o.journee === journee)) {
      return
    }
    const o: OuvertureCaisse = {
      id: uid(),
      employeId: employe.id,
      employeNom: employe.nomComplet,
      agenceId: employe.agenceId,
      journee,
      soldeOuverture,
      dateOuverture: `${journee}T${String(heure).padStart(2, '0')}:45:00.000Z`,
      ouvertParId: chef.id,
      ouvertParNom: chef.nomComplet,
    }
    data.ouverturesCaisse.push(o)
  }

  for (const a of data.arretsCaisse) {
    const emp = data.employes.find((e) => e.id === a.employeId)
    if (!emp) continue
    ajouterOuverture(emp, a.journee, a.soldeOuverture)
  }

  // Affoué : aujourd'hui ouverte (peut opérer). Brice : hier ouverte non clôturée (retard).
  const compteAffoue = data.comptesCaisse.find((c) => c.employeId === affoue.id)
  const compteBrice = data.comptesCaisse.find((c) => c.employeId === brice.id)
  const compteChef = data.comptesCaisse.find((c) => c.employeId === chef.id)
  ajouterOuverture(
    affoue,
    auj,
    soldeCompteCaisseAvantJour(compteAffoue, data.mouvementsCompteCaisse, auj),
  )
  ajouterOuverture(
    brice,
    jourHier,
    soldeCompteCaisseAvantJour(compteBrice, data.mouvementsCompteCaisse, jourHier),
  )
  ajouterOuverture(
    chef,
    auj,
    soldeCompteCaisseAvantJour(compteChef, data.mouvementsCompteCaisse, auj),
  )

  data.ouverturesCaisse.sort((a, b) => b.dateOuverture.localeCompare(a.dateOuverture))
  data.mouvementsCompteCaisse.sort((a, b) => b.date.localeCompare(a.date))

  return data
}
