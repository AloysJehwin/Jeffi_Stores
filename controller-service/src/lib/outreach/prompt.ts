import { LANGUAGES, type OutreachLanguage } from './types'

// The showcase-offer call script (plan §0, §2): persona, system prompt, greeting and every line the controller speaks
// itself (tool replies are spoken verbatim by voice-service, so success is only ever claimed from here, after ok).
// Bump SCRIPT_VERSION on any wording change: consent evidence cites it.
export const SCRIPT_VERSION = 'showcase-offer/2026-11-24.1'

export const isLanguage = (v: unknown): v is OutreachLanguage => LANGUAGES.includes(v as OutreachLanguage)
export const asLanguage = (v: unknown): OutreachLanguage => {
  const base = typeof v === 'string' ? v.split('-')[0].toLowerCase() : ''
  return isLanguage(base) ? base : 'en'
}

export const LANGUAGE_NAMES: Record<OutreachLanguage, { english: string; native: string }> = {
  en: { english: 'English', native: 'English' },
  hi: { english: 'Hindi', native: 'हिन्दी' },
  ta: { english: 'Tamil', native: 'தமிழ்' },
  te: { english: 'Telugu', native: 'తెలుగు' },
  kn: { english: 'Kannada', native: 'ಕನ್ನಡ' },
  ml: { english: 'Malayalam', native: 'മലയാളം' },
  mr: { english: 'Marathi', native: 'मराठी' },
  bn: { english: 'Bengali', native: 'বাংলা' },
  gu: { english: 'Gujarati', native: 'ગુજરાતી' },
}

// A human name per language; the default Bulbul speakers are female voices, and the lines below use feminine forms.
export const PERSONA_NAMES: Record<OutreachLanguage, string> = {
  en: 'Priya',
  hi: 'Priya',
  ta: 'Kavya',
  te: 'Sravani',
  kn: 'Divya',
  ml: 'Anjali',
  mr: 'Sneha',
  bn: 'Riya',
  gu: 'Hetal',
}

export interface Who {
  business: string
  owner?: string | null
}

export interface Lines {
  greeting: (name: string, who: Who) => string
  greetingAgain: (name: string) => string
  pitch: (business: string) => string
  consentAsk: string
  aiAnswer: string
  previewSent: string
  consentNeeded: string
  failedSoft: string
  changeDone: string
  changeFailed: string
  publishNeedsConsent: string
  published: string
  publishedNoLinks: string
  publishFailed: string
  callback: (when: string) => string
  callbackCapped: string
  callbackAskTime: string
  notInterested: string
  wrongNumber: string
  optedOut: string
  switching: string
  apologyWhatsApp: string
  apologyCallBack: string
}

