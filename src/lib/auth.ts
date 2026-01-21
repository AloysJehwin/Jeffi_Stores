import { supabaseAdmin } from './supabase'
import bcrypt from 'bcrypt'

/**
 * Admin Authentication Functions
 */

// Verify admin credentials
export async function verifyAdminCredentials(username, password) {
  try {
    const { data: admin, error } = await supabaseAdmin
      .from('admins')
      .select(`
        *,
        users (
          id,
          email,
          first_name,
          last_name,
          is_active
        )
      `)
      .eq('username', username)
      .single()

    if (error || !admin) {
      return { success: false, error: 'Invalid credentials' }
    }

    // Check if user is active
    if (!admin.users?.is_active) {
      return { success: false, error: 'Account is disabled' }
    }

    // Verify password
    const passwordMatch = await bcrypt.compare(password, admin.password_hash)
    if (!passwordMatch) {
      return { success: false, error: 'Invalid credentials' }
    }

    // Update last login
    await supabaseAdmin
      .from('admins')
      .update({ last_login: new Date().toISOString() })
      .eq('id', admin.id)

    await supabaseAdmin
      .from('users')
      .update({ last_login: new Date().toISOString() })
      .eq('id', admin.user_id)

    return {
      success: true,
      admin: {
        id: admin.id,
        user_id: admin.user_id,
        username: admin.username,
        role: admin.role,
        email: admin.users.email,
        first_name: admin.users.first_name,
        last_name: admin.users.last_name,
      },
    }
  } catch (error) {
    console.error('Admin auth error:', error)
    return { success: false, error: 'Authentication failed' }
  }
}

// Create new admin user
export async function createAdminUser(userData) {
  try {
    // Hash password
    const passwordHash = await bcrypt.hash(userData.password, 10)

    // Create user first
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .insert({
        email: userData.email,
        first_name: userData.first_name,
        last_name: userData.last_name,
        phone: userData.phone,
      })
      .select()
      .single()

    if (userError) throw userError

    // Create admin
    const { data: admin, error: adminError } = await supabaseAdmin
      .from('admins')
      .insert({
        user_id: user.id,
        username: userData.username,
        password_hash: passwordHash,
        role: userData.role || 'admin',
      })
      .select()
      .single()

    if (adminError) throw adminError

    return { success: true, admin }
  } catch (error) {
    console.error('Create admin error:', error)
    return { success: false, error: error.message }
  }
}

// Verify client certificate (called from middleware)
export function verifyClientCertificate(certHeader, certVerified) {
  // In production with Nginx/Cloudflare, these headers will be set
  // certHeader: X-Client-Cert (PEM format)
  // certVerified: X-Client-Cert-Verified (SUCCESS/FAILED)

  if (process.env.NODE_ENV !== 'production') {
    // Development mode - skip cert check but log warning
    console.warn('⚠️  Development mode: Certificate check bypassed')
    return { valid: true, warning: 'Development mode' }
  }

  if (!certHeader || certVerified !== 'SUCCESS') {
    return { valid: false, error: 'Invalid or missing client certificate' }
  }

  // Additional certificate validation can be added here
  // e.g., check CN, expiry, revocation list, etc.

  return { valid: true }
}

// Check if user has admin role
export function hasAdminRole(session, requiredRole = 'admin') {
  if (!session?.admin) return false

  const roleHierarchy = {
    super_admin: 3,
    admin: 2,
    moderator: 1,
  }

  const userRoleLevel = roleHierarchy[session.admin.role] || 0
  const requiredRoleLevel = roleHierarchy[requiredRole] || 0

  return userRoleLevel >= requiredRoleLevel
}

// Session management helpers
export function createSessionToken(admin) {
  // This will be handled by JWT or secure cookies
  return {
    id: admin.id,
    user_id: admin.user_id,
    username: admin.username,
    role: admin.role,
    email: admin.email,
    exp: Date.now() + 30 * 60 * 1000, // 30 minutes
  }
}

export function isSessionValid(session) {
  if (!session || !session.exp) return false
  return Date.now() < session.exp
}
