// Copy for the How it works page (definition and bullet lists).
import type { DefItem } from './DefList'

export const MEASURES: readonly DefItem[] = [
  { term: 'Speech level', def: 'How loud your voice is while you read, in dBFS.' },
  { term: 'Noise floor', def: 'How loud the room is in the 3 s of silence, in dBFS.' },
  { term: 'SNR', def: 'How far your voice sits above the room; 30 dB or more sounds clean.' },
  {
    term: 'Tone balance',
    def: 'Your voice per octave compared with a reference voice, so you see which bands are too strong or too weak.',
  },
  { term: 'Fan and machine tones', def: 'Steady peaks in the silence, such as a fan, a server or an AC unit.' },
  {
    term: 'Voice vs room per band',
    def: 'SNR per octave, so you know where the room covers your voice and where boosting would only raise the noise.',
  },
  { term: 'Sibilance', def: 'How harsh your S sounds are compared with the rest of your voice.' },
  { term: 'Consistency', def: 'How much your level jumps around while you read.' },
]

export const CHAIN: readonly DefItem[] = [
  {
    term: 'ReaFIR — noise reduction',
    def: 'Learns the room from a few seconds of silence and subtracts it; noisy rooms only.',
  },
  {
    term: 'ReaEQ — tone and notches',
    def: 'Evens out your tone balance and cuts narrow notches at fan or machine tones.',
  },
  { term: 'ReaComp — compressor', def: 'Keeps your level steady so quiet words are not lost.' },
  {
    term: 'ReaGate — gate or soft expander',
    def: 'Lowers the room between phrases; in a noisy room it works as a soft expander so it never chops words.',
  },
]

export const ROOM_TIPS: readonly string[] = [
  'Speak closer to the mic: every halving of the distance gives you about 6 dB more voice over the room.',
  "Keep the noise off-axis for your mic's pattern: the back of a cardioid, the sides of a supercardioid.",
  'Switch off fans, AC and other machines while you record when you can.',
  "Don't boost bands where the room is louder than your voice; it only makes the noise louder.",
  'Aim for 30 dB SNR or more.',
]
