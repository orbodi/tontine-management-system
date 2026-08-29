import type { Client, OrigineTontine, Sexe } from '../types'
import { useStore } from '../store'
import { afficherNumeroClient, formatMontant } from '../utils'

export interface FormulaireClient {
  agenceId: string
  zoneId: string
  nom: string
  prenom: string
  telephone: string
  email: string
  sexe: Sexe
  profession: string
  adresse: string
  pieceIdentite: string
  origineTontine: OrigineTontine
}

export const formulaireClientVide: FormulaireClient = {
  agenceId: '',
  zoneId: '',
  nom: '',
  prenom: '',
  telephone: '',
  email: '',
  sexe: 'F',
  profession: '',
  adresse: '',
  pieceIdentite: '',
  origineTontine: 'nouveau',
}

export function ChoixOrigineClient({
  valeur,
  onChange,
}: {
  valeur: OrigineTontine
  onChange: (v: OrigineTontine) => void
}) {
  return (
    <div>
      <label className="label">Type de client *</label>
      <div className="grid grid-cols-2 gap-2">
        <label
          className={`flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2.5 text-sm ${
            valeur === 'nouveau'
              ? 'border-brand-400 bg-brand-50 text-brand-900'
              : 'border-slate-200 bg-white text-slate-700'
          }`}
        >
          <input
            type="radio"
            className="mt-0.5"
            name="origineTontine"
            checked={valeur === 'nouveau'}
            onChange={() => onChange('nouveau')}
          />
          <span>
            <span className="font-medium">Nouveau</span>
            <span className="mt-0.5 block text-xs text-slate-500">
              Carnet, P.C., part sociale et adhésion
            </span>
          </span>
        </label>
        <label
          className={`flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2.5 text-sm ${
            valeur === 'ancien'
              ? 'border-amber-400 bg-amber-50 text-amber-950'
              : 'border-slate-200 bg-white text-slate-700'
          }`}
        >
          <input
            type="radio"
            className="mt-0.5"
            name="origineTontine"
            checked={valeur === 'ancien'}
            onChange={() => onChange('ancien')}
          />
          <span>
            <span className="font-medium">Ancien (papier)</span>
            <span className="mt-0.5 block text-xs text-slate-500">
              Pas de 300 F, P.C. 1er cycle, part sociale ni adhésion
            </span>
          </span>
        </label>
      </div>
      {valeur === 'ancien' && (
        <p className="mt-1.5 text-xs text-amber-800">
          Déjà client sur le papier : pas de vente de carnet, pas de P.C. au premier cycle dans
          l’app, pas de part sociale ni de droit d’adhésion.
        </p>
      )}
    </div>
  )
}

export function RecapFraisOuvertureCompte({
  frais,
}: {
  frais: { partSociale: number; droitAdhesion: number; total: number; offerts: boolean }
}) {
  if (frais.offerts) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
        Client ancien : pas de part sociale ni de droit d’adhésion.
      </div>
    )
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700">
      <p className="font-medium text-slate-900">À encaisser en caisse</p>
      <ul className="mt-2 space-y-1 text-xs">
        <li>
          Part sociale (microfinance) : {formatMontant(frais.partSociale)}
        </li>
        <li>Droit d’adhésion (crédité sur le compte) : {formatMontant(frais.droitAdhesion)}</li>
        <li className="font-semibold text-slate-900">Total : {formatMontant(frais.total)}</li>
      </ul>
    </div>
  )
}

interface Props {
  onFermer: () => void
  clientEnEdition: Client | null
  form: FormulaireClient
  setForm: React.Dispatch<React.SetStateAction<FormulaireClient>>
  erreur: string
  zoneVerrouillee?: boolean
  onSubmit: (e: React.FormEvent) => void
}

