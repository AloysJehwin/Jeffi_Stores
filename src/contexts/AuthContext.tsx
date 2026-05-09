'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

interface User {
  id: string
  email: string
  firstName: string
  lastName: string | null
  phone: string | null
  createdAt: string
}

interface AuthContextType {
  user: User | null
  isLoading: boolean
  login: (email: string, otp: string) => Promise<void>
  googleLogin: (idToken: string) => Promise<void>
  signup: (data: SignupData) => Promise<void>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
}

interface SignupData {
  email: string
  otp: string
  firstName: string
  lastName?: string
  phone?: string
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const fetchUser = async () => {
    try {
      const response = await fetch('/api/auth/me')
      if (response.ok) {
        const data = await response.json()
        setUser(data.user)
      } else {
        setUser(null)
      }
    } catch {
      setUser(null)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchUser()
  }, [])

  const login = async (email: string, otp: string) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp }),
    })
    if (!response.ok) {
      const data = await response.json()
      throw new Error(data.error || 'Login failed')
    }
    const data = await response.json()
    setUser(data.user)
  }

  const googleLogin = async (idToken: string) => {
    const response = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    })
    if (!response.ok) {
      const data = await response.json()
      throw new Error(data.error || 'Google login failed')
    }
    const data = await response.json()
    setUser(data.user)
  }

  const signup = async (signupData: SignupData) => {
    const response = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signupData),
    })
    if (!response.ok) {
      const data = await response.json()
      throw new Error(data.error || 'Signup failed')
    }
    const data = await response.json()
    setUser(data.user)
  }

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } finally {
      setUser(null)
      window.location.href = '/'
    }
  }

  const refreshUser = async () => {
    await fetchUser()
  }

  return (
    <AuthContext.Provider
      value={{ user, isLoading, login, googleLogin, signup, logout, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
