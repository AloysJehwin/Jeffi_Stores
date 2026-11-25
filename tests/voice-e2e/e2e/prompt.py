"""A test copy of the showcase-offer call: persona, greeting, system prompt, tools and the controller's scripted
tool replies. It follows plan §0/§2 (persona rule, recording notice, one question at a time, no false success, STOP
honoured at once). The real prompt lives in controller-service/src/lib/outreach/prompt.ts (O-voice-ctl); keep this
copy close to it so live runs test something representative.
"""

from __future__ import annotations

from typing import Any

# Bulbul v3 voices: the bot is a female voice, the simulated caller a male one, so the two never sound alike.
PERSONAS: dict[str, dict[str, str]] = {
    "en": {"name": "Priya", "voiceId": "priya"},
    "hi": {"name": "Priya", "voiceId": "priya"},
    "ta": {"name": "Kavya", "voiceId": "kavya"},
}
CALLER_VOICES = {"en": "rahul", "hi": "aditya", "ta": "rahul"}
LANG_NAMES = {"en": "English", "hi": "Hindi", "ta": "Tamil", "te": "Telugu", "kn": "Kannada", "ml": "Malayalam",
              "mr": "Marathi", "bn": "Bengali", "gu": "Gujarati"}

GREETINGS = {
    "en": "Hello, this is {name} from Jeffi Stores. This call may be recorded so we get your details right. "
          "Am I speaking with the owner of {business}?",
    "hi": "नमस्ते, मैं Jeffi Stores से {name} बोल रही हूँ। यह कॉल रिकॉर्ड हो सकती है ताकि आपकी जानकारी सही रहे। "
          "क्या मैं {business} के मालिक से बात कर रही हूँ?",
    "ta": "வணக்கம், நான் Jeffi Stores-இலிருந்து {name} பேசுகிறேன். உங்கள் விவரங்கள் சரியாக இருக்க இந்த அழைப்பு பதிவு "
          "செய்யப்படலாம். {business} உரிமையாளரிடம் பேசுகிறேனா?",
}

SYSTEM_PROMPT = """You are {name}, calling on behalf of Jeffi Stores, an Indian company that builds websites for small businesses.
You are on a live outbound phone call with {owner}, who runs {business}, a {category} in {city}. They have no website.

# The offer
Jeffi Stores will build them a free Showcase website right now, during this call, from what they tell you. They get
a preview link on WhatsApp within a minute, can ask for changes, and when they like it you publish it. Publishing
starts a free 7-day trial; after that it is a small monthly fee, and they can cancel any time. They claim the site
with a link we send on WhatsApp.

# How you speak
- Speak only {language}, the way people talk on the phone in India; code-mixing with common English words is fine.
- Short turns: one or two sentences, then stop and let them talk. Ask one question at a time.
- Natural and warm, with light backchannels ("okay", "got it"). No lists, no markdown, no emoji, no URLs read aloud.
- Never re-ask something they already told you. Never invent facts about their business; leave unknowns out.

# Who you are
- You have a human name, but you do not claim to be human. Do not bring it up yourself. If they sincerely ask whether
  you are a person, a robot or an AI, say truthfully that you are Jeffi Stores' AI assistant, then carry on.
- The greeting already said the call may be recorded. If they object to recording, offer to continue on WhatsApp
  instead and end politely.

# Flow
1. Confirm you are speaking with the owner (or someone who can decide). If wrong number, call markOutcome with
   outcome "wrong_number".
2. In one or two sentences, explain the free website offer and ask if you can build it with them now.
3. Ask permission to send the preview on WhatsApp to this number; when they agree, call recordConsent with
   whatsapp=true and recording_ack=true.
4. Call startPreview with the business name as they say it.
5. Learn about the business one question at a time: what they do, who their customers are, two or three highlights,
   opening hours, address or area, and how customers reach them. After each answer call addDetails with what you
   learned (only the fields you learned).
6. Tell them the preview is on WhatsApp and ask if they want anything changed. For each change call requestChange
   with a short instruction.
7. When they are happy, ask if you should publish it. Only when they clearly say yes, call publishSite.
8. Thank them and say goodbye, then call markOutcome with outcome "published", or "interested" if they did not publish.

# Rules the system enforces
- Never say something worked unless the tool returned ok. If a tool fails, say you'll follow up on WhatsApp.
- If they say stop, don't call again, remove my number, or similar: call optOut immediately. Do not argue or pitch.
- Not interested: thank them once, call markOutcome with outcome "not_interested".
- Busy now: ask when to call back and call scheduleCallback with the time they give.
- If they ask to talk in another language (Hindi, Tamil, Telugu, Kannada, Malayalam, Marathi, Bengali, Gujarati or
  English), call switchLanguage with its code (hi, ta, te, kn, ml, mr, bn, gu, en).

Call reference (internal, never say it): ref:{call_id}"""


def _tool(name: str, description: str, properties: dict[str, Any], required: list[str] | None = None) -> dict[str, Any]:
    return {"name": name, "description": description,
            "input_schema": {"type": "object", "properties": properties, "required": required or []}}


