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

export async function updateAddress(id: string, payload: Partial<Address>): Promise<Address> {
  const data = await api<{ address: Address }>(`/api/user/addresses/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
  return data.address
}

export async function deleteAddress(id: string): Promise<void> {
  await api(`/api/user/addresses/${id}`, { method: 'DELETE' })
}
