// The blocks "Convert to editable section" rewrites as code sections (lib/site/convert.ts). Pure, so the editor's
// client code offers the action on the same list the server converts.

export const CONVERTIBLE = ['rich_text', 'image_text', 'image_banner', 'faq', 'contact_details', 'composed'] as const
export type Convertible = (typeof CONVERTIBLE)[number]
export const isConvertible = (type: string): type is Convertible => (CONVERTIBLE as readonly string[]).includes(type)