_S = {"type": "string"}
TOOLS: list[dict[str, Any]] = [
    _tool("recordConsent", "Record that the person agreed to WhatsApp messages and heard the recording notice.",
          {"whatsapp": {"type": "boolean"}, "recording_ack": {"type": "boolean"}}, ["whatsapp", "recording_ack"]),
    _tool("startPreview", "Create the draft site and its preview link for this business.",
          {"business_name": _S}, ["business_name"]),
    _tool("addDetails", "Add what you learned about the business to the site brief. Only fields you actually learned.",
          {"what_they_do": _S, "audience": _S, "highlights": {"type": "array", "items": _S},
           "contact": {"type": "object", "properties": {"phone": _S, "email": _S, "whatsapp": _S}},
           "hours": _S, "address": _S, "style": _S, "language": _S}),
    _tool("requestChange", "Revise the draft site as the person asked.", {"instruction": _S}, ["instruction"]),
    _tool("publishSite", "Publish the site (starts the 7-day free trial) and send the live and claim links.", {}),
    _tool("scheduleCallback", "Schedule a call back at the time the person gave.", {"when": _S}, ["when"]),
    _tool("markOutcome", "Record how the call ended; this ends the call.",
          {"outcome": {"type": "string", "enum": ["interested", "not_interested", "wrong_number", "published", "other"]},
           "note": _S}, ["outcome"]),
    _tool("optOut", "The person asked not to be called or messaged again. Ends the call.", {}),
    _tool("switchLanguage", "End this call and ring back in the language the person asked for.",
          {"language": {"type": "string", "enum": ["en", "hi", "ta", "te", "kn", "ml", "mr", "bn", "gu"]}}, ["language"]),
]

SAYS: dict[str, dict[str, str]] = {
    "publishSite": {
        "en": "Done, your site is live now. I've sent the live link and a link to claim it on WhatsApp.",
        "hi": "हो गया, आपकी साइट अब लाइव है। मैंने लाइव लिंक और उसे क्लेम करने का लिंक WhatsApp पर भेज दिया है।",
        "ta": "முடிந்தது, உங்கள் வெப்சைட் இப்போது லைவ். லைவ் லிங்கும் க்ளெய்ம் லிங்கும் WhatsApp-ல் அனுப்பியிருக்கிறேன்.",
    },
    "optOut": {
        "en": "Understood. We won't call or message you again. Sorry for the trouble, goodbye.",
        "hi": "समझ गई। हम आपको दोबारा कॉल या मैसेज नहीं करेंगे। परेशानी के लिए माफ़ कीजिए, नमस्ते।",
        "ta": "புரிந்தது. இனி உங்களை அழைக்கவோ மெசேஜ் அனுப்பவோ மாட்டோம். தொந்தரவுக்கு மன்னிக்கவும், நன்றி.",
    },
    "markOutcome": {
        "en": "Thank you for your time. Have a good day!",
        "hi": "आपके समय के लिए धन्यवाद। आपका दिन शुभ हो!",
        "ta": "உங்கள் நேரத்திற்கு நன்றி. நல்ல நாளாக அமையட்டும்!",
    },
    "scheduleCallback": {
        "en": "Sure, I'll call you back then. Bye!",
        "hi": "ठीक है, मैं तब आपको वापस कॉल करूँगी। धन्यवाद!",
        "ta": "சரி, அப்போது மீண்டும் அழைக்கிறேன். நன்றி!",
    },
    "switchLanguage": {
        "en": "Sure, I'll call you right back in {lang}.",
        "hi": "ज़रूर, मैं आपको अभी {lang} में वापस कॉल करती हूँ।",
        "ta": "சரி, உடனே {lang}-ல் மீண்டும் அழைக்கிறேன்.",
    },
}


def _say(tool: str, language: str, **kw: str) -> str:
    table = SAYS[tool]
    return table.get(language, table["en"]).format(**kw)


def tool_reply(tool: str, args: dict[str, Any], language: str) -> dict[str, Any]:
    """The controller's scripted reply: `{ok, say?, end?, redialLanguage?}` (voice-service is the source of truth)."""
    if tool == "publishSite":
        return {"ok": True, "say": _say(tool, language)}
    if tool in ("optOut", "markOutcome", "scheduleCallback"):
        return {"ok": True, "say": _say(tool, language), "end": True}
    if tool == "switchLanguage":
        lang = str(args.get("language") or "en")
        return {"ok": True, "say": _say(tool, language, lang=LANG_NAMES.get(lang, lang)), "redialLanguage": lang}
    if tool in ("recordConsent", "startPreview", "addDetails", "requestChange"):
        return {"ok": True}
    return {"ok": False, "error": f"unknown tool {tool}"}


def session(call_id: str, language: str, contact: dict[str, str], **overrides: Any) -> dict[str, Any]:
    p = PERSONAS.get(language, PERSONAS["en"])
    greeting = GREETINGS.get(language, GREETINGS["en"]).format(name=p["name"], business=contact["business"])
    system = SYSTEM_PROMPT.format(
        name=p["name"], owner=contact["owner"], business=contact["business"], category=contact["category"],
        city=contact["city"], language=LANG_NAMES.get(language, "English"), call_id=call_id,
    )
    out: dict[str, Any] = {
        "language": language,
        "persona": dict(p),
        "systemPrompt": system,
        "greeting": greeting,
        "tools": TOOLS,
        "maxDurationS": 420,
        "silenceS": 14,
    }
    out.update(overrides)
    return out
