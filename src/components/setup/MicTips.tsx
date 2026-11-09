import { addressTip, placementTip } from '../../mics/catalog'
import { useMicProfile } from '../../store/hooks'
import { useMsg } from '../common/MsgText'

/** "Speak into … · Turn the back of the mic …" for the current mic profile, as plain text. */
export function MicTips() {
  const tm = useMsg()
  const mic = useMicProfile()
  return <>{`${tm(addressTip(mic))} ${tm(placementTip(mic))}`}</>
}
