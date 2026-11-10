// Item ids for the How it works page lists; copy lives in pages.json under pages.how.*.

/** pages.how.measures.<id>.term / .def */
export const MEASURES = ['speech', 'noise', 'snr', 'tone', 'tones', 'bandSnr', 'sibilance', 'consistency'] as const

/** Plugins of the noisy-room chain, in order; pages.how.chain.<name>.role / .def (plugin names are never translated). */
export const CHAIN = ['ReaFIR', 'ReaEQ', 'ReaComp', 'ReaGate'] as const

/** pages.how.tips.<id> */
export const ROOM_TIPS = ['closer', 'aim', 'off', 'boost', 'target'] as const

/** pages.how.takes.<id> (rich text with <b>). */
export const TAKES = ['raw', 'silence', 'fx'] as const

/** pages.how.apply.<id> (rich text with <b> / <code>). */
export const APPLY = ['hand', 'tool', 'reafir'] as const

/** pages.privacy.local.<id> */
export const PRIVACY_LOCAL = ['takes', 'prefs', 'noUpload', 'delete'] as const

/** pages.home.steps.<id>.title / .sub */
export const HOME_STEPS = ['mic', 'raw', 'fx', 'settings'] as const

/** pages.community.share.<id> */
export const SHARE_STEPS = ['s1', 's2', 's3', 's4', 's5'] as const
/** Element id of the Community page's "How to share" box (the shared-settings empty state scrolls to it). */
export const HOW_TO_SHARE_ID = 'how-to-share'
