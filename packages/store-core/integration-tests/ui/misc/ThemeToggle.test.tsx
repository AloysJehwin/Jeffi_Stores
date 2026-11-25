import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const useThemeMock = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ThemeContext', () => ({ useTheme: () => useThemeMock() }))

import ThemeToggle from '@/components/ThemeToggle'

describe('ThemeToggle', () => {
  it('offers dark mode while light and toggles on click', () => {
    const toggleTheme = vi.fn()
    useThemeMock.mockReturnValue({ resolvedTheme: 'light', toggleTheme, mounted: true })
    render(<ThemeToggle />)
    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark mode' }))
    expect(toggleTheme).toHaveBeenCalledTimes(1)
  })

  it('offers light mode while dark', () => {
    useThemeMock.mockReturnValue({ resolvedTheme: 'dark', toggleTheme: vi.fn(), mounted: true })
    render(<ThemeToggle />)
    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeInTheDocument()
  })

  it('stays on the light label until mounted, to match server markup', () => {
    useThemeMock.mockReturnValue({ resolvedTheme: 'dark', toggleTheme: vi.fn(), mounted: false })
    render(<ThemeToggle />)
    expect(screen.getByRole('button', { name: 'Switch to dark mode' })).toBeInTheDocument()
  })

  it('uses the compact admin styling for the admin variant', () => {
    useThemeMock.mockReturnValue({ resolvedTheme: 'light', toggleTheme: vi.fn(), mounted: true })
    render(<ThemeToggle variant="admin" />)
    expect(screen.getByRole('button')).toHaveClass('h-9', 'w-9')
  })
})
