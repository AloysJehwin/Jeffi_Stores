"""Fixed lines spoken without the LLM: a filler while a tool runs, and the apology when a service fails mid-call.

The persona and script come from the controller; these are only the fallbacks for when the LLM can't speak.
A session may override them with `fillers: [..]` and `apology: ".."`.
"""

from __future__ import annotations

FILLERS: dict[str, list[str]] = {
    "en": ["One moment.", "Just a second.", "Okay, one moment."],
    "hi": ["एक मिनट।", "बस एक सेकंड।"],
    "ta": ["ஒரு நிமிடம்.", "ஒரு நொடி."],
    "te": ["ఒక్క నిమిషం.", "ఒక్క క్షణం."],
    "kn": ["ಒಂದು ನಿಮಿಷ.", "ಒಂದು ಕ್ಷಣ."],
    "ml": ["ഒരു നിമിഷം."],
    "mr": ["एक मिनिट.", "एक क्षण."],
    "bn": ["এক মিনিট।", "এক সেকেন্ড।"],
    "gu": ["એક મિનિટ.", "એક ક્ષણ."],
}

APOLOGIES: dict[str, str] = {
    "en": "Sorry, the line's breaking up. I'll message you on WhatsApp.",
    "hi": "माफ़ कीजिए, लाइन कट रही है। मैं आपको WhatsApp पर मैसेज करती हूँ।",
    "ta": "மன்னிக்கவும், லைன் சரியாக இல்லை. நான் உங்களுக்கு WhatsApp-ல் மெசேஜ் அனுப்புகிறேன்.",
    "te": "క్షమించండి, లైన్ సరిగ్గా లేదు. నేను మీకు WhatsApp లో మెసేజ్ చేస్తాను.",
    "kn": "ಕ್ಷಮಿಸಿ, ಲೈನ್ ಸರಿಯಾಗಿಲ್ಲ. ನಾನು ನಿಮಗೆ WhatsApp ನಲ್ಲಿ ಮೆಸೇಜ್ ಮಾಡುತ್ತೇನೆ.",
    "ml": "ക്ഷമിക്കണം, ലൈൻ ശരിയല്ല. ഞാൻ നിങ്ങൾക്ക് WhatsApp-ൽ മെസേജ് അയക്കാം.",
    "mr": "माफ करा, लाइन तुटत आहे. मी तुम्हाला WhatsApp वर मेसेज करते.",
    "bn": "দুঃখিত, লাইনটা কেটে যাচ্ছে। আমি আপনাকে WhatsApp-এ মেসেজ করছি।",
    "gu": "માફ કરશો, લાઇન તૂટી રહી છે. હું તમને WhatsApp પર મેસેજ કરું છું.",
}


def base_language(code: str | None) -> str:
    """'hi-IN' / 'hi' / 'HI' -> 'hi'; unknown -> 'en'."""
    c = (code or "en").split("-")[0].lower()
    return c if c in APOLOGIES else "en"


def filler(language: str | None, n: int = 0, override: list[str] | None = None) -> str:
    options = [s for s in (override or []) if isinstance(s, str) and s.strip()] or FILLERS[base_language(language)]
    return options[n % len(options)]


def apology(language: str | None, override: str | None = None) -> str:
    if isinstance(override, str) and override.strip():
        return override
    return APOLOGIES[base_language(language)]