export function ModaleClient({
  onFermer,
  clientEnEdition,
  form,
  setForm,
  erreur,
  zoneVerrouillee,
  onSubmit,
}: Props) {
  const { data, estAdmin, employeConnecte } = useStore()

  const champ =
    (cle: keyof FormulaireClient) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [cle]: e.target.value }))

  const agencesDisponibles = data.agences.filter((a) => {
    if (!a.actif) return false
    if (estAdmin) return true
    return a.id === employeConnecte?.agenceId
  })

  const zonesDisponibles = data.zones.filter((z) => {
    if (!z.actif) return false
    if (form.agenceId) return z.agenceId === form.agenceId
    if (estAdmin) return true
    return z.agenceId === employeConnecte?.agenceId
  })

  const zone = data.zones.find((z) => z.id === form.zoneId)
  const zoneOrigine = clientEnEdition
    ? data.zones.find((z) => z.id === clientEnEdition.zoneId)
    : undefined
  const zoneChangee =
    !!clientEnEdition && !!form.zoneId && form.zoneId !== clientEnEdition.zoneId

  const afficherSelecteurs = !zoneVerrouillee || !!clientEnEdition

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {afficherSelecteurs && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Agence *</label>
            <select
              className="input"
              required
              value={form.agenceId}
              onChange={(e) => {
                const agenceId = e.target.value
                const premiereZone =
                  data.zones.find((z) => z.actif && z.agenceId === agenceId)?.id ?? ''
                setForm((f) => ({ ...f, agenceId, zoneId: premiereZone }))
              }}
            >
              <option value="">— Choisir —</option>
              {agencesDisponibles.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nom}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Zone *</label>
            <select
              className="input"
              required
              value={form.zoneId}
              disabled={!form.agenceId}
              onChange={champ('zoneId')}
            >
              <option value="">— Choisir —</option>
              {zonesDisponibles.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.code}
                  {z.nom ? ` — ${z.nom}` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
      {zoneVerrouillee && !clientEnEdition && zone && (
        <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <p>
            Zone :{' '}
            <span className="font-mono font-semibold text-brand-700">
              {zone.code}
              {zone.nom ? ` — ${zone.nom}` : ''}
            </span>{' '}
            (client rattaché à cette zone)
          </p>
        </div>
      )}
      {clientEnEdition && zone && (
        <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 space-y-1">
          <p>
            N° Client :{' '}
            <span className="font-mono font-semibold text-brand-700">
              {afficherNumeroClient(clientEnEdition.codeClient)}
            </span>
            <span className="text-slate-500"> (carnet {clientEnEdition.codeClient})</span>
          </p>
          {zoneChangee && (
            <p className="text-amber-800">
              Transfert {zoneOrigine?.code ?? '—'} → {zone.code} : un nouveau n° client (prochain rang
              de la zone {zone.code}) sera attribué à l’enregistrement. Tous les carnets tontine
              prendront ce numéro.
            </p>
          )}
        </div>
      )}
      <ChoixOrigineClient
        valeur={form.origineTontine}
        onChange={(origineTontine) => setForm((f) => ({ ...f, origineTontine }))}
      />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Prénom *</label>
          <input className="input" required value={form.prenom} onChange={champ('prenom')} />
        </div>
        <div>
          <label className="label">Nom *</label>
          <input className="input" required value={form.nom} onChange={champ('nom')} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Téléphone *</label>
          <input
            className="input"
            required
            value={form.telephone}
            onChange={champ('telephone')}
            placeholder="+225 07 00 00 00 00"
          />
        </div>
        <div>
          <label className="label">Sexe</label>
          <select className="input" value={form.sexe} onChange={champ('sexe')}>
            <option value="F">Femme</option>
            <option value="M">Homme</option>
          </select>
        </div>
      </div>
      <div>
        <label className="label">Pièce d&apos;identité</label>
        <input
          className="input"
          value={form.pieceIdentite}
          onChange={champ('pieceIdentite')}
          placeholder="ex. CNI C123456789"
        />
      </div>
      <div>
        <label className="label">Email</label>
        <input className="input" type="email" value={form.email} onChange={champ('email')} />
      </div>
      <div>
        <label className="label">Profession</label>
        <input className="input" value={form.profession} onChange={champ('profession')} />
      </div>
      <div>
        <label className="label">Adresse</label>
        <input className="input" value={form.adresse} onChange={champ('adresse')} />
      </div>
      {erreur && <p className="text-sm font-medium text-rose-600">{erreur}</p>}
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="btn-secondary" onClick={onFermer}>
          Annuler
        </button>
        <button type="submit" className="btn-primary">
          {clientEnEdition ? 'Enregistrer' : 'Ajouter le client'}
        </button>
      </div>
    </form>
  )
}
