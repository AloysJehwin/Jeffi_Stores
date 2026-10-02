import { vi, beforeEach, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// Shared setup for the integration / UI suite. Mirrors tests/setup.ts (mock reset) and adds
// RTL DOM cleanup + jest-dom matchers so component tests don't leak rendered DOM between cases.
beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
