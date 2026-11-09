import { useTranslation } from 'react-i18next'
import { useMicProfile } from '../../store/hooks'
import { addressKey, placementKey } from './micOptions'

/** "Speak into … · Turn the back of the mic …" for the current mic profile, as plain text. */
export function MicTips() {
  const { t } = useTranslation()
  const mic = useMicProfile()
  return <>{`${t(addressKey(mic))} ${t(placementKey(mic))}`}</>
}
