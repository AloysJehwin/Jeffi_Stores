// The languages the visual editor translates an element's words into (lib/site/studio/element-ai.ts). Pure, so the
// editor's client code and the server read one list.

export const LANGUAGES = ['English', 'Hindi', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Marathi', 'Bengali', 'Gujarati', 'Punjabi'] as const
export type Language = (typeof LANGUAGES)[number]
