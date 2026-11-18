// Msg builders for desktop.tune.calibrate.* (src/i18n/locales/{en,pt-BR}/desktop.json). Numbers travel as params;
// plugin names and field labels stay English (they come from the exact change line, ../changeMsg.ts).
import type { Msg } from '../../plain/types'

const msg = (key: string, params?: Msg['params']): Msg => (params ? { key: `desktop.tune.calibrate.${key}`, params } : { key: `desktop.tune.calibrate.${key}` })

/** Why the calibration made a change (the "Try this" row of the change): desktop.tune.calibrate.reason.<key>. */
export const calReasonMsg = (key: 'nrOn' | 'strength' | 'firOff' | 'gate' | 'words' | 'pumping' | 'more' | 'less' | 'back', params?: Msg['params']): Msg => msg(`reason.${key}`, params)

/** What the person should do now: desktop.tune.calibrate.do.<key>. */
export const doMsg = (key: 'quiet' | 'quietSet' | 'talk' | 'talkAgain'): Msg => msg(`do.${key}`)

/** Why a phase started over or waits: desktop.tune.calibrate.notice.<key>. */
export const noticeMsg = (key: 'talkedQuiet' | 'talkedSet' | 'noSpeech' | 'gap' | 'cancelled' | 'undone' | 'engineStopped' | 'backedOff'): Msg => msg(`notice.${key}`)

/** A line of the result: desktop.tune.calibrate.note.<key>. */
export const noteMsg = (
  key: 'nothing' | 'alreadySilent' | 'notReached' | 'noHelp' | 'wouldCut' | 'wordsFirst' | 'noiseBetween' | 'moreCuts' | 'morePumps' | 'keptReafir',
  params?: Msg['params'],
): Msg => msg(`note.${key}`, params)
