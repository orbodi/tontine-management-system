export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

export function formatMontant(n: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + ' FCFA'
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

/** Numéro de carnet tontine : n° zone (2) + ordre client dans la zone (4). Ex. 010001 */
export function numeroCarnet(codeZone: string, ordreClient: number): string {
  return `${pad2(codeZone)}${pad4(ordreClient)}`
}

/** Identifiant client : numéro d'ordre global sur 4 chiffres. Ex. 0001 */
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