export const LINES: Record<OutreachLanguage, Lines> = {
  en: {
    greeting: (n, w) => `Hello! This is ${n} from Jeffi Stores. This call may be recorded so we get your details right. ${w.owner ? `Am I speaking with ${w.owner} from ${w.business}?` : `Is this ${w.business}?`}`,
    greetingAgain: n => `Hello again! This is ${n} from Jeffi Stores. This call may be recorded so we get your details right. Is now a good time to continue?`,
    pitch: b => `We make free websites for local businesses. I can build one for ${b} right now, while we talk, and send you a link to see it. Would you like that?`,
    consentAsk: 'Can I send the link to this number on WhatsApp?',
    aiAnswer: "I'm Jeffi Stores' AI assistant.",
    previewSent: "Done! I've sent the preview link to your WhatsApp. It will fill in as we talk.",
    consentNeeded: 'To show you your site, I need to send the link on WhatsApp. Is it okay to send it to this number?',
    failedSoft: "Sorry, that didn't go through on my side just now. Let's carry on.",
    changeDone: "Done, the change is going onto your preview now. Anything else you'd like to change?",
    changeFailed: "Sorry, I couldn't make that change just now. Our team will fix it for you.",
    publishNeedsConsent: 'To make it live, I need to send you the links on WhatsApp. May I send them to this number?',
    published: "Your website is live! I've sent the live link, and a link to make it yours, on WhatsApp. Your seven-day free trial starts today.",
    publishedNoLinks: 'Your website is live! Our team will send you the links on WhatsApp. Your seven-day free trial starts today.',
    publishFailed: "Sorry, I couldn't make it live just now. Our team will finish it and message you.",
    callback: t => `Sure, I'll call you back on ${t}. Thank you, bye!`,
    callbackCapped: "Sorry, I can't book another call. You're welcome to message us on WhatsApp anytime. Thank you, bye!",
    callbackAskTime: 'What time would suit you for a call back?',
    notInterested: 'No problem at all. Thank you for your time, have a nice day!',
    wrongNumber: 'Sorry for the trouble. Have a nice day!',
    optedOut: "Understood, we won't call you again. Sorry for the trouble. Goodbye.",
    switching: "Sure, I'll call you right back in English.",
    apologyWhatsApp: "Sorry, the line's breaking up. I'll message you on WhatsApp.",
    apologyCallBack: "Sorry, the line's breaking up. We'll call you back later.",
  },
  hi: {
    greeting: (n, w) => `नमस्ते! मैं Jeffi Stores से ${n} बोल रही हूँ। यह कॉल रिकॉर्ड हो सकती है ताकि आपकी जानकारी सही रहे। ${w.owner ? `क्या मेरी बात ${w.business} के ${w.owner} जी से हो रही है?` : `क्या मेरी बात ${w.business} से हो रही है?`}`,
    greetingAgain: n => `नमस्ते, फिर से! मैं Jeffi Stores से ${n} बोल रही हूँ। यह कॉल रिकॉर्ड हो सकती है ताकि आपकी जानकारी सही रहे। क्या अभी आगे बात कर सकते हैं?`,
    pitch: b => `हम लोकल बिज़नेस के लिए फ्री वेबसाइट बनाते हैं। मैं अभी बात करते-करते ${b} की वेबसाइट बना सकती हूँ और आपको देखने के लिए लिंक भेज सकती हूँ। क्या आप चाहेंगे?`,
    consentAsk: 'क्या मैं इस नंबर पर WhatsApp पर लिंक भेज दूँ?',
    aiAnswer: 'मैं Jeffi Stores की AI असिस्टेंट हूँ।',
    previewSent: 'हो गया! मैंने प्रीव्यू लिंक आपके WhatsApp पर भेज दिया है। जैसे-जैसे हम बात करेंगे, वेबसाइट भरती जाएगी।',
    consentNeeded: 'आपको वेबसाइट दिखाने के लिए मुझे WhatsApp पर लिंक भेजना होगा। क्या मैं इस नंबर पर भेज दूँ?',
    failedSoft: 'माफ़ कीजिए, अभी मेरी तरफ़ से यह नहीं हो पाया। चलिए आगे बढ़ते हैं।',
    changeDone: 'हो गया, बदलाव आपके प्रीव्यू पर आ रहा है। और कुछ बदलना है?',
    changeFailed: 'माफ़ कीजिए, अभी यह बदलाव नहीं हो पाया। हमारी टीम इसे ठीक कर देगी।',
    publishNeedsConsent: 'वेबसाइट लाइव करने के लिए मुझे लिंक WhatsApp पर भेजने होंगे। क्या मैं इस नंबर पर भेज दूँ?',
    published: 'आपकी वेबसाइट लाइव हो गई है! मैंने लाइव लिंक और उसे अपने नाम करने का लिंक WhatsApp पर भेज दिया है। आपका सात दिन का फ्री ट्रायल आज से शुरू है।',
    publishedNoLinks: 'आपकी वेबसाइट लाइव हो गई है! हमारी टीम आपको लिंक WhatsApp पर भेज देगी। आपका सात दिन का फ्री ट्रायल आज से शुरू है।',
    publishFailed: 'माफ़ कीजिए, अभी वेबसाइट लाइव नहीं हो पाई। हमारी टीम इसे पूरा करके आपको मैसेज करेगी।',
    callback: t => `ज़रूर, मैं आपको ${t} वापस कॉल करूँगी। धन्यवाद!`,
    callbackCapped: 'माफ़ कीजिए, मैं और कॉल बुक नहीं कर सकती। आप कभी भी हमें WhatsApp पर मैसेज कर सकते हैं। धन्यवाद!',
    callbackAskTime: 'आपको किस समय वापस कॉल करूँ?',
    notInterested: 'कोई बात नहीं। आपके समय के लिए धन्यवाद, आपका दिन शुभ हो!',
    wrongNumber: 'तकलीफ़ के लिए माफ़ कीजिए। आपका दिन शुभ हो!',
    optedOut: 'समझ गई, हम आपको दोबारा कॉल नहीं करेंगे। तकलीफ़ के लिए माफ़ी। नमस्ते।',
    switching: 'ज़रूर, मैं अभी आपको हिंदी में वापस कॉल करती हूँ।',
    apologyWhatsApp: 'माफ़ कीजिए, लाइन कट रही है। मैं आपको WhatsApp पर मैसेज करती हूँ।',
    apologyCallBack: 'माफ़ कीजिए, लाइन कट रही है। हम आपको बाद में कॉल करेंगे।',
  },
  ta: {
    greeting: (n, w) => `வணக்கம்! நான் Jeffi Stores-லிருந்து ${n} பேசுகிறேன். உங்கள் விவரங்கள் சரியாக இருக்க இந்த கால் ரெக்கார்ட் செய்யப்படலாம். ${w.owner ? `${w.business}-லிருந்து ${w.owner} பேசுகிறீர்களா?` : `${w.business}-லிருந்து பேசுகிறீர்களா?`}`,
    greetingAgain: n => `மீண்டும் வணக்கம்! நான் Jeffi Stores-லிருந்து ${n} பேசுகிறேன். உங்கள் விவரங்கள் சரியாக இருக்க இந்த கால் ரெக்கார்ட் செய்யப்படலாம். இப்போது தொடரலாமா?`,
    pitch: b => `நாங்கள் உள்ளூர் கடைகளுக்கு இலவச வெப்சைட் செய்து தருகிறோம். நாம் பேசிக்கொண்டிருக்கும்போதே ${b}-க்கு ஒரு வெப்சைட் செய்து, பார்க்க லிங்க் அனுப்ப முடியும். உங்களுக்கு வேண்டுமா?`,
    consentAsk: 'இந்த நம்பருக்கு WhatsApp-ல் லிங்க் அனுப்பலாமா?',
    aiAnswer: 'நான் Jeffi Stores-ன் AI அசிஸ்டன்ட்.',
    previewSent: 'முடிந்தது! ப்ரிவியூ லிங்கை உங்கள் WhatsApp-க்கு அனுப்பிவிட்டேன். நாம் பேசப் பேச அது நிரம்பும்.',
    consentNeeded: 'உங்கள் வெப்சைட்டைக் காட்ட WhatsApp-ல் லிங்க் அனுப்ப வேண்டும். இந்த நம்பருக்கு அனுப்பலாமா?',
    failedSoft: 'மன்னிக்கவும், இப்போது என் பக்கத்தில் அது நடக்கவில்லை. தொடரலாம்.',
    changeDone: 'முடிந்தது, மாற்றம் உங்கள் ப்ரிவியூவில் வருகிறது. வேறு ஏதாவது மாற்ற வேண்டுமா?',
    changeFailed: 'மன்னிக்கவும், இப்போது அந்த மாற்றத்தைச் செய்ய முடியவில்லை. எங்கள் குழு அதைச் சரி செய்யும்.',
    publishNeedsConsent: 'வெப்சைட்டை லைவ் செய்ய லிங்குகளை WhatsApp-ல் அனுப்ப வேண்டும். இந்த நம்பருக்கு அனுப்பலாமா?',
    published: 'உங்கள் வெப்சைட் லைவ் ஆகிவிட்டது! லைவ் லிங்கையும், அதை உங்களுடையதாக்கும் லிங்கையும் WhatsApp-ல் அனுப்பியிருக்கிறேன். உங்கள் ஏழு நாள் இலவச ட்ரையல் இன்று தொடங்குகிறது.',
    publishedNoLinks: 'உங்கள் வெப்சைட் லைவ் ஆகிவிட்டது! எங்கள் குழு லிங்குகளை WhatsApp-ல் அனுப்பும். உங்கள் ஏழு நாள் இலவச ட்ரையல் இன்று தொடங்குகிறது.',
    publishFailed: 'மன்னிக்கவும், இப்போது லைவ் செய்ய முடியவில்லை. எங்கள் குழு அதை முடித்து உங்களுக்கு மெசேஜ் செய்யும்.',
    callback: t => `சரி, ${t} உங்களை மீண்டும் அழைக்கிறேன். நன்றி!`,
    callbackCapped: 'மன்னிக்கவும், இன்னொரு கால் புக் செய்ய முடியாது. எப்போது வேண்டுமானாலும் WhatsApp-ல் எங்களுக்கு மெசேஜ் செய்யலாம். நன்றி!',
    callbackAskTime: 'எந்த நேரத்தில் மீண்டும் அழைக்கட்டும்?',
    notInterested: 'பரவாயில்லை. உங்கள் நேரத்திற்கு நன்றி, நல்ல நாளாக அமையட்டும்!',
    wrongNumber: 'தொந்தரவுக்கு மன்னிக்கவும். நல்ல நாளாக அமையட்டும்!',
    optedOut: 'புரிந்தது, இனி உங்களை அழைக்க மாட்டோம். தொந்தரவுக்கு மன்னிக்கவும். வணக்கம்.',
    switching: 'சரி, இப்போதே தமிழில் மீண்டும் அழைக்கிறேன்.',
    apologyWhatsApp: 'மன்னிக்கவும், லைன் சரியாக இல்லை. நான் உங்களுக்கு WhatsApp-ல் மெசேஜ் அனுப்புகிறேன்.',
    apologyCallBack: 'மன்னிக்கவும், லைன் சரியாக இல்லை. பிறகு உங்களை மீண்டும் அழைக்கிறோம்.',
  },
  te: {
    greeting: (n, w) => `నమస్తే! నేను Jeffi Stores నుండి ${n} మాట్లాడుతున్నాను. మీ వివరాలు సరిగ్గా ఉండేందుకు ఈ కాల్ రికార్డ్ కావచ్చు. ${w.owner ? `${w.business} నుండి ${w.owner} గారు మాట్లాడుతున్నారా?` : `${w.business} నుండి మాట్లాడుతున్నారా?`}`,
    greetingAgain: n => `మళ్ళీ నమస్తే! నేను Jeffi Stores నుండి ${n} మాట్లాడుతున్నాను. మీ వివరాలు సరిగ్గా ఉండేందుకు ఈ కాల్ రికార్డ్ కావచ్చు. ఇప్పుడు కొనసాగిద్దామా?`,
    pitch: b => `మేము లోకల్ బిజినెస్‌లకు ఫ్రీ వెబ్‌సైట్ చేసి ఇస్తాం. మనం మాట్లాడుతుండగానే ${b} కోసం ఒక వెబ్‌సైట్ చేసి, చూడటానికి లింక్ పంపగలను. మీకు కావాలా?`,
    consentAsk: 'ఈ నంబర్‌కి WhatsApp లో లింక్ పంపమంటారా?',
    aiAnswer: 'నేను Jeffi Stores AI అసిస్టెంట్‌ని.',
    previewSent: 'అయిపోయింది! ప్రివ్యూ లింక్ మీ WhatsApp కి పంపాను. మనం మాట్లాడుతున్న కొద్దీ అది నిండుతుంది.',
    consentNeeded: 'మీ వెబ్‌సైట్ చూపించడానికి WhatsApp లో లింక్ పంపాలి. ఈ నంబర్‌కి పంపమంటారా?',
    failedSoft: 'క్షమించండి, ఇప్పుడు నా వైపు నుండి అది జరగలేదు. కొనసాగిద్దాం.',
    changeDone: 'అయిపోయింది, మార్పు మీ ప్రివ్యూలో వస్తోంది. ఇంకేమైనా మార్చాలా?',
    changeFailed: 'క్షమించండి, ఇప్పుడు ఆ మార్పు చేయలేకపోయాను. మా టీమ్ దాన్ని సరిచేస్తుంది.',
    publishNeedsConsent: 'వెబ్‌సైట్ లైవ్ చేయడానికి లింక్‌లు WhatsApp లో పంపాలి. ఈ నంబర్‌కి పంపమంటారా?',
    published: 'మీ వెబ్‌సైట్ లైవ్ అయింది! లైవ్ లింక్, దాన్ని మీ సొంతం చేసుకునే లింక్ WhatsApp లో పంపాను. మీ ఏడు రోజుల ఫ్రీ ట్రయల్ ఈ రోజు మొదలవుతుంది.',
    publishedNoLinks: 'మీ వెబ్‌సైట్ లైవ్ అయింది! మా టీమ్ లింక్‌లు WhatsApp లో పంపుతుంది. మీ ఏడు రోజుల ఫ్రీ ట్రయల్ ఈ రోజు మొదలవుతుంది.',
    publishFailed: 'క్షమించండి, ఇప్పుడు లైవ్ చేయలేకపోయాను. మా టీమ్ పూర్తి చేసి మీకు మెసేజ్ చేస్తుంది.',
    callback: t => `సరే, ${t} మీకు మళ్ళీ కాల్ చేస్తాను. ధన్యవాదాలు!`,
    callbackCapped: 'క్షమించండి, ఇంకో కాల్ బుక్ చేయలేను. ఎప్పుడైనా మాకు WhatsApp లో మెసేజ్ చేయవచ్చు. ధన్యవాదాలు!',
    callbackAskTime: 'ఏ సమయంలో మళ్ళీ కాల్ చేయమంటారు?',
    notInterested: 'పర్వాలేదు. మీ సమయానికి ధన్యవాదాలు, మంచి రోజు!',
    wrongNumber: 'ఇబ్బందికి క్షమించండి. మంచి రోజు!',
    optedOut: 'అర్థమైంది, ఇక మీకు కాల్ చేయం. ఇబ్బందికి క్షమించండి. నమస్తే.',
    switching: 'సరే, ఇప్పుడే తెలుగులో మళ్ళీ కాల్ చేస్తాను.',
    apologyWhatsApp: 'క్షమించండి, లైన్ సరిగ్గా లేదు. నేను మీకు WhatsApp లో మెసేజ్ చేస్తాను.',
    apologyCallBack: 'క్షమించండి, లైన్ సరిగ్గా లేదు. తర్వాత మళ్ళీ కాల్ చేస్తాం.',
  },
  kn: {
    greeting: (n, w) => `ನಮಸ್ಕಾರ! ನಾನು Jeffi Stores ಇಂದ ${n} ಮಾತಾಡ್ತಿದ್ದೀನಿ. ನಿಮ್ಮ ವಿವರಗಳು ಸರಿಯಾಗಿರಲು ಈ ಕಾಲ್ ರೆಕಾರ್ಡ್ ಆಗಬಹುದು. ${w.owner ? `${w.business} ಇಂದ ${w.owner} ಅವರು ಮಾತಾಡ್ತಿದ್ದೀರಾ?` : `${w.business} ಇಂದ ಮಾತಾಡ್ತಿದ್ದೀರಾ?`}`,
    greetingAgain: n => `ಮತ್ತೆ ನಮಸ್ಕಾರ! ನಾನು Jeffi Stores ಇಂದ ${n} ಮಾತಾಡ್ತಿದ್ದೀನಿ. ನಿಮ್ಮ ವಿವರಗಳು ಸರಿಯಾಗಿರಲು ಈ ಕಾಲ್ ರೆಕಾರ್ಡ್ ಆಗಬಹುದು. ಈಗ ಮುಂದುವರಿಸೋಣವಾ?`,
    pitch: b => `ನಾವು ಲೋಕಲ್ ಬಿಸಿನೆಸ್‌ಗಳಿಗೆ ಫ್ರೀ ವೆಬ್‌ಸೈಟ್ ಮಾಡಿಕೊಡುತ್ತೇವೆ. ನಾವು ಮಾತಾಡ್ತಿರುವಾಗಲೇ ${b}ಗೆ ಒಂದು ವೆಬ್‌ಸೈಟ್ ಮಾಡಿ, ನೋಡಲು ಲಿಂಕ್ ಕಳಿಸಬಹುದು. ಬೇಕಾ?`,
    consentAsk: 'ಈ ನಂಬರ್‌ಗೆ WhatsApp ನಲ್ಲಿ ಲಿಂಕ್ ಕಳಿಸಲಾ?',
    aiAnswer: 'ನಾನು Jeffi Stores ನ AI ಅಸಿಸ್ಟೆಂಟ್.',
    previewSent: 'ಆಯ್ತು! ಪ್ರಿವ್ಯೂ ಲಿಂಕ್ ನಿಮ್ಮ WhatsApp ಗೆ ಕಳಿಸಿದ್ದೀನಿ. ನಾವು ಮಾತಾಡ್ತಾ ಹೋದಂತೆ ಅದು ತುಂಬುತ್ತದೆ.',
    consentNeeded: 'ನಿಮ್ಮ ವೆಬ್‌ಸೈಟ್ ತೋರಿಸಲು WhatsApp ನಲ್ಲಿ ಲಿಂಕ್ ಕಳಿಸಬೇಕು. ಈ ನಂಬರ್‌ಗೆ ಕಳಿಸಲಾ?',
    failedSoft: 'ಕ್ಷಮಿಸಿ, ಈಗ ನನ್ನ ಕಡೆಯಿಂದ ಅದು ಆಗಲಿಲ್ಲ. ಮುಂದುವರಿಯೋಣ.',
    changeDone: 'ಆಯ್ತು, ಬದಲಾವಣೆ ನಿಮ್ಮ ಪ್ರಿವ್ಯೂನಲ್ಲಿ ಬರ್ತಿದೆ. ಇನ್ನೇನಾದರೂ ಬದಲಾಯಿಸಬೇಕಾ?',
    changeFailed: 'ಕ್ಷಮಿಸಿ, ಈಗ ಆ ಬದಲಾವಣೆ ಮಾಡಲು ಆಗಲಿಲ್ಲ. ನಮ್ಮ ಟೀಮ್ ಅದನ್ನು ಸರಿಪಡಿಸುತ್ತದೆ.',
    publishNeedsConsent: 'ವೆಬ್‌ಸೈಟ್ ಲೈವ್ ಮಾಡಲು ಲಿಂಕ್‌ಗಳನ್ನು WhatsApp ನಲ್ಲಿ ಕಳಿಸಬೇಕು. ಈ ನಂಬರ್‌ಗೆ ಕಳಿಸಲಾ?',
    published: 'ನಿಮ್ಮ ವೆಬ್‌ಸೈಟ್ ಲೈವ್ ಆಗಿದೆ! ಲೈವ್ ಲಿಂಕ್ ಮತ್ತು ಅದನ್ನು ನಿಮ್ಮದಾಗಿಸಿಕೊಳ್ಳುವ ಲಿಂಕ್ ಅನ್ನು WhatsApp ನಲ್ಲಿ ಕಳಿಸಿದ್ದೀನಿ. ನಿಮ್ಮ ಏಳು ದಿನದ ಫ್ರೀ ಟ್ರಯಲ್ ಇವತ್ತು ಶುರು.',
    publishedNoLinks: 'ನಿಮ್ಮ ವೆಬ್‌ಸೈಟ್ ಲೈವ್ ಆಗಿದೆ! ನಮ್ಮ ಟೀಮ್ ಲಿಂಕ್‌ಗಳನ್ನು WhatsApp ನಲ್ಲಿ ಕಳಿಸುತ್ತದೆ. ನಿಮ್ಮ ಏಳು ದಿನದ ಫ್ರೀ ಟ್ರಯಲ್ ಇವತ್ತು ಶುರು.',
    publishFailed: 'ಕ್ಷಮಿಸಿ, ಈಗ ಲೈವ್ ಮಾಡಲು ಆಗಲಿಲ್ಲ. ನಮ್ಮ ಟೀಮ್ ಅದನ್ನು ಮುಗಿಸಿ ನಿಮಗೆ ಮೆಸೇಜ್ ಮಾಡುತ್ತದೆ.',
    callback: t => `ಸರಿ, ${t} ನಿಮಗೆ ಮತ್ತೆ ಕಾಲ್ ಮಾಡ್ತೀನಿ. ಧನ್ಯವಾದ!`,
    callbackCapped: 'ಕ್ಷಮಿಸಿ, ಇನ್ನೊಂದು ಕಾಲ್ ಬುಕ್ ಮಾಡಲು ಆಗುವುದಿಲ್ಲ. ಯಾವಾಗ ಬೇಕಾದರೂ WhatsApp ನಲ್ಲಿ ನಮಗೆ ಮೆಸೇಜ್ ಮಾಡಬಹುದು. ಧನ್ಯವಾದ!',
    callbackAskTime: 'ಯಾವ ಸಮಯಕ್ಕೆ ಮತ್ತೆ ಕಾಲ್ ಮಾಡಲಿ?',
    notInterested: 'ಪರವಾಗಿಲ್ಲ. ನಿಮ್ಮ ಸಮಯಕ್ಕೆ ಧನ್ಯವಾದ, ಒಳ್ಳೆಯ ದಿನ!',
    wrongNumber: 'ತೊಂದರೆಗೆ ಕ್ಷಮಿಸಿ. ಒಳ್ಳೆಯ ದಿನ!',
    optedOut: 'ಅರ್ಥ ಆಯ್ತು, ಇನ್ನು ಮುಂದೆ ನಿಮಗೆ ಕಾಲ್ ಮಾಡುವುದಿಲ್ಲ. ತೊಂದರೆಗೆ ಕ್ಷಮಿಸಿ. ನಮಸ್ಕಾರ.',
    switching: 'ಸರಿ, ಈಗಲೇ ಕನ್ನಡದಲ್ಲಿ ಮತ್ತೆ ಕಾಲ್ ಮಾಡ್ತೀನಿ.',
    apologyWhatsApp: 'ಕ್ಷಮಿಸಿ, ಲೈನ್ ಸರಿಯಾಗಿಲ್ಲ. ನಾನು ನಿಮಗೆ WhatsApp ನಲ್ಲಿ ಮೆಸೇಜ್ ಮಾಡುತ್ತೇನೆ.',
    apologyCallBack: 'ಕ್ಷಮಿಸಿ, ಲೈನ್ ಸರಿಯಾಗಿಲ್ಲ. ನಂತರ ಮತ್ತೆ ಕಾಲ್ ಮಾಡುತ್ತೇವೆ.',
  },
  ml: {
    greeting: (n, w) => `നമസ്കാരം! ഞാൻ Jeffi Stores-ൽ നിന്ന് ${n} ആണ് സംസാരിക്കുന്നത്. നിങ്ങളുടെ വിവരങ്ങൾ ശരിയാകാൻ ഈ കോൾ റെക്കോർഡ് ചെയ്തേക്കാം. ${w.owner ? `${w.business}-ൽ നിന്ന് ${w.owner} ആണോ സംസാരിക്കുന്നത്?` : `${w.business}-ൽ നിന്നാണോ സംസാരിക്കുന്നത്?`}`,
    greetingAgain: n => `വീണ്ടും നമസ്കാരം! ഞാൻ Jeffi Stores-ൽ നിന്ന് ${n} ആണ്. നിങ്ങളുടെ വിവരങ്ങൾ ശരിയാകാൻ ഈ കോൾ റെക്കോർഡ് ചെയ്തേക്കാം. ഇപ്പോൾ തുടരാമോ?`,
    pitch: b => `ഞങ്ങൾ ലോക്കൽ ബിസിനസുകൾക്ക് ഫ്രീ വെബ്സൈറ്റ് ഉണ്ടാക്കി കൊടുക്കുന്നു. നമ്മൾ സംസാരിക്കുമ്പോൾ തന്നെ ${b}-ന് ഒരു വെബ്സൈറ്റ് ഉണ്ടാക്കി, കാണാൻ ലിങ്ക് അയക്കാം. വേണോ?`,
    consentAsk: 'ഈ നമ്പറിലേക്ക് WhatsApp-ൽ ലിങ്ക് അയക്കട്ടെ?',
    aiAnswer: 'ഞാൻ Jeffi Stores-ന്റെ AI അസിസ്റ്റന്റ് ആണ്.',
    previewSent: 'കഴിഞ്ഞു! പ്രിവ്യൂ ലിങ്ക് നിങ്ങളുടെ WhatsApp-ലേക്ക് അയച്ചിട്ടുണ്ട്. നമ്മൾ സംസാരിക്കുന്നതിനനുസരിച്ച് അത് നിറയും.',
    consentNeeded: 'നിങ്ങളുടെ വെബ്സൈറ്റ് കാണിക്കാൻ WhatsApp-ൽ ലിങ്ക് അയക്കണം. ഈ നമ്പറിലേക്ക് അയക്കട്ടെ?',
    failedSoft: 'ക്ഷമിക്കണം, ഇപ്പോൾ എന്റെ ഭാഗത്ത് നിന്ന് അത് നടന്നില്ല. നമുക്ക് തുടരാം.',
    changeDone: 'കഴിഞ്ഞു, മാറ്റം നിങ്ങളുടെ പ്രിവ്യൂവിൽ വരുന്നുണ്ട്. വേറെ എന്തെങ്കിലും മാറ്റണോ?',
    changeFailed: 'ക്ഷമിക്കണം, ഇപ്പോൾ ആ മാറ്റം ചെയ്യാൻ പറ്റിയില്ല. ഞങ്ങളുടെ ടീം അത് ശരിയാക്കും.',
    publishNeedsConsent: 'വെബ്സൈറ്റ് ലൈവ് ആക്കാൻ ലിങ്കുകൾ WhatsApp-ൽ അയക്കണം. ഈ നമ്പറിലേക്ക് അയക്കട്ടെ?',
    published: 'നിങ്ങളുടെ വെബ്സൈറ്റ് ലൈവ് ആയി! ലൈവ് ലിങ്കും അത് നിങ്ങളുടേതാക്കാനുള്ള ലിങ്കും WhatsApp-ൽ അയച്ചിട്ടുണ്ട്. നിങ്ങളുടെ ഏഴ് ദിവസത്തെ ഫ്രീ ട്രയൽ ഇന്ന് തുടങ്ങുന്നു.',
    publishedNoLinks: 'നിങ്ങളുടെ വെബ്സൈറ്റ് ലൈവ് ആയി! ഞങ്ങളുടെ ടീം ലിങ്കുകൾ WhatsApp-ൽ അയക്കും. നിങ്ങളുടെ ഏഴ് ദിവസത്തെ ഫ്രീ ട്രയൽ ഇന്ന് തുടങ്ങുന്നു.',
    publishFailed: 'ക്ഷമിക്കണം, ഇപ്പോൾ ലൈവ് ആക്കാൻ പറ്റിയില്ല. ഞങ്ങളുടെ ടീം അത് പൂർത്തിയാക്കി നിങ്ങൾക്ക് മെസേജ് ചെയ്യും.',
    callback: t => `ശരി, ${t} ഞാൻ തിരിച്ചു വിളിക്കാം. നന്ദി!`,
    callbackCapped: 'ക്ഷമിക്കണം, ഇനി ഒരു കോൾ ബുക്ക് ചെയ്യാൻ പറ്റില്ല. എപ്പോൾ വേണമെങ്കിലും WhatsApp-ൽ ഞങ്ങൾക്ക് മെസേജ് ചെയ്യാം. നന്ദി!',
    callbackAskTime: 'ഏത് സമയത്ത് തിരിച്ചു വിളിക്കണം?',
    notInterested: 'കുഴപ്പമില്ല. നിങ്ങളുടെ സമയത്തിന് നന്ദി, നല്ലൊരു ദിവസം ആശംസിക്കുന്നു!',
    wrongNumber: 'ബുദ്ധിമുട്ടിച്ചതിന് ക്ഷമിക്കണം. നല്ലൊരു ദിവസം!',
    optedOut: 'മനസ്സിലായി, ഇനി നിങ്ങളെ വിളിക്കില്ല. ബുദ്ധിമുട്ടിച്ചതിന് ക്ഷമിക്കണം. നമസ്കാരം.',
    switching: 'ശരി, ഇപ്പോൾ തന്നെ മലയാളത്തിൽ തിരിച്ചു വിളിക്കാം.',
    apologyWhatsApp: 'ക്ഷമിക്കണം, ലൈൻ ശരിയല്ല. ഞാൻ നിങ്ങൾക്ക് WhatsApp-ൽ മെസേജ് അയക്കാം.',
    apologyCallBack: 'ക്ഷമിക്കണം, ലൈൻ ശരിയല്ല. പിന്നീട് തിരിച്ചു വിളിക്കാം.',
  },
  mr: {
    greeting: (n, w) => `नमस्कार! मी Jeffi Stores मधून ${n} बोलतेय. तुमची माहिती बरोबर राहावी म्हणून हा कॉल रेकॉर्ड होऊ शकतो. ${w.owner ? `${w.business} मधून ${w.owner} बोलताय का?` : `${w.business} मधून बोलताय का?`}`,
    greetingAgain: n => `पुन्हा नमस्कार! मी Jeffi Stores मधून ${n} बोलतेय. तुमची माहिती बरोबर राहावी म्हणून हा कॉल रेकॉर्ड होऊ शकतो. आता पुढे बोलूया का?`,
    pitch: b => `आम्ही लोकल बिझनेससाठी फ्री वेबसाइट बनवतो. आपण बोलत असतानाच मी ${b} ची वेबसाइट बनवून बघण्यासाठी लिंक पाठवू शकते. हवी आहे का?`,
    consentAsk: 'या नंबरवर WhatsApp वर लिंक पाठवू का?',
    aiAnswer: 'मी Jeffi Stores ची AI असिस्टंट आहे.',
    previewSent: 'झालं! प्रीव्ह्यू लिंक तुमच्या WhatsApp वर पाठवली आहे. आपण बोलू तशी ती भरत जाईल.',
    consentNeeded: 'तुमची वेबसाइट दाखवण्यासाठी WhatsApp वर लिंक पाठवावी लागेल. या नंबरवर पाठवू का?',
    failedSoft: 'माफ करा, आत्ता माझ्याकडून ते झालं नाही. पुढे जाऊया.',
    changeDone: 'झालं, बदल तुमच्या प्रीव्ह्यूवर येतोय. अजून काही बदलायचं आहे का?',
    changeFailed: 'माफ करा, आत्ता तो बदल करता आला नाही. आमची टीम तो दुरुस्त करेल.',
    publishNeedsConsent: 'वेबसाइट लाइव्ह करण्यासाठी लिंक WhatsApp वर पाठवाव्या लागतील. या नंबरवर पाठवू का?',
    published: 'तुमची वेबसाइट लाइव्ह झाली! लाइव्ह लिंक आणि ती तुमच्या नावावर करण्याची लिंक WhatsApp वर पाठवली आहे. तुमची सात दिवसांची फ्री ट्रायल आजपासून सुरू.',
    publishedNoLinks: 'तुमची वेबसाइट लाइव्ह झाली! आमची टीम लिंक WhatsApp वर पाठवेल. तुमची सात दिवसांची फ्री ट्रायल आजपासून सुरू.',
    publishFailed: 'माफ करा, आत्ता लाइव्ह करता आली नाही. आमची टीम ती पूर्ण करून तुम्हाला मेसेज करेल.',
    callback: t => `नक्की, मी तुम्हाला ${t} परत कॉल करेन. धन्यवाद!`,
    callbackCapped: 'माफ करा, मी आणखी कॉल बुक करू शकत नाही. तुम्ही कधीही आम्हाला WhatsApp वर मेसेज करू शकता. धन्यवाद!',
    callbackAskTime: 'तुम्हाला कधी परत कॉल करू?',
    notInterested: 'काही हरकत नाही. वेळ दिल्याबद्दल धन्यवाद, तुमचा दिवस छान जावो!',
    wrongNumber: 'त्रासाबद्दल माफ करा. तुमचा दिवस छान जावो!',
    optedOut: 'समजलं, आम्ही तुम्हाला पुन्हा कॉल करणार नाही. त्रासाबद्दल माफ करा. नमस्कार.',
    switching: 'नक्की, मी लगेच मराठीत परत कॉल करते.',
    apologyWhatsApp: 'माफ करा, लाइन तुटत आहे. मी तुम्हाला WhatsApp वर मेसेज करते.',
    apologyCallBack: 'माफ करा, लाइन तुटत आहे. आम्ही नंतर परत कॉल करू.',
  },
  bn: {
    greeting: (n, w) => `নমস্কার! আমি Jeffi Stores থেকে ${n} বলছি। আপনার তথ্য ঠিক রাখতে এই কলটি রেকর্ড হতে পারে। ${w.owner ? `আমি কি ${w.business}-এর ${w.owner}-এর সাথে কথা বলছি?` : `আমি কি ${w.business}-এর কারও সাথে কথা বলছি?`}`,
    greetingAgain: n => `আবার নমস্কার! আমি Jeffi Stores থেকে ${n} বলছি। আপনার তথ্য ঠিক রাখতে এই কলটি রেকর্ড হতে পারে। এখন কি আবার শুরু করা যায়?`,
    pitch: b => `আমরা লোকাল ব্যবসার জন্য ফ্রি ওয়েবসাইট বানিয়ে দিই। কথা বলতে বলতেই আমি ${b}-এর জন্য একটা ওয়েবসাইট বানিয়ে দেখার লিঙ্ক পাঠাতে পারি। চাইবেন?`,
    consentAsk: 'এই নম্বরে WhatsApp-এ লিঙ্কটা পাঠাব?',
    aiAnswer: 'আমি Jeffi Stores-এর AI অ্যাসিস্ট্যান্ট।',
    previewSent: 'হয়ে গেছে! প্রিভিউ লিঙ্কটা আপনার WhatsApp-এ পাঠিয়েছি। আমরা যত কথা বলব, ততই সেটা ভরে উঠবে।',
    consentNeeded: 'আপনার ওয়েবসাইট দেখাতে WhatsApp-এ লিঙ্ক পাঠাতে হবে। এই নম্বরে পাঠাব?',
    failedSoft: 'দুঃখিত, এখন আমার দিক থেকে সেটা হল না। চলুন এগোই।',
    changeDone: 'হয়ে গেছে, পরিবর্তনটা আপনার প্রিভিউতে আসছে। আর কিছু বদলাতে চান?',
    changeFailed: 'দুঃখিত, এখন পরিবর্তনটা করতে পারলাম না। আমাদের টিম সেটা ঠিক করে দেবে।',
    publishNeedsConsent: 'ওয়েবসাইট লাইভ করতে লিঙ্কগুলো WhatsApp-এ পাঠাতে হবে। এই নম্বরে পাঠাব?',
    published: 'আপনার ওয়েবসাইট লাইভ হয়ে গেছে! লাইভ লিঙ্ক আর সেটা নিজের নামে নেওয়ার লিঙ্ক WhatsApp-এ পাঠিয়েছি। আপনার সাত দিনের ফ্রি ট্রায়াল আজ থেকে শুরু।',
    publishedNoLinks: 'আপনার ওয়েবসাইট লাইভ হয়ে গেছে! আমাদের টিম লিঙ্কগুলো WhatsApp-এ পাঠিয়ে দেবে। আপনার সাত দিনের ফ্রি ট্রায়াল আজ থেকে শুরু।',
    publishFailed: 'দুঃখিত, এখন লাইভ করতে পারলাম না। আমাদের টিম সেটা শেষ করে আপনাকে মেসেজ করবে।',
    callback: t => `অবশ্যই, ${t} আপনাকে আবার কল করব। ধন্যবাদ!`,
    callbackCapped: 'দুঃখিত, আর কোনো কল বুক করতে পারছি না। যখন খুশি আমাদের WhatsApp-এ মেসেজ করতে পারেন। ধন্যবাদ!',
    callbackAskTime: 'কখন আবার কল করলে সুবিধা হবে?',
    notInterested: 'কোনো অসুবিধা নেই। সময় দেওয়ার জন্য ধন্যবাদ, দিনটা ভালো কাটুক!',
    wrongNumber: 'বিরক্ত করার জন্য দুঃখিত। দিনটা ভালো কাটুক!',
    optedOut: 'বুঝেছি, আমরা আর আপনাকে কল করব না। বিরক্ত করার জন্য দুঃখিত। নমস্কার।',
    switching: 'অবশ্যই, এখনই বাংলায় আবার কল করছি।',
    apologyWhatsApp: 'দুঃখিত, লাইনটা কেটে যাচ্ছে। আমি আপনাকে WhatsApp-এ মেসেজ করছি।',
    apologyCallBack: 'দুঃখিত, লাইনটা কেটে যাচ্ছে। আমরা পরে আবার কল করব।',
  },
  gu: {
    greeting: (n, w) => `નમસ્તે! હું Jeffi Stores માંથી ${n} બોલું છું. તમારી વિગતો બરાબર રહે એ માટે આ કૉલ રેકોર્ડ થઈ શકે છે. ${w.owner ? `શું હું ${w.business} ના ${w.owner} સાથે વાત કરું છું?` : `શું હું ${w.business} ના કોઈ સાથે વાત કરું છું?`}`,
    greetingAgain: n => `ફરી નમસ્તે! હું Jeffi Stores માંથી ${n} બોલું છું. તમારી વિગતો બરાબર રહે એ માટે આ કૉલ રેકોર્ડ થઈ શકે છે. હવે આગળ વાત કરીએ?`,
    pitch: b => `અમે લોકલ બિઝનેસ માટે ફ્રી વેબસાઇટ બનાવી આપીએ છીએ. આપણે વાત કરીએ ત્યારે જ હું ${b} માટે વેબસાઇટ બનાવીને જોવા માટે લિંક મોકલી શકું. જોઈએ છે?`,
    consentAsk: 'આ નંબર પર WhatsApp પર લિંક મોકલું?',
    aiAnswer: 'હું Jeffi Stores ની AI આસિસ્ટન્ટ છું.',
    previewSent: 'થઈ ગયું! પ્રિવ્યૂ લિંક તમારા WhatsApp પર મોકલી દીધી છે. આપણે વાત કરીશું તેમ એ ભરાતી જશે.',
    consentNeeded: 'તમારી વેબસાઇટ બતાવવા WhatsApp પર લિંક મોકલવી પડશે. આ નંબર પર મોકલું?',
    failedSoft: 'માફ કરશો, અત્યારે મારી બાજુથી એ ન થયું. આગળ વધીએ.',
    changeDone: 'થઈ ગયું, ફેરફાર તમારા પ્રિવ્યૂ પર આવી રહ્યો છે. બીજું કંઈ બદલવું છે?',
    changeFailed: 'માફ કરશો, અત્યારે એ ફેરફાર ન થઈ શક્યો. અમારી ટીમ એ સુધારી દેશે.',
    publishNeedsConsent: 'વેબસાઇટ લાઇવ કરવા લિંક WhatsApp પર મોકલવી પડશે. આ નંબર પર મોકલું?',
    published: 'તમારી વેબસાઇટ લાઇવ થઈ ગઈ! લાઇવ લિંક અને એને તમારા નામે કરવાની લિંક WhatsApp પર મોકલી છે. તમારી સાત દિવસની ફ્રી ટ્રાયલ આજથી શરૂ.',
    publishedNoLinks: 'તમારી વેબસાઇટ લાઇવ થઈ ગઈ! અમારી ટીમ લિંક WhatsApp પર મોકલશે. તમારી સાત દિવસની ફ્રી ટ્રાયલ આજથી શરૂ.',
    publishFailed: 'માફ કરશો, અત્યારે લાઇવ ન થઈ શકી. અમારી ટીમ એ પૂરી કરીને તમને મેસેજ કરશે.',
    callback: t => `ચોક્કસ, હું તમને ${t} પાછો કૉલ કરીશ. આભાર!`,
    callbackCapped: 'માફ કરશો, હું બીજો કૉલ બુક નહીં કરી શકું. તમે ગમે ત્યારે અમને WhatsApp પર મેસેજ કરી શકો છો. આભાર!',
    callbackAskTime: 'તમને ક્યારે પાછો કૉલ કરું?',
    notInterested: 'કંઈ વાંધો નહીં. સમય આપવા બદલ આભાર, તમારો દિવસ શુભ રહે!',
    wrongNumber: 'તકલીફ બદલ માફ કરશો. તમારો દિવસ શુભ રહે!',
    optedOut: 'સમજાઈ ગયું, અમે તમને ફરી કૉલ નહીં કરીએ. તકલીફ બદલ માફ કરશો. નમસ્તે.',
    switching: 'ચોક્કસ, હું હમણાં જ ગુજરાતીમાં પાછો કૉલ કરું છું.',
    apologyWhatsApp: 'માફ કરશો, લાઇન તૂટી રહી છે. હું તમને WhatsApp પર મેસેજ કરું છું.',
    apologyCallBack: 'માફ કરશો, લાઇન તૂટી રહી છે. અમે પછી પાછો કૉલ કરીશું.',
  },
}

