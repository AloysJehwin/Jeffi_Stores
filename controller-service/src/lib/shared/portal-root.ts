// Popovers (selects, date pickers) portal here so a themed scope (the ecom console's .ecom-scope)
// styles them like the rest of the page; everywhere else it is document.body.
export const portalRoot = (): HTMLElement => (document.querySelector('.ecom-scope') as HTMLElement | null) ?? document.body
