import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRightLeft,
  ArrowUpFromLine,
  BookPlus,
  CircleStop,
  Lock,
  LockOpen,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { NOM_APPLICATION } from '../config'
import { useStore } from '../store'
import { CYCLES_PAR_CARNET, PRIX_CARNET, type JourneeCompteZone } from '../types'
import {
  aujourdHuiIso,
  CARNETS_RETRAIT_6_MOIS,
  abonnementASaisir,
  abonnementAnnee1Paye,
  anneeCarnet,
  anneeCarnetOuverte,
  cycleCourantEffectif,
  besoinRenouvellementCarnet,
  cycleDansAnnee,
  estPremierCycleRenouvellement,
  LIBELLES_CARNET,
  libelleCycleCarnet,
  miseDuCycle,
  misesPossiblesReduction,
  pcASaisir,
  pcPayeeSurCycle,
  preparerDepotTontine,
  carreauxDeposes,
  eligibiliteRetraitCarnet,
  journeeZoneDuJour,
  joursCollecteSaisissables,
  moisDuCycle,
  montantComplementMise,
  repartirDepotSurCycles,
  situationsCycles,
  type EtatCycle,
} from '../metier'
import { formatDate, formatMontant, afficherNumeroClient } from '../utils'
import { Avatar, EnTetePage, Modale } from '../components/ui'
import { useConfirmation } from '../components/Confirmation'
import { ModaleTransfert } from '../components/ModaleTransfert'

function libelleJourCollecte(jour: string, aujourdhui: string): string {
  const date = formatDate(`${jour}T12:00:00`)
  if (jour === aujourdhui) return `${date} (aujourd’hui)`
  return `${date} (rattrapage)`
}

function SelectJourCollecte({
  jours,
  value,
  onChange,
  journees,
  zoneId,
  caisseOuverte,
  caisseCloturee,
}: {
  jours: string[]
  value: string
  onChange: (v: string) => void
  journees: JourneeCompteZone[]
  zoneId: string
  caisseOuverte: (jour: string) => boolean
  caisseCloturee: (jour: string) => boolean
}) {
  const auj = aujourdHuiIso()
  if (jours.length === 0) return null
  return (
    <div>
      <label className="label">Collecte du *</label>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="" disabled>
          — Choisir la journée de collecte —
        </option>
        {jours.map((j) => {
          const jz = journeeZoneDuJour(journees, zoneId, j)
          const ouverte = caisseOuverte(j)
          return (
            <option key={j} value={j} disabled={!ouverte}>
              {libelleJourCollecte(j, auj)}
              {jz ? ` — réel ${formatMontant(jz.montantReel)}` : ''}
              {!ouverte ? ' — caisse non ouverte' : caisseCloturee(j) ? ' — caisse clôturée' : ''}
            </option>
          )
        })}
      </select>
      <p className="mt-1 text-xs text-slate-400">
        Toutes les collectes de zone encore ouvertes sont listées ; celles dont la caisse n’est pas
        ouverte sont grisées (ouvrez d’abord la caisse de ce jour). L’opération est enregistrée à la
        date choisie : elle alimente le théorique de cette journée zone et la caisse de ce jour-là. Si
        cette caisse est déjà clôturée, seule cette journée est recalculée (théorique, écart, cumuls) :
        son montant compté et la caisse actuelle ne changent pas.
      </p>
    </div>
  )
}

