export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

export function formatMontant(n: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + ' FCFA'
}

export function texteAlerteCompteOuvert(total: number): string {
  if (total <= 0) {
    return 'Compte créé. Aucun frais à encaisser.'
  }
  return `Compte créé. Total encaissé : ${formatMontant(total)}.`
}

export function texteConfirmationOuvertureCompte(total: number): string {
  if (total <= 0) {
    return 'Aucun frais à encaisser. Le compte sera créé.'
  }
  return `Confirmez l’encaissement de ${formatMontant(total)}. Le compte sera créé.`
}

export function texteAlerteDemandeOuverture(
  caissierNom: string,
  frais: { partSociale: number; droitAdhesion: number; total: number },
): string {
  const intro =
    `Demande d’ouverture enregistrée.\n` +
    `Le compte sera créé après validation par ${caissierNom}.\n`
  if (frais.total <= 0) {
    return intro + 'Aucun frais coché : pas d’encaissement à la validation.'
  }
  return (
    intro +
    (frais.partSociale > 0 ? `Part sociale : ${formatMontant(frais.partSociale)}\n` : '') +
    (frais.droitAdhesion > 0 ? `Droit d'adhésion : ${formatMontant(frais.droitAdhesion)}\n` : '') +
    `Total à encaisser : ${formatMontant(frais.total)}`
  )
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function formatDateHeure(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function initiales(nom: string, prenom: string): string {
  return (prenom[0] ?? '') + (nom[0] ?? '')
}

export function pad2(n: number | string): string {
  return String(n).padStart(2, '0')
}

export function pad4(n: number): string {
  return String(n).padStart(4, '0')
}

/** Numéro stocké : n° zone (2) + ordre dans la zone (4). Ex. 010001 */
export function numeroCarnet(codeZone: string, ordreClient: number): string {
  return `${pad2(codeZone)}${pad4(ordreClient)}`
}

/** Affichage N° Client : masque le préfixe zone. Ex. 010001 → 0001 */
export function afficherNumeroClient(codeClient?: string | null): string {
  const digits = (codeClient || '').replace(/\D/g, '')
  if (digits.length >= 4) return digits.slice(-4).padStart(4, '0')
  return codeClient || '—'
}

/** Identifiant client historique (ordre global). Conservé pour compat. */
export function numeroClient(ordre: number): string {
  return pad4(ordre)
}

/** Numéro de compte courant/épargne : B + ordre. Ex. B0001 */
export function numeroCompteSolde(ordre: number): string {
  return `B${pad4(ordre)}`
}

export function numeroCompteCaisse(ordre: number): string {
  return `CAI-${pad4(ordre)}`
}

/** Numéro au format international sans espaces ni signes, pour wa.me */
export function telPourWhatsApp(tel: string): string {
  return tel.replace(/[^0-9]/g, '')
}

/** Export CSV compatible Excel (séparateur ; et BOM UTF-8) */
export function exporterCsv(nomFichier: string, lignes: (string | number)[][]): void {
  const contenu = lignes
    .map((l) =>
      l
        .map((c) => {
          const s = String(c)
          return s.includes(';') || s.includes('"') || s.includes('\n')
            ? `"${s.replace(/"/g, '""')}"`
            : s
        })
        .join(';'),
    )
    .join('\r\n')
  const blob = new Blob(['\uFEFF' + contenu], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nomFichier
  a.click()
  URL.revokeObjectURL(url)
}
