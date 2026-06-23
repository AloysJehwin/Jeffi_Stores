import { vi, beforeEach, afterEach } from 'vitest'

// Reset all mocks between tests
beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})
