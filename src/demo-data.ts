import type { AppData, Client, StatutCredit } from './types'
import { pad4, uid } from './utils'

function ilYa(jours: number, heure = 10): string {
  const d = new Date()
  d.setDate(d.getDate() - jours)
  d.setHours(heure, (jours * 17) % 60, 0, 0)
  return d.toISOString()
}

export function genererDonneesDemo(): AppData {
  const infos: [string, string, 'M' | 'F', string, string][] = [
    ['Diallo', 'Aminata', 'F', 'Commerçante', 'Abidjan, Yopougon'],
    ['Traoré', 'Moussa', 'M', 'Chauffeur', 'Abidjan, Adjamé'],
    ['Koné', 'Fatoumata', 'F', 'Couturière', 'Abidjan, Cocody'],
    ['Ouattara', 'Ibrahim', 'M', 'Agriculteur', 'Bouaké centre'],
    ['Camara', 'Mariam', 'F', 'Restauratrice', 'Abidjan, Yopougon'],
    ['Bamba', 'Sékou', 'M', 'Menuisier', 'Abidjan, Abobo'],
    ['Touré', 'Awa', 'F', 'Coiffeuse', 'Abidjan, Adjamé'],
    ['Coulibaly', 'Adama', 'M', 'Électricien', 'Abidjan, Cocody'],
    ['Sanogo', 'Kadiatou', 'F', 'Vendeuse', 'Abidjan, Treichville'],
    ['Keïta', 'Oumar', 'M', 'Mécanicien', 'Abidjan, Abobo'],
    ['Doumbia', 'Rokia', 'F', 'Enseignante', 'Abidjan, Plateau'],
    ['Cissé', 'Lassina', 'M', 'Maçon', 'Bouaké centre'],
  ]

  const clients: Client[] = infos.map(([nom, prenom, sexe, profession, adresse], i) => ({
    id: uid(),
    codeClient: `CL-${pad4(i + 1)}`,
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
  }))

  const data: AppData = {
    utilisateurs: [
      { id: uid(), nomComplet: 'Administrateur', identifiant: 'admin', motDePasse: 'admin123', role: 'admin', actif: true },
      { id: uid(), nomComplet: 'Konan Yao', identifiant: 'chef', motDePasse: 'chef123', role: 'chef_agence', actif: true },
      { id: uid(), nomComplet: 'Affoué N’Guessan', identifiant: 'caisse', motDePasse: 'caisse123', role: 'caissier', actif: true },
    ],
    clients,
    carnets: [],
    mises: [],
    comptes: [],
    mouvements: [],
    credits: [],
    remboursements: [],
    transactions: [],
    compteurs: { client: clients.length, compte: 0, credit: 0 },
  }

  const nomComplet = (c: Client) => `${c.prenom} ${c.nom}`
  const operateurs = ['Affoué N’Guessan', 'Konan Yao']
  const op = (i: number) => operateurs[i % 2]

  // ----- Carnets de tontine individuelle -----
  const parametresCarnets: [number, number, number][] = [
    // [indexClient, mise, nb de mises déjà payées dans le cycle en cours]
    [0, 1000, 24],
    [1, 500, 12],
    [2, 1000, 30],
    [4, 2000, 18],
    [6, 500, 6],
    [8, 1000, 15],
    [9, 1500, 3],
  ]
  parametresCarnets.forEach(([ic, mise, misesPayees], k) => {
    const client = clients[ic]
    const carnet = {
      id: uid(),
      clientId: client.id,
      mise,
      frequence: 'journaliere' as const,
      misesParCycle: 31,
      cycleActuel: k % 3 === 0 ? 2 : 1,
      dateOuverture: ilYa(120 - k * 10),
      actif: true,
    }
    data.carnets.push(carnet)

    // Cycle précédent complet (pour les carnets au cycle 2)
    if (carnet.cycleActuel === 2) {
      for (let j = 0; j < 31; j += 3) {
        const nombre = Math.min(3, 31 - j)
        const date = ilYa(115 - k * 10 - j)
        data.mises.push({ id: uid(), carnetId: carnet.id, cycle: 1, nombreMises: nombre, montant: mise * nombre, date })
        data.transactions.push({
          id: uid(),
          type: 'mise_tontine',
          clientId: client.id,
          montant: mise * nombre,
          date,
          description: `Mise tontine ×${nombre} — ${nomComplet(client)} (cycle 1)`,
          operateur: op(j),
        })
      }
      const dateCloture = ilYa(80 - k * 10)
      data.transactions.push({
        id: uid(),
        type: 'retrait_tontine',
        clientId: client.id,
        montant: mise * 30,
        date: dateCloture,
        description: `Clôture cycle 1 — remise de ${nomComplet(client)} (31 mises − 1 de commission)`,
        operateur: op(k),
      })
      data.transactions.push({
        id: uid(),
        type: 'commission_tontine',
        clientId: client.id,
        montant: mise,
        date: dateCloture,
        description: `Commission tontine cycle 1 — ${nomComplet(client)}`,
        operateur: op(k),
      })
    }

    // Cycle en cours
    for (let j = 0; j < misesPayees; j += 2) {
      const nombre = Math.min(2, misesPayees - j)
      const date = ilYa(Math.max(0, misesPayees - j), 9 + (j % 8))
      data.mises.push({ id: uid(), carnetId: carnet.id, cycle: carnet.cycleActuel, nombreMises: nombre, montant: mise * nombre, date })
      data.transactions.push({
        id: uid(),
        type: 'mise_tontine',
        clientId: client.id,
        montant: mise * nombre,
        date,
        description: `Mise tontine ×${nombre} — ${nomComplet(client)} (cycle ${carnet.cycleActuel})`,
        operateur: op(j),
      })
    }
  })

  // ----- Comptes d'épargne -----
  clients.slice(0, 9).forEach((client, i) => {
    data.compteurs.compte++
    const compte = {
      id: uid(),
      clientId: client.id,
      numero: `EP-${pad4(data.compteurs.compte)}`,
      solde: 0,
      dateOuverture: ilYa(380 - i * 22),
    }
    data.comptes.push(compte)
    const nbMouvements = 3 + (i % 4)
    for (let k = 0; k < nbMouvements; k++) {
      const estDepot = k % 3 !== 2
      const montant = estDepot ? 15000 + ((i * 7 + k * 13) % 8) * 5000 : 10000 + (k % 3) * 5000
      if (!estDepot && compte.solde < montant) continue
      compte.solde += estDepot ? montant : -montant
      const date = ilYa(300 - k * 40 - i * 3, 11 + (k % 6))
      data.mouvements.push({ id: uid(), compteId: compte.id, type: estDepot ? 'depot' : 'retrait', montant, date })
      data.transactions.push({
        id: uid(),
        type: estDepot ? 'depot_epargne' : 'retrait_epargne',
        clientId: client.id,
        montant,
        date,
        description: `${estDepot ? 'Dépôt' : 'Retrait'} épargne ${compte.numero} — ${nomComplet(client)}`,
        operateur: op(k),
      })
    }
  })

  // ----- Crédits -----
  const parametresCredits: [number, number, number, number, string, number][] = [
    // [indexClient, montant, taux %, durée mois, motif, jours depuis octroi]
    [0, 300000, 10, 6, 'Achat de marchandises', 150],
    [2, 150000, 8, 4, 'Machine à coudre', 100],
    [4, 500000, 12, 12, 'Extension du restaurant', 200],
    [6, 100000, 8, 3, 'Matériel de coiffure', 45],
    [9, 250000, 10, 6, 'Outillage garage', 20],
  ]
  parametresCredits.forEach(([ic, montant, taux, duree, motif, jours], idx) => {
    const client = clients[ic]
    const dateOctroi = ilYa(jours)
    const total = montant * (1 + taux / 100)
    const mensualite = Math.round(total / duree)
    const moisEcoules = Math.floor(jours / 30)
    // Le crédit n°2 (restaurant) est volontairement en retard : un seul paiement
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
    data.transactions.push({
      id: uid(),
      type: 'octroi_credit',
      clientId: client.id,
      montant,
      date: dateOctroi,
      description: `Octroi crédit ${credit.numero} — ${nomComplet(client)} (${motif})`,
      operateur: 'Konan Yao',
    })
    for (let k = 0; k < nbPaiements; k++) {
      const date = ilYa(jours - (k + 1) * 30, 14)
      data.remboursements.push({ id: uid(), creditId: credit.id, montant: mensualite, date })
      data.transactions.push({
        id: uid(),
        type: 'remboursement_credit',
        clientId: client.id,
        montant: mensualite,
        date,
        description: `Remboursement ${credit.numero} — ${nomComplet(client)} (échéance ${k + 1}/${duree})`,
        operateur: op(k),
      })
    }
  })

  // Demande de crédit en attente d'approbation
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

  data.transactions.sort((a, b) => b.date.localeCompare(a.date))
  return data
}