export const lines = (language: unknown): Lines => LINES[asLanguage(language)]

/** "Tuesday, 5:00 pm" in the call's language, IST. */
export function spokenTime(at: Date, language: unknown): string {
  return new Intl.DateTimeFormat(`${asLanguage(language)}-IN`, {
    weekday: 'long',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(at)
}

const istStamp = (d: Date) =>
  new Intl.DateTimeFormat('en-IN', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(d)

export interface KnownBrief {
  whatTheyDo?: string
  audience?: string
  highlights?: string[]
  contact?: { phone?: string; email?: string; whatsapp?: string }
  hours?: string
  address?: string
  style?: string
}

export interface PromptContext {
  language: OutreachLanguage
  personaName: string
  business: string
  owner?: string | null
  category?: string | null
  city?: string | null
  now: Date
  /** a previous answered call with this contact (a callback or a language-switch redial) */
  continuing: boolean
  consentWhatsApp: boolean
  previewStarted: boolean
  published: boolean
  known: KnownBrief
}

const knownLines = (k: KnownBrief): string[] => {
  const out: string[] = []
  if (k.whatTheyDo) out.push(`- What they do: ${k.whatTheyDo}`)
  if (k.audience) out.push(`- Customers: ${k.audience}`)
  if (k.highlights?.length) out.push(`- Highlights: ${k.highlights.join('; ')}`)
  if (k.hours) out.push(`- Hours: ${k.hours}`)
  if (k.address) out.push(`- Address: ${k.address}`)
  const c = k.contact
  if (c && (c.phone || c.email || c.whatsapp)) out.push(`- Contact for the site: ${[c.phone, c.whatsapp, c.email].filter(Boolean).join(', ')}`)
  if (k.style) out.push(`- Style: ${k.style}`)
  return out
}

/** The system prompt for one call. English instructions; the agent speaks only the call's language. */
export function systemPrompt(p: PromptContext): string {
  const L = LINES[p.language]
  const lang = LANGUAGE_NAMES[p.language]
  const others = LANGUAGES.filter(l => l !== p.language).map(l => `${LANGUAGE_NAMES[l].english} (${l})`).join(', ')
  const about = [p.category, p.city].filter(Boolean).join(', ')
  const known = knownLines(p.known)
  const state = [
    `- WhatsApp consent: ${p.consentWhatsApp ? 'already given; do not ask again' : 'not given yet'}`,
    `- Preview site: ${p.published ? 'already live' : p.previewStarted ? 'already started; do not call startPreview again' : 'not started'}`,
    ...(known.length ? ['- Details already collected (never ask for these again):', ...known] : []),
  ]
  return `You are ${p.personaName}, phoning on behalf of Jeffi Stores, an Indian company that builds websites for small businesses. This is an outbound call to ${p.business}${p.owner ? ` (owner: ${p.owner})` : ''}${about ? `, ${about}` : ''}.

LANGUAGE
Speak only ${lang.english} (${lang.native}), in a warm, natural, spoken register. Everyday English words people in India use (website, link, WhatsApp, preview, online) are fine. If the person clearly prefers another language you support (${others}), call switchLanguage; do not switch mid-call yourself.

WHO YOU ARE (hard rules)
- You use a human name, ${p.personaName}, and a natural voice: short turns, light backchannels, no monologues.
- Do not volunteer that you are an AI. If the person sincerely asks whether you are a person, a bot or an AI, say truthfully: "${L.aiAnswer}" Never claim to be human.
- The greeting already said the call may be recorded so we get their details right. Say it again only if asked.

HOW YOU TALK
- One question at a time. One or two short sentences per turn.
- Never invent facts about their business. Use only what they tell you and leave unknowns out. Never re-ask something they already answered.
- Never say something worked (link sent, site started, change made, site live, call booked) unless the tool you called returned ok. When a tool's reply has already been spoken, do not repeat it.
- Do not read out links, URLs or long numbers; links go by WhatsApp, and only with their consent.
- Building the website is free; when it goes live a 7-day free trial starts, after which they can choose a plan. Quote no other prices and promise no discounts. If you don't know something, say our team can help with it.

THE CALL
1. They have heard the greeting. Confirm you are speaking with the right business. Wrong person or number: markOutcome(wrong_number).
2. Offer it, in your own words, like: "${L.pitch(p.business)}" Ask once; don't push. Busy now: offer to call back and use scheduleCallback. Not interested: markOutcome(not_interested).
3. If they want it, ask for WhatsApp consent, like: "${L.consentAsk}" Call recordConsent with their answer (whatsapp true or false; recording_ack true once they carried on after the recording notice) and quote their words.
4. Confirm the business name, then call startPreview.
5. Collect the details one at a time, calling addDetails after each answer with only that piece: what they do, then who their customers are, two or three highlights, opening hours, address or area, the contact number or email to show on the site, and a style they like. Skip anything they don't want to share.
6. Ask if they would like anything changed; call requestChange for each change.
7. When they are happy, ask if you should make it live, then call publishSite.
8. Thank them and close.

AT ANY POINT
- "Stop calling", "don't call me", "remove my number" or anything like it: call optOut at once and nothing else.
- Busy or "call later": scheduleCallback with an ISO 8601 time in IST (+05:30) between 09:30 and 20:30. It is now ${istStamp(p.now)} IST.
- Not interested: markOutcome(not_interested). Wrong person: markOutcome(wrong_number). Any other reason to end: markOutcome(other) with a short note.
- If you promise a follow-up and WhatsApp consent is not given, say our team will call back; never promise a WhatsApp message without consent.

${p.continuing ? 'You have spoken with them before (a call back or a language switch). Pick up where things stand below; do not restart the pitch.\n\n' : ''}WHERE THINGS STAND
${state.join('\n')}

Script version: ${SCRIPT_VERSION}.`
}

export const greeting = (p: Pick<PromptContext, 'language' | 'personaName' | 'business' | 'owner' | 'continuing'>): string =>
  p.continuing ? LINES[p.language].greetingAgain(p.personaName) : LINES[p.language].greeting(p.personaName, { business: p.business, owner: p.owner })

export const TOOL_NAMES = [
  'recordConsent', 'startPreview', 'addDetails', 'requestChange', 'publishSite',
  'scheduleCallback', 'markOutcome', 'optOut', 'switchLanguage',
] as const
export type ToolName = (typeof TOOL_NAMES)[number]
export const isToolName = (v: unknown): v is ToolName => TOOL_NAMES.includes(v as ToolName)

const str = (description: string, maxLength = 500) => ({ type: 'string', description, maxLength })

/** The call tools (plan §2) as Anthropic tool definitions; voice-service hands them to Claude as they are. */
export const TOOL_SCHEMAS: { name: ToolName; description: string; input_schema: Record<string, unknown> }[] = [
  {
    name: 'recordConsent',
    description: 'Record their answer to sending links on WhatsApp. Call once they answer the WhatsApp question.',
    input_schema: {
      type: 'object',
      properties: {
        whatsapp: { type: 'boolean', description: 'true only if they clearly agreed to WhatsApp messages on this number' },
        recording_ack: { type: 'boolean', description: 'true if they carried on after hearing the call may be recorded' },
        quote: str('their exact words when answering', 300),
      },
      required: ['whatsapp', 'recording_ack'],
    },
  },
  {
    name: 'startPreview',
    description: 'Start their website draft and, with WhatsApp consent, send the preview link. Call once, after confirming the business name.',
    input_schema: { type: 'object', properties: { business_name: str('the business name as they confirmed it', 120) }, required: ['business_name'] },
  },
  {
    name: 'addDetails',
    description: 'Save details for their website as they give them. Pass only what they just said; leave out anything unknown.',
    input_schema: {
      type: 'object',
      properties: {
        what_they_do: str('what the business does or sells'),
        audience: str('who their customers are'),
        highlights: { type: 'array', items: str('one highlight', 200), maxItems: 6 },
        contact: {
          type: 'object',
          properties: { phone: str('phone to show on the site', 20), email: str('email to show on the site', 120), whatsapp: str('WhatsApp number to show', 20) },
        },
        hours: str('opening hours', 200),
        address: str('address or area', 300),
        style: str('a look or style they like', 200),
        language: { type: 'string', enum: [...LANGUAGES], description: "the website's language, if they asked for one" },
      },
    },
  },
  {
    name: 'requestChange',
    description: 'Change something on their preview site, in their words.',
    input_schema: { type: 'object', properties: { instruction: str('the change they asked for') }, required: ['instruction'] },
  },
  {
    name: 'publishSite',
    description: 'Make their website live. Only after they say yes to making it live.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'scheduleCallback',
    description: 'Book a call back at the time they asked for, then the call ends.',
    input_schema: {
      type: 'object',
      properties: { when: { type: 'string', description: 'ISO 8601 date-time in IST, e.g. 2026-11-25T17:00:00+05:30' } },
      required: ['when'],
    },
  },
  {
    name: 'markOutcome',
    description: 'Record why the call is ending without a website, then the call ends.',
    input_schema: {
      type: 'object',
      properties: { outcome: { type: 'string', enum: ['not_interested', 'wrong_number', 'other'] }, note: str('a short reason', 300) },
      required: ['outcome'],
    },
  },
  {
    name: 'optOut',
    description: 'They asked not to be called or contacted again. Call immediately; the call ends.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'switchLanguage',
    description: 'They prefer another supported language: the call ends and we ring back in that language.',
    input_schema: { type: 'object', properties: { language: { type: 'string', enum: [...LANGUAGES] } }, required: ['language'] },
  },
]
