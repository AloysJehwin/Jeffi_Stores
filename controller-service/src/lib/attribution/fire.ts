/** Run a hook in the background: it never delays or fails the caller's request. */
export function fireAndForget(label: string, work: () => Promise<unknown>): void {
  void Promise.resolve()
    .then(work)
    .catch(e => console.warn(`[attribution] ${label} not recorded: ${e?.message || e}`))
}
