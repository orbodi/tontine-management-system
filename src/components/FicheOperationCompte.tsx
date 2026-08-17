import { LOGO_URL, NOM_APPLICATION, SOUS_TITRE_APPLICATION } from '../config'
import type { TypeCompte } from '../types'
import { formatDateHeure, formatMontant } from '../utils'

const LIBELLES_COMPTE: Record<TypeCompte, string> = {
  courant: 'Compte courant',
  epargne: 'Compte épargne',
}

export type DonneesFicheOperationCompte = {
  type: 'depot' | 'retrait'
  montant: number
  note?: string
  date: string
  numeroCompte: string
  typeCompte: TypeCompte
  soldeAvant: number
  soldeApres: number
  clientNom: string
  clientCode: string
  clientTelephone?: string
  caissierNom: string
  agenceNom?: string
  /** Référence affichée (ex. id mouvement). */
  reference?: string
}

function MoitieFiche({
  data,
  exemplaire,
}: {
  data: DonneesFicheOperationCompte
  exemplaire: 'Client' | 'Caisse'
}) {
  const estDepot = data.type === 'depot'
  return (
    <div className="fiche-moitie flex h-full flex-col border border-slate-400 bg-white p-4 text-slate-900">
      <div className="flex items-start justify-between gap-3 border-b border-slate-300 pb-2">
        <div className="flex items-center gap-2">
          <img
            src={LOGO_URL}
            alt={NOM_APPLICATION}
            className="h-10 w-10 object-contain"
          />
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {SOUS_TITRE_APPLICATION}
            </div>
            <div className="text-sm font-bold leading-tight">{NOM_APPLICATION}</div>
            {data.agenceNom && (
              <div className="text-[11px] text-slate-600">{data.agenceNom}</div>
            )}
          </div>
        </div>
        <div className="text-right">
          <div
            className={`inline-block rounded px-2 py-0.5 text-xs font-bold uppercase ${
              estDepot ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
            }`}
          >
            {estDepot ? 'Dépôt' : 'Retrait'}
          </div>
          <div className="mt-1 text-[11px] font-semibold text-slate-600">
            Exemplaire {exemplaire}
          </div>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
        <div>
          <span className="text-slate-500">Date / heure</span>
          <div className="font-medium">{formatDateHeure(data.date)}</div>
        </div>
        {data.reference && (
          <div>
            <span className="text-slate-500">Réf.</span>
            <div className="font-mono text-[11px] font-medium">{data.reference}</div>
          </div>
        )}
        <div className="col-span-2">
          <span className="text-slate-500">Client</span>
          <div className="font-semibold">
            {data.clientNom}{' '}
            <span className="font-mono text-[11px] font-normal text-slate-600">
              ({data.clientCode})
            </span>
          </div>
          {data.clientTelephone && (
            <div className="text-[11px] text-slate-600">{data.clientTelephone}</div>
          )}
        </div>
        <div>
          <span className="text-slate-500">Compte</span>
          <div className="font-mono font-semibold">{data.numeroCompte}</div>
          <div className="text-[11px] text-slate-600">{LIBELLES_COMPTE[data.typeCompte]}</div>
        </div>
        <div>
          <span className="text-slate-500">Caissier</span>
          <div className="font-medium">{data.caissierNom}</div>
        </div>
      </div>

      <div className="mt-3 rounded border border-slate-300 bg-slate-50 px-3 py-2 text-center">
        <div className="text-[11px] uppercase tracking-wide text-slate-500">
          Montant {estDepot ? 'déposé' : 'retiré'}
        </div>
        <div className={`text-xl font-bold ${estDepot ? 'text-emerald-700' : 'text-rose-700'}`}>
          {estDepot ? '+' : '−'}
          {formatMontant(data.montant)}
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
        <div className="rounded border border-slate-200 px-2 py-1.5">
          <div className="text-[10px] text-slate-500">Solde avant</div>
          <div className="font-semibold">{formatMontant(data.soldeAvant)}</div>
        </div>
        <div className="rounded border border-slate-200 px-2 py-1.5">
          <div className="text-[10px] text-slate-500">Solde après</div>
          <div className="font-semibold">{formatMontant(data.soldeApres)}</div>
        </div>
      </div>

      {data.note && (
        <p className="mt-2 text-[11px] text-slate-600">
          <span className="font-medium text-slate-700">Note :</span> {data.note}
        </p>
      )}

      <div className="mt-auto grid grid-cols-2 gap-6 pt-4">
        <div>
          <div className="mb-8 text-[11px] font-medium text-slate-700">Signature client</div>
          <div className="border-t border-slate-400 pt-1 text-[10px] text-slate-500">
            Nom et signature
          </div>
        </div>
        <div>
          <div className="mb-8 text-[11px] font-medium text-slate-700">Signature caissier</div>
          <div className="border-t border-slate-400 pt-1 text-[10px] text-slate-500">
            Nom et signature
          </div>
        </div>
      </div>
    </div>
  )
}

/** Deux exemplaires identiques sur une page A4 (haut / bas), à découper. */
export function FicheOperationCompteDouble({ data }: { data: DonneesFicheOperationCompte }) {
  return (
    <div className="fiche-page mx-auto bg-white text-slate-900">
      <div className="fiche-moitie-wrap">
        <MoitieFiche data={data} exemplaire="Client" />
      </div>
      <div className="fiche-coupe flex items-center gap-2 px-2 py-0.5 text-[9px] uppercase tracking-widest text-slate-400">
        <span className="h-px flex-1 border-t border-dashed border-slate-400" />
        Découper ici
        <span className="h-px flex-1 border-t border-dashed border-slate-400" />
      </div>
      <div className="fiche-moitie-wrap">
        <MoitieFiche data={data} exemplaire="Caisse" />
      </div>
    </div>
  )
}
