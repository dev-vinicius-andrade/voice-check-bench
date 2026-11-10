// Source strings for the live engine's Msg keys: `live.hint.<key>` (hints.ts) and `live.error.<code>` (LiveError).
// The UI task merges these into src/i18n/locales/{en,pt-BR}/live.json; this file only carries them. Plugin and product
// names (ReaComp, ReaEQ, ReaGate, Wave Link) and ReaEQ band types stay in English in every language.

const N = '{{db, number(maximumFractionDigits: 1)}}'

export const LIVE_ENGINE_STRINGS = {
  en: {
    hint: {
      talkMore: 'Keep reading out loud: we need about a second of your voice before we can suggest anything.',
      noRawSync: "We can't line up the two inputs: check that the raw mic is the same microphone Wave Link uses.",
      rawSilent: 'Your raw mic is silent while you talk: pick the microphone itself (for example Wave XLR) as the raw mic, or choose None.',
      tooLoud: `Your voice is too loud and can distort: turn ReaComp Wet down about ${N} dB.`,
      tooQuiet: `Your voice is too quiet: turn ReaComp Wet up about ${N} dB. If it is already high, raise your mic gain instead.`,
      deadSilence:
        'Your pauses drop to dead silence, so the effects are cutting into your voice: turn the noise removal down a step, or lower the ReaGate Threshold. Pauses should sound quiet, not dead.',
      noiseNotReduced:
        'The room between your words is about as loud as on the raw mic, so the noise removal is barely working: check that it is on in Wave Link, then turn it up a step.',
      stillNoisy: 'You can still hear the room between your words: turn the noise removal up a step, or move a little closer to the mic.',
      toneHigh: {
        boom: `Too much boom: lower the ReaEQ Low Shelf at 150 Hz by about ${N} dB.`,
        warmth: `Your voice sounds thick: lower the ReaEQ Band at 250 Hz by about ${N} dB.`,
        mud: `Your voice sounds muddy or boxy: lower the ReaEQ Band at 450 Hz by about ${N} dB.`,
        presence: `Your voice sounds harsh: lower the ReaEQ Band at 3500 Hz by about ${N} dB.`,
        sibilance: `Your S sounds are sharp: lower the ReaEQ High Shelf at 10 kHz by about ${N} dB.`,
      },
      toneLow: {
        boom: `Your voice lacks bass: raise the ReaEQ Low Shelf at 150 Hz by about ${N} dB.`,
        warmth: `Your voice sounds thin: raise the ReaEQ Band at 250 Hz by about ${N} dB.`,
        mud: `Your voice sounds hollow: raise the ReaEQ Band at 450 Hz by about ${N} dB.`,
        presence: `Your voice sounds dull or far away: raise the ReaEQ Band at 3500 Hz by about ${N} dB.`,
        sibilance: `Your voice lacks crispness: raise the ReaEQ High Shelf at 10 kHz by about ${N} dB.`,
      },
    },
    error: {
      unsupported: "This browser can't listen to two inputs live. Use a recent Chrome, Edge or Firefox.",
      permission: "The browser didn't allow the microphone. Allow it for this page and try again.",
      rawUnavailable: "Your raw mic couldn't be opened. Check that it is plugged in, or use only the Wave Link output.",
      fxUnavailable: "The Wave Link output couldn't be opened. Check that Wave Link is running and pick its output again.",
      sameDevice: 'Both choices are the same input. Pick your raw mic in one and the Wave Link output in the other.',
      other: 'Live listening stopped because of an unexpected error. Try starting again.',
    },
  },
  'pt-BR': {
    hint: {
      talkMore: 'Continue lendo em voz alta: precisamos de mais ou menos um segundo da sua voz antes de sugerir alguma coisa.',
      noRawSync: 'Não conseguimos alinhar as duas entradas: confira se o microfone cru é o mesmo microfone que o Wave Link usa.',
      rawSilent: 'Seu microfone cru está em silêncio enquanto você fala: escolha o próprio microfone (por exemplo Wave XLR) como microfone cru, ou escolha Nenhum.',
      tooLoud: `Sua voz está alta demais e pode distorcer: abaixe o Wet do ReaComp mais ou menos ${N} dB.`,
      tooQuiet: `Sua voz está baixa demais: aumente o Wet do ReaComp mais ou menos ${N} dB. Se ele já estiver alto, aumente o ganho do microfone.`,
      deadSilence:
        'Suas pausas caem para silêncio total, então os efeitos estão cortando sua voz: diminua um nível da remoção de ruído ou abaixe o Threshold do ReaGate. As pausas devem soar baixinhas, não mortas.',
      noiseNotReduced:
        'O ambiente entre suas palavras está quase tão alto quanto no microfone cru, então a remoção de ruído quase não está agindo: confira se ela está ligada no Wave Link e aumente um nível.',
      stillNoisy: 'Ainda dá para ouvir o ambiente entre suas palavras: aumente um nível da remoção de ruído ou chegue um pouco mais perto do microfone.',
      toneHigh: {
        boom: `Grave demais: abaixe o Low Shelf de 150 Hz do ReaEQ mais ou menos ${N} dB.`,
        warmth: `Sua voz está encorpada demais: abaixe a Band de 250 Hz do ReaEQ mais ou menos ${N} dB.`,
        mud: `Sua voz está abafada ou com som de caixa: abaixe a Band de 450 Hz do ReaEQ mais ou menos ${N} dB.`,
        presence: `Sua voz está áspera: abaixe a Band de 3500 Hz do ReaEQ mais ou menos ${N} dB.`,
        sibilance: `Seus sons de S estão cortantes: abaixe o High Shelf de 10 kHz do ReaEQ mais ou menos ${N} dB.`,
      },
      toneLow: {
        boom: `Falta grave na sua voz: aumente o Low Shelf de 150 Hz do ReaEQ mais ou menos ${N} dB.`,
        warmth: `Sua voz está fina: aumente a Band de 250 Hz do ReaEQ mais ou menos ${N} dB.`,
        mud: `Sua voz está oca: aumente a Band de 450 Hz do ReaEQ mais ou menos ${N} dB.`,
        presence: `Sua voz está apagada ou distante: aumente a Band de 3500 Hz do ReaEQ mais ou menos ${N} dB.`,
        sibilance: `Falta brilho na sua voz: aumente o High Shelf de 10 kHz do ReaEQ mais ou menos ${N} dB.`,
      },
    },
    error: {
      unsupported: 'Este navegador não consegue ouvir duas entradas ao vivo. Use um Chrome, Edge ou Firefox recente.',
      permission: 'O navegador não liberou o microfone. Libere o acesso para esta página e tente de novo.',
      rawUnavailable: 'Não deu para abrir seu microfone cru. Confira se ele está conectado ou use só a saída do Wave Link.',
      fxUnavailable: 'Não deu para abrir a saída do Wave Link. Confira se o Wave Link está aberto e escolha a saída dele de novo.',
      sameDevice: 'As duas escolhas são a mesma entrada. Escolha o microfone cru em uma e a saída do Wave Link na outra.',
      other: 'A escuta ao vivo parou por um erro inesperado. Tente começar de novo.',
    },
  },
} as const
