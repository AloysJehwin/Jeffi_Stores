import { api } from './client'
import type { Address } from '../types'

export async function listAddresses(): Promise<Address[]> {
  const data = await api<{ addresses: Address[] }>('/api/user/addresses')
  return data.addresses
}

export async function createAddress(payload: Omit<Address, 'id'>): Promise<Address> {
  const data = await api<{ address: Address }>('/api/user/addresses', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return data.address
}

// The route only implements PATCH (the web's AddressFormModal uses it).
export async function updateAddress(id: string, payload: Partial<Address>): Promise<Address> {
  const data = await api<{ address: Address }>(`/api/user/addresses/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
  return data.address
}

export async function deleteAddress(id: string): Promise<void> {
  await api(`/api/user/addresses/${id}`, { method: 'DELETE' })
}

/** District, state and post offices for a 6-digit PIN. */
export async function lookupPincode(pin: string): Promise<{ district: string; state: string; postOffices: string[] }> {
  return api(`/api/pincode/${pin}`)
}
