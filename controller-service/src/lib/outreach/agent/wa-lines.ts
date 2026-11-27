import { outreachPool } from '../db'
import type { OutreachLanguage } from '../types'

// WhatsApp lines and the transcript, split out of inbound.ts so the runtime does not import inbound (cycle).

export const OPT_OUT_CONFIRMATION: Record<OutreachLanguage, string> = {
  en: "Done. We won't send you any more WhatsApp messages. Sorry for the trouble.",
  hi: 'ठीक है। अब हम आपको WhatsApp पर कोई संदेश नहीं भेजेंगे। असुविधा के लिए क्षमा करें।',
  ta: 'சரி. இனி உங்களுக்கு WhatsApp-இல் எந்த செய்தியும் அனுப்ப மாட்டோம். சிரமத்திற்கு மன்னிக்கவும்.',
  te: 'సరే. ఇకపై మీకు WhatsApp లో ఎలాంటి సందేశాలు పంపము. అసౌకర్యానికి క్షమించండి.',
  kn: 'ಸರಿ. ಇನ್ನು ಮುಂದೆ ನಿಮಗೆ WhatsApp ನಲ್ಲಿ ಯಾವುದೇ ಸಂದೇಶ ಕಳುಹಿಸುವುದಿಲ್ಲ. ತೊಂದರೆಗಾಗಿ ಕ್ಷಮಿಸಿ.',
  ml: 'ശരി. ഇനി നിങ്ങൾക്ക് WhatsApp-ൽ സന്ദേശങ്ങൾ അയക്കില്ല. ബുദ്ധിമുട്ടിന് ക്ഷമിക്കണം.',
  mr: 'ठीक आहे. यापुढे आम्ही तुम्हाला WhatsApp वर कोणताही संदेश पाठवणार नाही. त्रासाबद्दल क्षमस्व.',
  bn: 'ঠিক আছে। আমরা আর আপনাকে WhatsApp-এ কোনো বার্তা পাঠাব না। অসুবিধার জন্য দুঃখিত।',
  gu: 'બરાબર. હવે અમે તમને WhatsApp પર કોઈ સંદેશ નહીં મોકલીએ. તકલીફ બદલ માફ કરશો.',
}

export const FALLBACK_REPLY = {
  en: 'Thanks, we have your message. Our team will get back to you here shortly.',
  hi: 'धन्यवाद, आपका संदेश मिल गया है। हमारी टीम जल्द ही यहीं आपको जवाब देगी।',
}

export const fallbackLine = (lang: OutreachLanguage): string => (lang === 'hi' ? FALLBACK_REPLY.hi : FALLBACK_REPLY.en)

const HISTORY = 12

export interface TranscriptMessage {
  role: 'user' | 'assistant'
  content: string
}

/** The last 12 WhatsApp messages as chat turns (same-role runs merged), starting with a user turn. */
export async function transcript(contactId: string): Promise<TranscriptMessage[]> {
  const r = await outreachPool().query(
    `SELECT direction, body FROM outreach_messages WHERE contact_id = $1 AND body IS NOT NULL ORDER BY created_at DESC, id DESC LIMIT ${HISTORY}`,
    [contactId]
  )
  const out: TranscriptMessage[] = []
  for (const m of (r.rows as { direction: string; body: string }[]).reverse()) {
    const role = m.direction === 'in' ? 'user' : 'assistant'
    const content = String(m.body).slice(0, 2000)
    const last = out[out.length - 1]
    if (last && last.role === role) last.content += `\n\n${content}`
    else out.push({ role, content })
  }
  while (out.length && out[0].role !== 'user') out.shift()
  return out
}
