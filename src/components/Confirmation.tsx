import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { CircleAlert, CircleHelp } from 'lucide-react'
import { Modale } from './ui'

export interface OptionsConfirmation {
  titre: string
  message: string
  /** Libellé du bouton de validation (défaut : « Confirmer »). */
  labelValider?: string
  /** Bouton de validation rouge pour les actions destructives. */
  danger?: boolean
  /** Simple message d'information : un seul bouton « OK ». */
  alerte?: boolean
}

interface ConfirmationApi {
  /** Ouvre la modale et résout avec la réponse de l'utilisateur. */
  confirmer: (options: OptionsConfirmation) => Promise<boolean>
  /** Modale d'information avec un seul bouton OK. */
  alerter: (titre: string, message: string) => Promise<void>
}

const ConfirmationContext = createContext<ConfirmationApi | null>(null)

export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<OptionsConfirmation | null>(null)
  const resolveRef = useRef<((valeur: boolean) => void) | null>(null)

  const confirmer = useCallback((opts: OptionsConfirmation) => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve
      setOptions(opts)
    })
  }, [])

  const alerter = useCallback(
    async (titre: string, message: string) => {
      await confirmer({ titre, message, alerte: true })
    },
    [confirmer],
  )

  const repondre = (valeur: boolean) => {
    resolveRef.current?.(valeur)
    resolveRef.current = null
    setOptions(null)
  }

  return (
    <ConfirmationContext.Provider value={{ confirmer, alerter }}>
      {children}
      <Modale titre={options?.titre ?? ''} ouverte={options !== null} onFermer={() => repondre(false)}>
        {options && (
          <div className="space-y-5">
            <div className="flex items-start gap-3">
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                  options.danger ? 'bg-rose-100 text-rose-600' : 'bg-brand-100 text-brand-600'
                }`}
              >
                {options.alerte ? <CircleAlert className="h-5 w-5" /> : <CircleHelp className="h-5 w-5" />}
              </div>
              <p className="whitespace-pre-line pt-2 text-sm text-slate-700">{options.message}</p>
            </div>
            <div className="flex justify-end gap-2">
              {options.alerte ? (
                <button type="button" className="btn-primary" autoFocus onClick={() => repondre(true)}>
                  OK
                </button>
              ) : (
                <>
                  <button type="button" className="btn-secondary" onClick={() => repondre(false)}>
                    Annuler
                  </button>
                  <button
                    type="button"
                    className={options.danger ? 'btn-danger' : 'btn-primary'}
                    autoFocus
                    onClick={() => repondre(true)}
                  >
                    {options.labelValider ?? 'Confirmer'}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </Modale>
    </ConfirmationContext.Provider>
  )
}

export function useConfirmation(): ConfirmationApi {
  const ctx = useContext(ConfirmationContext)
  if (!ctx) throw new Error('useConfirmation doit être utilisé dans <ConfirmationProvider>')
  return ctx
}
