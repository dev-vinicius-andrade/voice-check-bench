import type { Take } from '../../types'
import { SaveProfileButton } from './SaveProfileButton'
import { useSaveProfile } from './useSaveProfile'

/** Results entry point: "Save as profile" for A's session (hidden without a suggestion). */
export function SaveProfile({ A }: { A: Take }) {
  const { gate, suggestedName, save } = useSaveProfile(A)
  return gate ? <SaveProfileButton gate={gate} suggestedName={suggestedName} onSave={save} /> : null
}