export default function DetailTontine() {
  const { id } = useParams()
  const navigate = useNavigate()
  const {
    data,
    aDroit,
    estAdmin,
    estChefAgence,
    encaisserCotisation,
    renouvelerCarnet,
    changerMiseCarnet,
    retraitCycle,
    cloturerCycle,
    basculerVerrouCarnet,
    basculerRetraitCarnetAdmin,
    supprimerCarnet,
  } = useStore()
  const { confirmer, alerter } = useConfirmation()

  const [modaleDepot, setModaleDepot] = useState(false)
  const [montantDepot, setMontantDepot] = useState('')
  const [recapDepot, setRecapDepot] = useState(false)
  const [modaleMise, setModaleMise] = useState(false)
  const [nouvelleMise, setNouvelleMise] = useState('')
  const [retraitSur, setRetraitSur] = useState<EtatCycle | null>(null)
  const [nbCarreaux, setNbCarreaux] = useState('1')
  const [transfertCycle, setTransfertCycle] = useState<number | null>(null)
  const [clotureSur, setClotureSur] = useState<EtatCycle | null>(null)
  const [clotureAvecRetrait, setClotureAvecRetrait] = useState(true)
  const [clotureEnCours, setClotureEnCours] = useState(false)
  const [erreur, setErreur] = useState('')
  const [dateCollecte, setDateCollecte] = useState(() => aujourdHuiIso())
  const [modaleRenouvellement, setModaleRenouvellement] = useState(false)
  const [payerAbonnement, setPayerAbonnement] = useState(false)
  const [payerPc, setPayerPc] = useState(false)
  const [modaleSuppression, setModaleSuppression] = useState(false)
  const [confirmationSuppression, setConfirmationSuppression] = useState('')
  const [erreurSuppression, setErreurSuppression] = useState('')
  const [suppressionEnCours, setSuppressionEnCours] = useState(false)

  const carnet = data.carnets.find((c) => c.id === id)
  const client = carnet ? data.clients.find((c) => c.id === carnet.clientId) : undefined
  const zone = carnet ? data.zones.find((z) => z.id === carnet.zoneId) : undefined
  const peutOperer = aDroit('operer_comptes')
  const peutVerrouiller = aDroit('verrouiller_comptes')

  const aujourdhui = aujourdHuiIso()
  const joursZoneSaisissables = carnet
    ? joursCollecteSaisissables(data.journeesCompteZone, carnet.zoneId, aujourdhui)
    : []
  // Dépôt / renouvellement / complément sont datés du jour de collecte : la caisse de l'agence
  // doit avoir été ouverte ce jour-là (le serveur applique la même règle). Déjà clôturée : accepté,
  // le serveur recalcule l'arrêt de ce jour seulement.
  const caisseOuverteLe = (jour: string) =>
    !!carnet &&
    (data.ouverturesCaisse ?? []).some((o) => o.agenceId === carnet.agenceId && o.journee === jour)
  const arretCaisseLe = (jour: string) =>
    carnet ? data.arretsCaisse.find((a) => a.agenceId === carnet.agenceId && a.journee === jour) : undefined
  const caisseClotureeLe = (jour: string) => !!arretCaisseLe(jour)
  const joursSaisissables = joursZoneSaisissables.filter(caisseOuverteLe)
  const joursSansCaisse = joursZoneSaisissables.filter((j) => !caisseOuverteLe(j))
  const collecteOuverte = joursSaisissables.length > 0
  const messageCollecteFermee =
    joursSansCaisse.length > 0
      ? `Caisse non ouverte le ${joursSansCaisse
          .map((j) => formatDate(j + 'T12:00:00'))
          .join(', ')} : ouvrez d’abord la caisse de ce jour.`
      : 'Saisissez d’abord le montant réel collecté (journée du jour ou journée antérieure encore ouverte)'
  const journeeAujourdhui = carnet
    ? journeeZoneDuJour(data.journeesCompteZone, carnet.zoneId, aujourdhui)
    : undefined
  const collecteAujourdhuiCloturee = !!journeeAujourdhui?.cloturee
  // Au moins une collecte de zone ouverte : le formulaire s'ouvre et liste toutes les journées
  const collecteZoneOuverte = joursZoneSaisissables.length > 0
  // Présélection : aujourd'hui, sinon la collecte la plus récente dont la caisse est ouverte et non
  // clôturée ; jamais une journée de caisse clôturée (l'agent la choisit lui-même). Sinon aucune.
  const jourCollecteParDefaut =
    [aujourdhui, ...joursSaisissables].find((j) => joursSaisissables.includes(j) && !caisseClotureeLe(j)) ?? ''
  const erreurJourCollecte = (jour: string): string | null => {
    if (!collecteZoneOuverte) {
      return collecteAujourdhuiCloturee
        ? 'Aucune collecte ouverte : la journée d’aujourd’hui est déjà clôturée.'
        : messageCollecteFermee
    }
    if (!jour) return 'Choisissez la journée de collecte.'
    if (!caisseOuverteLe(jour)) {
      return `La caisse du ${formatDate(`${jour}T12:00:00`)} n’est pas ouverte : ouvrez d’abord cette journée de caisse, ou choisissez une autre collecte.`
    }
    if (!joursSaisissables.includes(jour)) return messageCollecteFermee
    return null
  }

  const cycles = useMemo(
    () => (carnet ? situationsCycles(carnet, data.mises, data.transactions) : []),
    [carnet, data.mises, data.transactions],
  )

  // Cases cotisées sur le mois en cours (un retrait ne les libère pas)
  const payeesActuel = carnet ? carreauxDeposes(carnet, data.mises, carnet.cycleActuel) : 0
  const moisActuel = carnet ? moisDuCycle(carnet, carnet.cycleActuel) : null
  const eligibilite = carnet ? eligibiliteRetraitCarnet(carnet, data.mises) : { autorise: true }
  const carteRestreinte = carnet ? CARNETS_RETRAIT_6_MOIS.includes(carnet.typeCarnet) : false
  const retraitAutorise = eligibilite.autorise && !carnet?.verrouille
  const peutSaisirAbo = carnet
    ? abonnementASaisir(carnet, data.mises, data.transactions)
    : false
  const peutSaisirPc = carnet ? pcASaisir(carnet, data.mises, data.transactions) : false
  const cycleEff = carnet ? cycleCourantEffectif(carnet, data.mises) : 1
  const abonnementPaye = carnet
    ? anneeCarnet(cycleEff) > 1 &&
      anneeCarnet(cycleEff) <= anneeCarnetOuverte(carnet, data.mises, data.transactions)
      ? true
      : abonnementAnnee1Paye(carnet, data.transactions)
    : false
  const pcPayeCycle = carnet ? pcPayeeSurCycle(carnet, data.transactions, cycleEff) : false
  const calcDepot = carnet
    ? preparerDepotTontine(
        Number(montantDepot) || 0,
        carnet.mise,
        payerAbonnement && peutSaisirAbo,
        payerPc && peutSaisirPc,
      )
    : null
  const planDepot =
    carnet && calcDepot?.ok && calcDepot.nombreMises > 0
      ? repartirDepotSurCycles(carnet, data.mises, calcDepot.nombreMises, data.transactions)
      : carnet && calcDepot?.ok && calcDepot.nombreMises === 0
        ? { ok: true as const, tranches: [], cycleFinal: carnet.cycleActuel }
        : null
  const besoinRenouvellement = carnet
    ? besoinRenouvellementCarnet(carnet, data.mises, data.transactions)
    : false
  const anneeNouvelle = carnet
    ? anneeCarnetOuverte(carnet, data.mises, data.transactions) + 1
    : 2
  const apercuComplement = carnet
    ? montantComplementMise(carnet, data.mises, Number(nouvelleMise) || 0)
    : null
  // Baisse de mise : cycle en cours, reconverti en carreaux de la nouvelle mise s'il a déjà des dépôts
  const cycleEnCours = carnet ? cycleCourantEffectif(carnet, data.mises) : 1
  const deposesEnCours = carnet ? carreauxDeposes(carnet, data.mises, cycleEnCours) : 0
  const possiblesBaisse = carnet ? misesPossiblesReduction(carnet, data.mises, cycleEnCours) : []
  const baisseChoisie = possiblesBaisse.find((x) => x.mise === Number(nouvelleMise))
  const pcRendue =
    carnet && baisseChoisie && pcPayeeSurCycle(carnet, data.transactions, cycleEnCours)
      ? carnet.mise - baisseChoisie.mise
      : 0
  const peutReduireMise = estAdmin || estChefAgence

  if (!carnet || !client) {
    return (
      <div>
        <Link to="/tontines" className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-brand-600 hover:text-brand-700">
          <ArrowLeft className="h-4 w-4" />
          Retour aux carnets
        </Link>
        <p className="text-slate-600">Carnet introuvable.</p>
      </div>
    )
  }

  const ouvrirRecapDepot = (e: React.FormEvent) => {
    e.preventDefault()
    const erreurJour = erreurJourCollecte(dateCollecte)
    if (erreurJour) {
      setErreur(erreurJour)
      return
    }
    if (!calcDepot?.ok) {
      setErreur(calcDepot && !calcDepot.ok ? calcDepot.erreur : 'Montant invalide.')
      return
    }
    if (calcDepot.nombreMises > 0 && planDepot && !planDepot.ok) {
      setErreur(planDepot.erreur)
      return
    }
    setErreur('')
    setRecapDepot(true)
  }

  const suppressionConfirmee = confirmationSuppression.trim().toLowerCase() === 'je confirme'

  const validerSuppression = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!suppressionConfirmee || suppressionEnCours) return
    setErreurSuppression('')
    setSuppressionEnCours(true)
    try {
      const err = await supprimerCarnet(carnet.id)
      if (err) {
        setErreurSuppression(err)
        return
      }
      setModaleSuppression(false)
      setConfirmationSuppression('')
      navigate(`/clients/${carnet.clientId}`)
    } finally {
      setSuppressionEnCours(false)
    }
  }

  const validerDepot = async () => {
    const montant = Number(montantDepot)
    const avant = carnet.cycleActuel
    const resultat = await encaisserCotisation(carnet.id, montant, dateCollecte, {
      payerAbonnement: payerAbonnement && peutSaisirAbo,
      payerPc: payerPc && peutSaisirPc,
    })
    setRecapDepot(false)
    setModaleDepot(false)
    setMontantDepot('')
    setPayerAbonnement(false)
    setPayerPc(false)
    setErreur('')
    if (resultat) {
      await alerter('Dépôt échoué', resultat)
      return
    }
    const nbCycles = planDepot?.ok ? planDepot.tranches.length : 1
    const dernierCycle = planDepot?.ok ? planDepot.tranches[planDepot.tranches.length - 1].cycle : avant
    const completeDernier =
      planDepot?.ok &&
      planDepot.tranches[planDepot.tranches.length - 1].payeesAvant +
        planDepot.tranches[planDepot.tranches.length - 1].nombre >=
        carnet.misesParCycle
    await alerter(
      'Dépôt effectué',
      `Le dépôt de ${formatMontant(montant)} a été enregistré pour ${client.prenom} ${client.nom} (carnet ${carnet.numero}), collecte du ${libelleJourCollecte(dateCollecte, aujourdhui)}.` +
        (nbCycles > 1
          ? `\n\nRéparti sur ${nbCycles} cycles (${planDepot && planDepot.ok ? planDepot.tranches.map((t) => moisDuCycle(carnet, t.cycle).label).join(', ') : ''}).`
          : '') +
        (completeDernier
          ? cycleDansAnnee(dernierCycle) === CYCLES_PAR_CARNET
            ? `\n\n${moisDuCycle(carnet, dernierCycle).label} complet : année de carnet terminée. Renouvelez le carnet (${formatMontant(PRIX_CARNET)}) pour ouvrir 12 nouveaux cycles.`
            : `\n\n${moisDuCycle(carnet, dernierCycle).label} complet : passage automatique au mois suivant.`
          : ''),
    )
  }

  const validerRenouvellement = async () => {
    const erreurJour = erreurJourCollecte(dateCollecte)
    if (erreurJour) {
      setErreur(erreurJour)
      return
    }
    const err = await renouvelerCarnet(carnet.id, dateCollecte)
    if (err) {
      setErreur(err)
      await alerter('Renouvellement impossible', err)
      return
    }
    setModaleRenouvellement(false)
    setErreur('')
    await alerter(
      'Carnet renouvelé',
      `Frais de ${formatMontant(PRIX_CARNET)} encaissés (collecte du ${libelleJourCollecte(dateCollecte, aujourdhui)}).\n` +
        `Le carnet ${anneeNouvelle} est ouvert : 12 nouveaux cycles. Vous pouvez à nouveau enregistrer des dépôts.`,
    )
  }

  const validerBaisseMise = async (nm: number) => {
    if (!peutReduireMise) {
      setErreur('Réduire la mise est réservé à l’administrateur ou au chef d’agence.')
      return
    }
    const choix = possiblesBaisse.find((x) => x.mise === nm)
    if (deposesEnCours > 0 && !choix) {
      setErreur(
        possiblesBaisse.length
          ? `Choisissez une des mises proposées : ${possiblesBaisse.map((x) => formatMontant(x.mise)).join(', ')}.`
          : 'Aucune mise plus basse ne tombe juste en carreaux sur ce cycle.',
      )
      return
    }
    const pc = choix && pcPayeeSurCycle(carnet, data.transactions, cycleEnCours) ? carnet.mise - nm : 0
    const ok = await confirmer({
      titre: 'Confirmer la réduction de mise',
      message:
        `Mise ${formatMontant(carnet.mise)} → ${formatMontant(nm)} (cycle ${cycleEnCours} et suivants).\n` +
        (choix
          ? `${deposesEnCours} carreaux déjà versés (${formatMontant(deposesEnCours * carnet.mise)}) → ` +
            `${choix.carreaux} carreaux de ${formatMontant(nm)}, sans mouvement d’argent.` +
            (pc > 0 ? `\nP.C. ramenée à ${formatMontant(nm)} : ${formatMontant(pc)} rendus au client.` : '')
          : 'Aucun dépôt sur ce cycle : pas de conversion.') +
        '\nLes cycles terminés gardent leur mise.',
      labelValider: 'Réduire la mise',
    })
    if (!ok) return
    const err = await changerMiseCarnet(carnet.id, nm)
    if (err) {
      setErreur(err)
      await alerter('Changement impossible', err)
      return
    }
    setModaleMise(false)
    setErreur('')
    await alerter(
      'Mise mise à jour',
      choix
        ? `Nouvelle mise : ${formatMontant(nm)}.\nCycle ${cycleEnCours} : ${choix.carreaux} carreaux.`
        : `Nouvelle mise : ${formatMontant(nm)}.`,
    )
  }

  const validerRetrait = async (total: boolean) => {
    if (!retraitSur) return
    const n = total ? retraitSur.retirables : Number(nbCarreaux)
    const montant = miseDuCycle(carnet, retraitSur.cycle) * n
    const cycle = retraitSur.cycle
    const moisLabel = retraitSur.moisLabel
    const retiresApres = retraitSur.retires + n
    const disponiblesApres = Math.max(0, retraitSur.retirables - n)
    const montantDispoApres = disponiblesApres * miseDuCycle(carnet, cycle)
    const resultat = await retraitCycle(carnet.id, cycle, n)
    setRetraitSur(null)
    setNbCarreaux('1')
    setErreur('')
    if (resultat) {
      await alerter('Retrait échoué', resultat)
      return
    }
    await alerter(
      'Retrait effectué',
      `Retrait ${total ? 'total' : 'partiel'} de ${formatMontant(montant)} (${n} mise${n > 1 ? 's' : ''}) — ${moisLabel}.\n\n` +
        `Mises retirées : ${retiresApres}\n` +
        `Mises disponibles : ${disponiblesApres}\n` +
        `Montant disponible : ${formatMontant(montantDispoApres)}`,
    )
  }

  const ouvrirTransfert = (et: EtatCycle) => {
    if (!retraitAutorise) return
    setTransfertCycle(et.cycle)
  }

  /** Clôture anticipée du mois en cours (même non plein) : avec ou sans retrait, le cycle suivant s’ouvre. */
  const peutCloturer = (et: EtatCycle) =>
    peutOperer && et.estActuel && !et.complet && et.deposes > 0 && !carnet?.verrouille

  const ouvrirCloture = (et: EtatCycle) => {
    setClotureSur(et)
    // Avec retrait par défaut, s'il est possible
    setClotureAvecRetrait(retraitAutorise && et.retirables > 0)
  }

  const validerCloture = async () => {
    if (!clotureSur || !carnet) return
    const et = clotureSur
    const avecRetrait = clotureAvecRetrait
    const suivant = moisDuCycle(carnet, et.cycle + 1).label
    setClotureEnCours(true)
    const resultat = await cloturerCycle(carnet.id, et.cycle, avecRetrait)
    setClotureEnCours(false)
    if (resultat) {
      await alerter('Clôture impossible', resultat)
      return
    }
    setClotureSur(null)
    await alerter(
      'Cycle clôturé',
      (avecRetrait
        ? `${formatMontant(et.montantRetirable)} remis au client en espèces — ${et.moisLabel}.\n`
        : `${formatMontant(et.montantRetirable)} restent disponibles sur ${et.moisLabel} (retrait ou transfert plus tard).\n`) +
        `Nouveau cycle ouvert : ${suivant}.`,
    )
  }

  return (
    <div>
      <Link to="/tontines" className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-brand-600 hover:text-brand-700">
        <ArrowLeft className="h-4 w-4" />
        Retour aux carnets
      </Link>

      <EnTetePage
        titre={`Carnet ${carnet.numero}`}
        sousTitre={`${LIBELLES_CARNET[carnet.typeCarnet]} — ${client.prenom} ${client.nom} (n° ${afficherNumeroClient(client.codeClient)}) — ${data.agences.find((a) => a.id === carnet.agenceId)?.nom ?? 'Agence'} · Zone ${data.zones.find((z) => z.id === carnet.zoneId)?.code ?? '—'}`}
        action={
          <div className="flex flex-wrap gap-2">
            {peutOperer && besoinRenouvellement && (
              <button
                className="btn-primary"
                disabled={carnet.verrouille || !collecteZoneOuverte}
                title={
                  carnet.verrouille
                    ? 'Carnet verrouillé'
                    : !collecteZoneOuverte
                      ? messageCollecteFermee
                      : `Encaisser ${formatMontant(PRIX_CARNET)} et ouvrir 12 nouveaux cycles`
                }
                onClick={() => {
                  setErreur('')
                  setDateCollecte(jourCollecteParDefaut)
                  setModaleRenouvellement(true)
                }}
              >
                <BookPlus className="h-4 w-4" />
                Renouveler le carnet
              </button>
            )}
            {peutOperer && (
              <button
                className="btn-primary"
                disabled={carnet.verrouille || !collecteZoneOuverte || besoinRenouvellement}
                title={
                  carnet.verrouille
                    ? 'Carnet verrouillé'
                    : besoinRenouvellement
                      ? `Année terminée : renouvelez le carnet (${formatMontant(PRIX_CARNET)}) pour ouvrir 12 nouveaux cycles`
                      : !collecteZoneOuverte
                      ? messageCollecteFermee
                      : payeesActuel >= carnet.misesParCycle
                        ? 'Mois complet : le prochain dépôt passera au mois suivant'
                        : undefined
                }
                onClick={() => {
                  setMontantDepot('')
                  setPayerAbonnement(false)
                  setPayerPc(false)
                  setErreur('')
                  setDateCollecte(jourCollecteParDefaut)
                  setModaleDepot(true)
                }}
              >
                <ArrowDownToLine className="h-4 w-4" />
                Dépôt
              </button>
            )}
            {peutOperer && (
              <button
                className="btn-secondary"
                disabled={carnet.verrouille}
                title={carnet.verrouille ? 'Carnet verrouillé' : undefined}
                onClick={() => {
                  setNouvelleMise(String(carnet.mise))
                  setErreur('')
                  setDateCollecte(jourCollecteParDefaut)
                  setModaleMise(true)
                }}
              >
                <RefreshCw className="h-4 w-4" />
                Changer la mise
              </button>
            )}
            {peutVerrouiller && (
              <button
                className="btn-secondary"
                onClick={async () => {
                  const ok = await confirmer({
                    titre: carnet.verrouille ? 'Déverrouiller' : 'Verrouiller',
                    message: carnet.verrouille
                      ? `Déverrouiller le carnet ${carnet.numero} ?`
                      : `Verrouiller le carnet ${carnet.numero} ?`,
                    labelValider: carnet.verrouille ? 'Déverrouiller' : 'Verrouiller',
                    danger: !carnet.verrouille,
                  })
                  if (ok) await basculerVerrouCarnet(carnet.id)
                }}
              >
                {carnet.verrouille ? <LockOpen className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
              </button>
            )}
            {estAdmin && (
              <button
                className="btn-danger"
                onClick={() => {
                  setConfirmationSuppression('')
                  setErreurSuppression('')
                  setModaleSuppression(true)
                }}
              >
                <Trash2 className="h-4 w-4" />
                Supprimer
              </button>
            )}
            {estAdmin && carteRestreinte && (
              <button
                className={carnet.retraitActiveParAdmin ? 'btn-secondary' : 'btn-primary'}
                onClick={async () => {
                  const activer = !carnet.retraitActiveParAdmin
                  const ok = await confirmer({
                    titre: activer ? 'Activer les retraits' : 'Désactiver les retraits',
                    message: activer
                      ? `Autoriser les retraits partiels et totaux sur le carnet ${carnet.numero} (${LIBELLES_CARNET[carnet.typeCarnet]}) ?`
                      : `Désactiver les retraits sur le carnet ${carnet.numero} ? Les boutons resteront visibles mais grisés.`,
                    labelValider: activer ? 'Activer' : 'Désactiver',
                    danger: !activer,
                  })
                  if (!ok) return
                  const err = await basculerRetraitCarnetAdmin(carnet.id)
                  if (err) await alerter('Action impossible', err)
                  else
                    await alerter(
                      activer ? 'Retraits activés' : 'Retraits désactivés',
                      activer
                        ? 'Les caissiers peuvent maintenant effectuer des retraits sur ce carnet.'
                        : 'Les retraits sont de nouveau bloqués (boutons grisés).',
                    )
                }}
              >
                {carnet.retraitActiveParAdmin ? 'Désactiver retraits' : 'Activer retraits'}
              </button>
            )}
          </div>
        }
      />

      {peutOperer && !collecteOuverte && (
        <div
          className={`mb-6 rounded-xl px-4 py-3 text-sm ring-1 ${
            collecteAujourdhuiCloturee
              ? 'bg-slate-50 text-slate-700 ring-slate-200'
              : 'bg-amber-50 text-amber-950 ring-amber-200'
          }`}
        >
          {collecteAujourdhuiCloturee ? (
            <p>
              La collecte tontine de la zone {zone?.code ?? '—'} est <strong>clôturée</strong> pour
              aujourd’hui, et aucune journée antérieure n’est encore ouverte — plus de dépôt
              possible.
            </p>
          ) : joursSansCaisse.length > 0 ? (
            <>
              <p className="font-semibold">Caisse non ouverte pour la collecte</p>
              <p className="mt-1">{messageCollecteFermee}</p>
            </>
          ) : (
            <>
              <p className="font-semibold">Montant réel collecté requis</p>
              <p className="mt-1">
                Avant tout dépôt sur ce carnet, saisissez le montant réellement collecté pour la zone{' '}
                <strong>{zone?.code ?? '—'}</strong>
                {zone?.nom ? ` (${zone.nom})` : ''} (journée du jour ou journée encore ouverte).
              </p>
              <Link
                to={`/zones/${carnet.zoneId}/compte`}
                className="mt-2 inline-flex text-sm font-semibold text-brand-700 hover:text-brand-800"
              >
                Aller saisir le montant réel →
              </Link>
            </>
          )}
        </div>
      )}

      {peutOperer && besoinRenouvellement && (
        <div className="mb-6 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-950 ring-1 ring-amber-200">
          <p className="font-semibold">Renouvellement du carnet dû</p>
          <p className="mt-1">
            Les 12 cycles de l’année sont terminés. Encaissez les frais de{' '}
            <strong>{formatMontant(PRIX_CARNET)}</strong> pour ouvrir le carnet {anneeNouvelle} (12
            nouveaux cycles). Les dépôts sont bloqués tant que le renouvellement n’est pas fait.
          </p>
        </div>
      )}

      {peutOperer && collecteOuverte && (
        <div className="mb-6 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900 ring-1 ring-emerald-200">
          <p>
            Collecte zone {zone?.code ?? '—'} ouverte
            {joursSaisissables.length > 1
              ? ` — ${joursSaisissables.length} journées encore saisissables (aujourd’hui et/ou rattrapage).`
              : joursSaisissables[0] === aujourdhui
                ? ' — réel saisi pour aujourd’hui : '
                : ` — ${libelleJourCollecte(joursSaisissables[0], aujourdhui)} : `}
            {joursSaisissables.length === 1 && (
              <strong>
                {formatMontant(
                  journeeZoneDuJour(data.journeesCompteZone, carnet.zoneId, joursSaisissables[0])
                    ?.montantReel ?? 0,
                )}
              </strong>
            )}
          </p>
          {joursSaisissables.length > 1 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-5">
              {joursSaisissables.map((j) => {
                const jz = journeeZoneDuJour(data.journeesCompteZone, carnet.zoneId, j)
                return (
                  <li key={j}>
                    {libelleJourCollecte(j, aujourdhui)} — réel{' '}
                    <strong>{formatMontant(jz?.montantReel ?? 0)}</strong>
                  </li>
                )
              })}
            </ul>
          )}
          <p className="mt-2 text-xs text-emerald-800">
            Au dépôt, choisissez la collecte concernée (tournée du jour ou fin de saisie de la
            veille).
          </p>
          <Link
            to={`/zones/${carnet.zoneId}/compte`}
            className="mt-2 inline-flex font-semibold text-brand-700 hover:text-brand-800"
          >
            Voir le compte zone
          </Link>
        </div>
      )}

      <div className="mb-6 flex flex-wrap items-center gap-4">
        <Avatar nom={client.nom} prenom={client.prenom} taille="lg" />
        <div>
          <Link to={`/clients/${client.id}`} className="font-semibold text-slate-900 hover:text-brand-700">
            {client.prenom} {client.nom}
          </Link>
          <p className="text-sm text-slate-500">
            Mise {formatMontant(carnet.mise)} — ouvert le {formatDate(carnet.dateOuverture)}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <span
              className={`badge ${
                abonnementPaye ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
              }`}
            >
              Abonnement {abonnementPaye ? 'payé' : 'non payé'}
            </span>
            <span
              className={`badge ${
                pcPayeCycle ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
              }`}
            >
              P.C. {pcPayeCycle ? 'payée' : 'non payée'}
            </span>
          </div>
          {carnet.verrouille && (
            <span className="mt-1 inline-flex items-center rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-medium text-rose-700">
              <Lock className="mr-1 h-3 w-3" />
              Verrouillé
            </span>
          )}
          {carteRestreinte && (
            <span
              className={`mt-1 ml-2 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                carnet.retraitActiveParAdmin
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-slate-200 text-slate-600'
              }`}
            >
              Retraits {carnet.retraitActiveParAdmin ? 'activés (admin)' : 'non activés'}
            </span>
          )}
        </div>
      </div>

      {/* Cycle en cours */}
      <div className="card mb-6">
        <h3 className="mb-3 font-semibold text-slate-900">
          Mois en cours — {moisActuel?.label}{' '}
          <span className="font-normal text-slate-500">({libelleCycleCarnet(carnet.cycleActuel)})</span>
        </h3>
        <div className="mb-3 grid grid-cols-2 gap-2 text-sm">
          <div
            className={`rounded-xl px-3 py-2 ${
              abonnementPaye ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-950'
            }`}
          >
            <p className="text-xs font-medium opacity-80">Abonnement ({formatMontant(PRIX_CARNET)})</p>
            <p className="font-semibold">{abonnementPaye ? 'Payé' : 'Non payé'}</p>
          </div>
          <div
            className={`rounded-xl px-3 py-2 ${
              pcPayeCycle ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-950'
            }`}
          >
            <p className="text-xs font-medium opacity-80">P.C. de ce cycle ({formatMontant(carnet.mise)})</p>
            <p className="font-semibold">{pcPayeCycle ? 'Payée' : 'Non payée'}</p>
          </div>
        </div>
        <div className="mb-2 flex justify-between text-sm text-slate-600">
          <span>
            <span className="font-bold text-slate-900">{payeesActuel}</span> / {carnet.misesParCycle} carreaux
          </span>
          <span>Collecté : {formatMontant(Math.max(0, payeesActuel) * carnet.mise)}</span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-brand-500"
            style={{ width: `${Math.min(100, (payeesActuel / carnet.misesParCycle) * 100)}%` }}
          />
        </div>
        <p className="mt-3 text-xs text-slate-500">
            À {carnet.misesParCycle} carreaux, le compte passe automatiquement au mois suivant. Un dépôt
            peut couvrir plusieurs cycles d’un coup. L’abonnement ({formatMontant(PRIX_CARNET)}, une fois
            pour 12 cycles) et la P.C. (chaque cycle) se règlent en les cochant sur le dépôt — un client
            peut cotiser avant de les payer. Après 12 cycles, utilisez{' '}
            <strong>Renouveler le carnet</strong> ({formatMontant(PRIX_CARNET)}). Un retrait partiel est
            possible sur le mois en cours ; le retrait total reste réservé aux mois passés.
        </p>
        {carteRestreinte && !eligibilite.autorise && (
          <p className="mt-2 rounded-xl bg-amber-50 p-2.5 text-xs text-amber-800">
            Retraits grisés : seul l’administrateur peut les activer
            {eligibilite.dateDeblocage
              ? ` (délai indicatif 6 mois : ${formatDate(eligibilite.dateDeblocage)})`
              : ''}
            .
          </p>
        )}
      </div>

      {/* Historique des cycles / mois */}
      <div className="card !p-0 overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="font-semibold text-slate-900">Mois (cycles) et état</h3>
          <p className="text-xs text-slate-500">
            Chaque cycle correspond à un mois. Un mois soldé (retrait total) apparaît grisé.
            La P.C. n’est déduite des mises disponibles que si elle a été cochée au dépôt.
            Retrait partiel possible aussi sur le mois en cours. « Clôturer le cycle » ouvre le cycle
            suivant même si le mois n’est pas plein : avec retrait (le client est remboursé) ou sans
            retrait (l’argent reste disponible sur le mois clôturé).
          </p>
        </div>
        <div className="divide-y divide-slate-100">
          {[...cycles].reverse().map((et) => (
            <div
              key={et.cycle}
              className={`px-5 py-4 ${
                et.grise ? 'bg-slate-100/80' : et.estActuel ? 'bg-brand-50/40' : 'bg-white'
              } ${et.grise ? 'text-slate-500' : ''}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-base font-bold ${et.grise ? 'text-slate-500' : 'text-slate-900'}`}>
                      {et.moisLabel}
                    </span>
                    <span className="text-xs text-slate-500">({libelleCycleCarnet(et.cycle)})</span>
                    {estPremierCycleRenouvellement(et.cycle) && (
                      <span className="badge bg-sky-100 text-sky-800">Renouvellement</span>
                    )}
                    {et.estActuel && <span className="badge bg-brand-100 text-brand-700">En cours</span>}
                    {!et.estActuel && et.complet && !et.grise && (
                      <span className="badge bg-amber-100 text-amber-800">Mois passé — à retirer</span>
                    )}
                    {et.cloture && (
                      <span className="badge bg-slate-200 text-slate-700">
                        {et.retirables > 0 ? 'Clôturé — à retirer' : 'Clôturé'}
                      </span>
                    )}
                    {et.grise && !et.cloture && <span className="badge bg-slate-200 text-slate-600">Mois soldé</span>}
                    {pcPayeeSurCycle(carnet, data.transactions, et.cycle) ? (
                      <span className="badge bg-emerald-100 text-emerald-800">P.C. payée</span>
                    ) : (
                      <span className="badge bg-amber-100 text-amber-800">P.C. non payée</span>
                    )}
                    {!et.estActuel && !et.complet && !et.cloture && (
                      <span className="badge bg-slate-100 text-slate-600">Mois passé</span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    Cotisé : {et.deposes}/{carnet.misesParCycle} mises
                  </p>
                </div>
                {peutOperer && (et.retirables > 0 || peutCloturer(et)) && (
                    <div className="flex flex-col items-end gap-1">
                      <div className="flex flex-wrap justify-end gap-2">
                        {et.retirables > 0 && (
                          <button
                            type="button"
                            className="btn-secondary !py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
                            disabled={!retraitAutorise}
                            title={
                              !retraitAutorise
                                ? carnet.verrouille
                                  ? 'Carnet verrouillé'
                                  : 'Retrait non activé par l’administrateur'
                                : 'Retrait partiel'
                            }
                            onClick={() => {
                              if (!retraitAutorise) return
                              setRetraitSur(et)
                              setNbCarreaux('1')
                              setErreur('')
                            }}
                          >
                            <ArrowUpFromLine className="h-3.5 w-3.5" />
                            Retrait partiel
                          </button>
                        )}
                        {peutCloturer(et) && (
                          <button
                            type="button"
                            className="btn-danger !py-1.5 text-xs"
                            title="Le client arrête ce cycle (avec ou sans retrait) : le cycle suivant s’ouvre"
                            onClick={() => ouvrirCloture(et)}
                          >
                            <CircleStop className="h-3.5 w-3.5" />
                            Clôturer le cycle
                          </button>
                        )}
                        {!et.estActuel && (
                          <button
                            type="button"
                            className="btn-primary !py-1.5 text-xs disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
                            disabled={!retraitAutorise}
                            title={
                              !retraitAutorise
                                ? carnet.verrouille
                                  ? 'Carnet verrouillé'
                                  : 'Retrait non activé par l’administrateur'
                                : 'Retrait total'
                            }
                            onClick={async () => {
                              if (!retraitAutorise) return
                              const ok = await confirmer({
                                titre: `Retrait total — ${et.moisLabel}`,
                                message:
                                  `Retirer ${formatMontant(et.montantRetirable)} (${et.retirables} mise${et.retirables > 1 ? 's' : ''}${pcPayeeSurCycle(carnet, data.transactions, et.cycle) ? ' hors P.C' : ''}) pour ${client.prenom} ${client.nom} (${et.moisLabel}) ?\n` +
                                  `Mises déjà retirées : ${et.retires}\n` +
                                  `Mises disponibles : ${et.retirables}\n` +
                                  `Montant disponible : ${formatMontant(et.montantRetirable)}\n\n` +
                                  `Le cycle sera ensuite grisé.`,
                                labelValider: 'Retrait total',
                              })
                              if (!ok) return
                              const n = et.retirables
                              const montant = et.montantRetirable
                              const resultat = await retraitCycle(carnet.id, et.cycle, n)
                              if (resultat) await alerter('Retrait échoué', resultat)
                              else
                                await alerter(
                                  'Retrait effectué',
                                  `Retrait total de ${formatMontant(montant)} (${n} mise${n > 1 ? 's' : ''}) — ${et.moisLabel}.\n\n` +
                                    `Mises retirées : ${et.retires + n}\n` +
                                    `Mises disponibles : 0\n` +
                                    `Montant disponible : ${formatMontant(0)}`,
                                )
                            }}
                          >
                            Retrait total
                          </button>
                        )}
                        {et.retirables > 0 && (
                          <button
                            type="button"
                            className="btn-secondary !py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
                            disabled={!retraitAutorise}
                            title={
                              !retraitAutorise
                                ? carnet.verrouille
                                  ? 'Carnet verrouillé'
                                  : 'Retrait non activé par l’administrateur'
                                : 'Virer des mises vers un compte banque, sans passer par la caisse'
                            }
                            onClick={() => ouvrirTransfert(et)}
                          >
                            <ArrowRightLeft className="h-3.5 w-3.5" />
                            Transfert
                          </button>
                        )}
                      </div>
                      {!retraitAutorise && carteRestreinte && (
                        <span className="text-[10px] text-slate-500">En attente d’activation admin</span>
                      )}
                    </div>
                  )}
              </div>

              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div
                  className={`rounded-lg px-3 py-2 ring-1 ${
                    et.grise ? 'bg-slate-50 ring-slate-200' : 'bg-rose-50/80 ring-rose-100'
                  }`}
                >
                  <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Mises retirées
                  </div>
                  <div className={`text-lg font-bold tabular-nums ${et.grise ? 'text-slate-500' : 'text-rose-800'}`}>
                    {et.retires}
                  </div>
                </div>
                <div
                  className={`rounded-lg px-3 py-2 ring-1 ${
                    et.grise ? 'bg-slate-50 ring-slate-200' : 'bg-amber-50/80 ring-amber-100'
                  }`}
                >
                  <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Mises disponibles
                  </div>
                  <div className={`text-lg font-bold tabular-nums ${et.grise ? 'text-slate-500' : 'text-amber-900'}`}>
                    {et.retirables}
                  </div>
                  {pcPayeeSurCycle(carnet, data.transactions, et.cycle) && (
                    <div className="text-[10px] text-slate-500">hors P.C</div>
                  )}
                </div>
                <div
                  className={`rounded-lg px-3 py-2 ring-1 ${
                    et.grise ? 'bg-slate-50 ring-slate-200' : 'bg-emerald-50/80 ring-emerald-100'
                  }`}
                >
                  <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Montant disponible
                  </div>
                  <div className={`text-lg font-bold tabular-nums ${et.grise ? 'text-slate-500' : 'text-emerald-800'}`}>
                    {formatMontant(et.montantRetirable)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <Modale
        titre={`Renouveler le carnet — ${client.prenom} ${client.nom}`}
        ouverte={modaleRenouvellement}
        onFermer={() => setModaleRenouvellement(false)}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void validerRenouvellement()
          }}
          className="space-y-4"
        >
          <div className="rounded-xl bg-brand-50 p-4 text-sm text-brand-900">
            <p>
              Les 12 cycles sont terminés. L’encaissement de{' '}
              <strong>{formatMontant(PRIX_CARNET)}</strong> ouvre le{' '}
              <strong>carnet {anneeNouvelle}</strong> (12 nouveaux cycles).
            </p>
            <div className="mt-3 flex justify-between border-t border-brand-200 pt-2">
              <span>Frais de renouvellement</span>
              <span className="text-lg font-bold">{formatMontant(PRIX_CARNET)}</span>
            </div>
          </div>
          <SelectJourCollecte
            jours={joursZoneSaisissables}
            value={dateCollecte}
            onChange={setDateCollecte}
            journees={data.journeesCompteZone}
            zoneId={carnet.zoneId}
            caisseOuverte={caisseOuverteLe}
            caisseCloturee={caisseClotureeLe}
          />
          {erreur && <p className="text-sm font-medium text-rose-600">{erreur}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setModaleRenouvellement(false)}>
              Annuler
            </button>
            <button type="submit" className="btn-primary">
              <BookPlus className="h-4 w-4" />
              Encaisser {formatMontant(PRIX_CARNET)}
            </button>
          </div>
        </form>
      </Modale>

      {/* Modale dépôt */}
      <Modale
        titre={`Dépôt — ${client.prenom} ${client.nom}`}
        ouverte={modaleDepot && !recapDepot}
        onFermer={() => setModaleDepot(false)}
      >
        <form onSubmit={ouvrirRecapDepot} className="space-y-4">
          <div className="rounded-xl bg-slate-50 p-3 text-sm">
            Mise : <span className="font-bold">{formatMontant(carnet.mise)}</span> — carreaux :{' '}
            <span className="font-bold">
              {payeesActuel}/{carnet.misesParCycle}
            </span>
            {carnet.misesParCycle - payeesActuel > 0 && (
              <span className="mt-1 block text-xs text-slate-500">
                {carnet.misesParCycle - payeesActuel} restant(s) sur ce cycle (
                {formatMontant((carnet.misesParCycle - payeesActuel) * carnet.mise)}) — le surplus
                alimente le(s) cycle(s) suivant(s).
              </span>
            )}
          </div>
          <div>
            <label className="label">Montant remis (FCFA) *</label>
            <input
              className="input"
              type="number"
              min={1}
              step={1}
              required
              autoFocus
              value={montantDepot}
              onChange={(e) => setMontantDepot(e.target.value)}
            />
            <p className="mt-1 text-xs text-slate-400">
              L’abonnement (s’il est coché) est retiré avant de compter les carreaux. La P.C. reste un
              carreau du carnet.
            </p>
          </div>
          {(peutSaisirAbo || peutSaisirPc) && (
            <div className="space-y-2">
              {peutSaisirAbo && (
                <label className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={payerAbonnement}
                    onChange={(e) => setPayerAbonnement(e.target.checked)}
                  />
                  <span>
                    <span className="font-medium text-slate-900">Abonnement</span>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      {formatMontant(PRIX_CARNET)} — une fois pour 12 cycles, déduit du montant
                    </span>
                  </span>
                </label>
              )}
              {peutSaisirPc && (
                <label className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={payerPc}
                    onChange={(e) => setPayerPc(e.target.checked)}
                  />
                  <span>
                    <span className="font-medium text-slate-900">P.C. de ce cycle</span>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      {formatMontant(carnet.mise)} — 1er carreau du cycle, prélevé sur le montant
                    </span>
                  </span>
                </label>
              )}
            </div>
          )}
          {calcDepot?.ok && (
            <div className="rounded-xl bg-white px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
              {calcDepot.fraisAbonnement > 0 && (
                <p>Abonnement : −{formatMontant(calcDepot.fraisAbonnement)}</p>
              )}
              {calcDepot.fraisPc > 0 && <p>P.C. : −{formatMontant(calcDepot.fraisPc)}</p>}
              <p>
                Carreaux : <span className="font-semibold text-slate-900">{calcDepot.nombreMises}</span>
                {calcDepot.reste > 0 ? ` (${formatMontant(calcDepot.reste)})` : ''}
              </p>
            </div>
          )}
          <SelectJourCollecte
            jours={joursZoneSaisissables}
            value={dateCollecte}
            onChange={setDateCollecte}
            journees={data.journeesCompteZone}
            zoneId={carnet.zoneId}
            caisseOuverte={caisseOuverteLe}
            caisseCloturee={caisseClotureeLe}
          />
          {erreur && <p className="text-sm font-medium text-rose-600">{erreur}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setModaleDepot(false)}>
              Annuler
            </button>
            <button type="submit" className="btn-primary">
              Vérifier
            </button>
          </div>
        </form>
      </Modale>

      <Modale
        titre={`Changer la mise — ${client.prenom} ${client.nom}`}
        ouverte={modaleMise}
        onFermer={() => setModaleMise(false)}
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            const nm = Number(nouvelleMise)
            if (!Number.isFinite(nm) || nm <= 0) {
              setErreur('Nouvelle mise invalide.')
              return
            }
            if (nm === carnet.mise) {
              setErreur('La nouvelle mise est identique à la mise actuelle.')
              return
            }
            if (nm < carnet.mise) {
              await validerBaisseMise(nm)
              return
            }
            const apercu = montantComplementMise(carnet, data.mises, nm)
            const erreurJour = apercu.complement > 0 ? erreurJourCollecte(dateCollecte) : null
            if (erreurJour) {
              setErreur(erreurJour)
              return
            }
            const ok = await confirmer({
              titre: 'Confirmer le changement de mise',
              message:
                apercu.complement > 0
                  ? `Mise ${formatMontant(carnet.mise)} → ${formatMontant(nm)}.\n` +
                    `${apercu.carreaux} carreau(x) déjà cotisé(s) : complément à encaisser ${formatMontant(apercu.complement)}.\n` +
                    `Collecte du ${libelleJourCollecte(dateCollecte, aujourdhui)}.\n` +
                    `Les dépôts suivants se feront à ${formatMontant(nm)}.`
                  : `Mise ${formatMontant(carnet.mise)} → ${formatMontant(nm)}.\nAucun carreau encore cotisé sur ce cycle : pas de complément.`,
              labelValider: apercu.complement > 0 ? 'Encaisser et changer' : 'Changer la mise',
            })
            if (!ok) return
            const err = await changerMiseCarnet(
              carnet.id,
              nm,
              apercu.complement > 0 ? dateCollecte : undefined,
            )
            if (err) {
              setErreur(err)
              await alerter('Changement impossible', err)
              return
            }
            setModaleMise(false)
            setErreur('')
            await alerter(
              'Mise mise à jour',
              apercu.complement > 0
                ? `Nouvelle mise : ${formatMontant(nm)}.\nComplément encaissé : ${formatMontant(apercu.complement)} (${apercu.carreaux} × ${formatMontant(nm - carnet.mise)}).`
                : `Nouvelle mise : ${formatMontant(nm)}.`,
            )
          }}
          className="space-y-4"
        >
          <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
            <p>
              Mise actuelle : <strong>{formatMontant(carnet.mise)}</strong>
            </p>
            <p className="mt-1">
              Cycle {cycleEnCours}
              {moisActuel ? ` (${moisActuel.label})` : ''} — carreaux cotisés :{' '}
              <strong>{deposesEnCours}</strong>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Le cycle en cours et les suivants changent de mise ; un cycle terminé ou clôturé garde la sienne.
            </p>
          </div>
          <div>
            <label className="label">Nouvelle mise (FCFA) *</label>
            <input
              className="input"
              type="number"
              min={1}
              step={1}
              required
              autoFocus
              value={nouvelleMise}
              onChange={(e) => setNouvelleMise(e.target.value)}
            />
          </div>
          {Number(nouvelleMise) > carnet.mise && apercuComplement && apercuComplement.complement > 0 && (
            <SelectJourCollecte
              jours={joursZoneSaisissables}
              value={dateCollecte}
              onChange={setDateCollecte}
              journees={data.journeesCompteZone}
              zoneId={carnet.zoneId}
              caisseOuverte={caisseOuverteLe}
              caisseCloturee={caisseClotureeLe}
            />
          )}
          {Number(nouvelleMise) > carnet.mise && apercuComplement && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
              {apercuComplement.carreaux > 0 ? (
                <>
                  <p className="font-medium">Complément à encaisser</p>
                  <p className="mt-1 text-xs">
                    {apercuComplement.carreaux} carreaux ×{' '}
                    {formatMontant(Number(nouvelleMise) - carnet.mise)} ={' '}
                    <strong>{formatMontant(apercuComplement.complement)}</strong>
                  </p>
                  <p className="mt-2 text-xs text-amber-800">
                    Le nombre de carreaux ne change pas. Les prochains dépôts se feront à la nouvelle
                    mise.
                  </p>
                </>
              ) : (
                <p className="text-xs">Aucun complément : aucun carreau encore cotisé sur ce cycle.</p>
              )}
            </div>
          )}
          {Number(nouvelleMise) > 0 && Number(nouvelleMise) < carnet.mise && (
            <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
              {!peutReduireMise ? (
                <p>Réduire la mise est réservé à l’administrateur ou au chef d’agence.</p>
              ) : deposesEnCours === 0 ? (
                <p>
                  Aucun dépôt sur ce cycle : la mise passe simplement à{' '}
                  <strong>{formatMontant(Number(nouvelleMise))}</strong>, sans conversion.
                </p>
              ) : (
                <>
                  <p className="font-medium">Mises possibles pour ce cycle</p>
                  <p className="mt-1 text-xs">
                    Les {formatMontant(deposesEnCours * carnet.mise)} déjà versés sont reconvertis en carreaux de
                    la nouvelle mise (31 au plus), sans mouvement d’argent.
                  </p>
                  {possiblesBaisse.length === 0 ? (
                    <p className="mt-2 text-xs font-medium">
                      Aucune mise plus basse ne tombe juste en carreaux sur ce cycle.
                    </p>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {possiblesBaisse.map((x) => (
                        <button
                          key={x.mise}
                          type="button"
                          className={`rounded-lg px-3 py-1.5 text-xs font-semibold ring-1 ${
                            Number(nouvelleMise) === x.mise
                              ? 'bg-sky-600 text-white ring-sky-600'
                              : 'bg-white text-sky-800 ring-sky-200 hover:bg-sky-100'
                          }`}
                          onClick={() => setNouvelleMise(String(x.mise))}
                        >
                          {formatMontant(x.mise)} → {x.carreaux} carreaux
                        </button>
                      ))}
                    </div>
                  )}
                  {baisseChoisie && (
                    <p className="mt-2 text-xs">
                      {deposesEnCours} carreaux →{' '}
                      <strong>
                        {baisseChoisie.carreaux} carreaux de {formatMontant(baisseChoisie.mise)}
                      </strong>
                      {pcRendue > 0
                        ? ` ; P.C. ramenée à ${formatMontant(baisseChoisie.mise)} : ${formatMontant(pcRendue)} rendus au client.`
                        : '.'}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
          {erreur && <p className="text-sm font-medium text-rose-600">{erreur}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setModaleMise(false)}>
              Annuler
            </button>
            <button type="submit" className="btn-primary">
              <RefreshCw className="h-4 w-4" />
              Valider
            </button>
          </div>
        </form>
      </Modale>

      <Modale titre="Confirmer le dépôt" ouverte={recapDepot} onFermer={() => setRecapDepot(false)}>
        {calcDepot?.ok && planDepot?.ok && (
          <div className="space-y-4">
            <div className="rounded-xl bg-brand-50 p-4 text-sm text-brand-900">
              <div className="flex justify-between">
                <span>Montant remis</span>
                <span className="font-bold">{formatMontant(Number(montantDepot))}</span>
              </div>
              {calcDepot.fraisAbonnement > 0 && (
                <div className="mt-2 flex justify-between border-t border-brand-200 pt-2">
                  <span>Abonnement</span>
                  <span className="font-bold">−{formatMontant(calcDepot.fraisAbonnement)}</span>
                </div>
              )}
              {calcDepot.fraisPc > 0 && (
                <div className="mt-2 flex justify-between border-t border-brand-200 pt-2">
                  <span>P.C. ({NOM_APPLICATION})</span>
                  <span className="font-bold">−{formatMontant(calcDepot.fraisPc)}</span>
                </div>
              )}
              <div className="mt-2 flex justify-between border-t border-brand-200 pt-2">
                <span>Carreaux inscrits</span>
                <span className="text-lg font-bold">{calcDepot.nombreMises}</span>
              </div>
              {calcDepot.fraisPc > 0 && (
                <p className="mt-1 text-xs text-brand-800">Dont 1 P.C. (1er carreau de ce cycle).</p>
              )}
              <div className="mt-2 flex justify-between border-t border-brand-200 pt-2">
                <span>Collecte du</span>
                <span className="font-bold">{libelleJourCollecte(dateCollecte, aujourdhui)}</span>
              </div>
              {(() => {
                const arret = arretCaisseLe(dateCollecte)
                if (!arret) return null
                const theorique = arret.soldeTheorique + Number(montantDepot)
                return (
                  <p className="mt-2 rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-900">
                    La caisse du {formatDate(dateCollecte + 'T12:00:00')} est déjà clôturée : son
                    théorique passe à <strong>{formatMontant(theorique)}</strong>, le montant compté (
                    {formatMontant(arret.montantCompte)}) ne change pas, l’écart de cette journée devient{' '}
                    <strong>{formatMontant(arret.montantCompte - theorique)}</strong> et les cumuls sont
                    recalculés. La caisse actuelle ne bouge pas.
                  </p>
                )
              })()}
              {planDepot.tranches.length > 1 && (
                <div className="mt-3 border-t border-brand-200 pt-2">
                  <p className="mb-1.5 text-xs font-medium text-brand-800">Répartition par cycle</p>
                  <ul className="space-y-1 text-xs">
                    {planDepot.tranches.map((tr) => {
                      const mois = moisDuCycle(carnet, tr.cycle)
                      return (
                        <li key={tr.cycle} className="flex justify-between gap-3">
                          <span>
                            {mois.label}{' '}
                            <span className="text-brand-700/70">({libelleCycleCarnet(tr.cycle)})</span>
                          </span>
                          <span className="font-semibold tabular-nums">{tr.nombre} carreaux</span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}
              {planDepot.tranches.length > 0 &&
                planDepot.tranches[planDepot.tranches.length - 1].payeesAvant +
                  planDepot.tranches[planDepot.tranches.length - 1].nombre >=
                  carnet.misesParCycle && (
                <p className="mt-2 text-xs font-medium text-brand-800">
                  {planDepot.tranches.length > 1
                    ? `Ce dépôt complète ${planDepot.tranches.filter((t) => t.payeesAvant + t.nombre >= carnet.misesParCycle).length} cycle(s) : passage automatique au mois suivant.`
                    : 'Ce dépôt complète le cycle : passage automatique au mois suivant.'}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setRecapDepot(false)}>
                Modifier
              </button>
              <button type="button" className="btn-primary" onClick={validerDepot}>
                Valider le dépôt
              </button>
            </div>
          </div>
        )}
      </Modale>

      {/* Modale retrait partiel */}
      <Modale
        titre={retraitSur ? `Retrait partiel — ${retraitSur.moisLabel}` : ''}
        ouverte={retraitSur !== null}
        onFermer={() => setRetraitSur(null)}
      >
        {retraitSur && (
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              await validerRetrait(false)
            }}
            className="space-y-4"
          >
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-rose-50 px-2 py-2.5 ring-1 ring-rose-100">
                <div className="text-[10px] font-medium uppercase text-slate-500">Retirées</div>
                <div className="text-base font-bold text-rose-800">{retraitSur.retires}</div>
              </div>
              <div className="rounded-xl bg-amber-50 px-2 py-2.5 ring-1 ring-amber-100">
                <div className="text-[10px] font-medium uppercase text-slate-500">Disponibles</div>
                <div className="text-base font-bold text-amber-900">{retraitSur.retirables}</div>
              </div>
              <div className="rounded-xl bg-emerald-50 px-2 py-2.5 ring-1 ring-emerald-100">
                <div className="text-[10px] font-medium uppercase text-slate-500">Montant dispo.</div>
                <div className="text-sm font-bold text-emerald-800">
                  {formatMontant(retraitSur.montantRetirable)}
                </div>
              </div>
            </div>
            <div>
              <label className="label">Nombre de mises à retirer *</label>
              <input
                className="input"
                type="number"
                min={1}
                max={retraitSur.retirables}
                required
                value={nbCarreaux}
                onChange={(e) => setNbCarreaux(e.target.value)}
              />
            </div>
            {(() => {
              const n = Number(nbCarreaux) || 0
              const dispoApres = Math.max(0, retraitSur.retirables - n)
              return (
                <div className="rounded-xl bg-slate-50 p-3 text-sm space-y-1.5">
                  <div className="flex justify-between font-semibold text-rose-800">
                    <span>Montant du retrait</span>
                    <span>{formatMontant(miseDuCycle(carnet, retraitSur.cycle) * n)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600 border-t border-slate-200 pt-1.5">
                    <span>Mises retirées après</span>
                    <span className="font-bold text-slate-900">{retraitSur.retires + n}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Mises disponibles après</span>
                    <span className="font-bold text-slate-900">{dispoApres}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Montant disponible après</span>
                    <span className="font-bold text-emerald-700">
                      {formatMontant(dispoApres * miseDuCycle(carnet, retraitSur.cycle))}
                    </span>
                  </div>
                </div>
              )
            })()}
            {erreur && <p className="text-sm font-medium text-rose-600">{erreur}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setRetraitSur(null)}>
                Annuler
              </button>
              <button type="submit" className="btn-primary">
                Valider le retrait
              </button>
            </div>
          </form>
        )}
      </Modale>

      <Modale
        titre={clotureSur ? `Clôturer le cycle — ${clotureSur.moisLabel}` : ''}
        ouverte={clotureSur !== null}
        onFermer={() => setClotureSur(null)}
      >
        {clotureSur &&
          (() => {
            const et = clotureSur
            const pcPayee = pcPayeeSurCycle(carnet, data.transactions, et.cycle)
            const suivant = moisDuCycle(carnet, et.cycle + 1).label
            const retraitPossible = retraitAutorise && et.retirables > 0
            const raisonSansRetrait = !retraitAutorise
              ? 'Retrait non activé par l’administrateur pour cette carte.'
              : 'Rien à remettre : seule la P.C. est inscrite sur ce mois.'
            return (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault()
                  void validerCloture()
                }}
              >
                <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700 ring-1 ring-slate-100">
                  <div>Le client arrête ce mois avant qu’il soit plein.</div>
                  <div className="mt-1">
                    Mises cotisées : <strong>{et.deposes}/{carnet.misesParCycle}</strong>
                    {et.retires > 0 && <> — déjà retirées : {et.retires}</>}
                  </div>
                  {pcPayee && <div>P.C. retenue (commission) : {formatMontant(carnet.mise)}</div>}
                  <div>
                    Mises disponibles : <strong>{et.retirables}</strong> ({formatMontant(et.montantRetirable)})
                  </div>
                </div>

                <div className="space-y-2">
                  <label
                    className={`flex gap-3 rounded-xl p-3 ring-1 ${
                      !retraitPossible
                        ? 'cursor-not-allowed opacity-50 ring-slate-200'
                        : clotureAvecRetrait
                          ? 'cursor-pointer bg-rose-50 ring-rose-300'
                          : 'cursor-pointer ring-slate-200'
                    }`}
                  >
                    <input
                      type="radio"
                      name="choixCloture"
                      className="mt-1"
                      disabled={!retraitPossible}
                      checked={clotureAvecRetrait}
                      onChange={() => setClotureAvecRetrait(true)}
                    />
                    <div className="text-sm">
                      <div className="font-semibold text-slate-900">Avec retrait</div>
                      <div className="text-slate-600">
                        {retraitPossible
                          ? `${formatMontant(et.montantRetirable)} remis au client en espèces (sortie de caisse).`
                          : raisonSansRetrait}
                      </div>
                    </div>
                  </label>
                  <label
                    className={`flex cursor-pointer gap-3 rounded-xl p-3 ring-1 ${
                      !clotureAvecRetrait ? 'bg-brand-50 ring-brand-300' : 'ring-slate-200'
                    }`}
                  >
                    <input
                      type="radio"
                      name="choixCloture"
                      className="mt-1"
                      checked={!clotureAvecRetrait}
                      onChange={() => setClotureAvecRetrait(false)}
                    />
                    <div className="text-sm">
                      <div className="font-semibold text-slate-900">Sans retrait</div>
                      <div className="text-slate-600">
                        {et.retirables > 0
                          ? `${formatMontant(et.montantRetirable)} restent disponibles sur ${et.moisLabel} : retrait ou transfert plus tard. La caisse ne bouge pas.`
                          : 'Aucun mouvement d’argent. La caisse ne bouge pas.'}
                      </div>
                    </div>
                  </label>
                </div>

                <p className="text-xs text-slate-500">
                  Le mois sera clôturé et <strong>{suivant}</strong> deviendra le mois en cours. Pour revenir en
                  arrière, annulez la ligne correspondante dans le journal des transactions.
                </p>
                <div className="flex justify-end gap-2">
                  <button type="button" className="btn-secondary" onClick={() => setClotureSur(null)}>
                    Annuler
                  </button>
                  <button
                    type="submit"
                    className={clotureAvecRetrait ? 'btn-danger' : 'btn-primary'}
                    disabled={clotureEnCours}
                  >
                    <CircleStop className="h-4 w-4" />
                    {clotureEnCours
                      ? 'Clôture…'
                      : clotureAvecRetrait
                        ? 'Clôturer et rembourser'
                        : 'Clôturer sans retrait'}
                  </button>
                </div>
              </form>
            )
          })()}
      </Modale>

      <ModaleTransfert
        ouverte={transfertCycle !== null}
        onFermer={() => setTransfertCycle(null)}
        initial={{ type: 'tontine_compte', carnetId: carnet.id, cycle: transfertCycle ?? undefined }}
      />

      <Modale
        titre={`Supprimer le carnet — ${carnet.numero}`}
        ouverte={modaleSuppression}
        onFermer={() => setModaleSuppression(false)}
      >
        <form onSubmit={validerSuppression} className="space-y-4">
          <p className="text-sm text-slate-600">
            Supprimer définitivement le carnet {carnet.numero} ({LIBELLES_CARNET[carnet.typeCarnet]})
            ?
          </p>
          <div className="rounded-xl bg-rose-50 p-3 text-sm text-rose-900 ring-1 ring-rose-100">
            Les mises, la vente de carnet et les opérations de caisse liées seront retirées. Vous
            pourrez ensuite rouvrir un carnet du même type pour ce client.
            <p className="mt-2 text-xs text-rose-800">
              Impossible si une journée de caisse ou une collecte zone concernée est déjà clôturée.
            </p>
          </div>
          <div>
            <label className="label">
              Pour confirmer, saisissez <span className="font-semibold">je confirme</span>
            </label>
            <input
              className="input"
              autoComplete="off"
              autoFocus
              value={confirmationSuppression}
              onChange={(e) => setConfirmationSuppression(e.target.value)}
              placeholder="je confirme"
            />
          </div>
          {erreurSuppression && <p className="text-sm font-medium text-rose-600">{erreurSuppression}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setModaleSuppression(false)}>
              Annuler
            </button>
            <button
              type="submit"
              className="btn-danger disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
              disabled={!suppressionConfirmee || suppressionEnCours}
            >
              <Trash2 className="h-4 w-4" />
              {suppressionEnCours ? 'Suppression…' : 'Supprimer'}
            </button>
          </div>
        </form>
      </Modale>
    </div>
  )
}
