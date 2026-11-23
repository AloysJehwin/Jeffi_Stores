import { describe, it, expect } from 'vitest'
import { apiServices, isDeployed, instanceStateLabel, placementLabel, plannedPlacement, notDeployedNote } from '@controller/components/admin/ecom/detail/labels'

// Pure label helpers behind the detail KPIs/sections — exact strings the page shows.

describe('apiServices', () => {
  it('maps service types to a readable list, dropping store', () => {
    expect(apiServices({ service_types: ['store', 'messaging', 'documents'] })).toBe('Messaging + Documents')
    expect(apiServices({ service_types: ['messaging'] })).toBe('Messaging')
  })
  it('falls back when there are no API services', () => {
    expect(apiServices({ service_types: ['store'] })).toBe('no services')
    expect(apiServices({ service_types: null })).toBe('no services')
  })
})

describe('isDeployed', () => {
  it('is true when it has a db, a target or an instance id', () => {
    expect(isDeployed({ rds_endpoint: 'db:5432', ec2_target: null, ec2_instance_id: null })).toBe(true)
    expect(isDeployed({ rds_endpoint: null, ec2_target: null, ec2_instance_id: 'i-1' })).toBe(true)
  })
  it('is false when nothing exists', () => {
    expect(isDeployed({ rds_endpoint: null, ec2_target: null, ec2_instance_id: null })).toBe(false)
  })
})

const infra = (o: Partial<{ status: string; instance_state: string; rds_endpoint: string | null; ec2_target: string | null; ec2_instance_id: string | null }>) => ({
  status: 'active',
  instance_state: 'running',
  rds_endpoint: null,
  ec2_target: null,
  ec2_instance_id: null,
  ...o,
})

describe('instanceStateLabel', () => {
  it('reports removed, being built, build failed and not-deployed', () => {
    expect(instanceStateLabel(infra({ status: 'terminated' }), null)).toBe('Removed')
    expect(instanceStateLabel(infra({}), { status: 'running' })).toBe('Being built')
    expect(instanceStateLabel(infra({ status: 'suspended', rds_endpoint: 'db' }), { status: 'failed' })).toBe('Build failed')
    expect(instanceStateLabel(infra({}), null)).toBe('Not deployed yet')
  })
  it('capitalizes the raw instance state once deployed', () => {
    expect(instanceStateLabel(infra({ rds_endpoint: 'db', instance_state: 'running' }), null)).toBe('Running')
  })
})

describe('placementLabel / plannedPlacement / notDeployedNote', () => {
  it('describes pool and dedicated placement', () => {
    expect(placementLabel({ node: { placement: 'pool', type: 't4g.medium', count: 1 } })).toBe('Shared pool')
    expect(placementLabel({ node: { placement: 'dedicated', type: 't4g.large', count: 2 } })).toBe('Own servers · t4g.large × 2')
    expect(placementLabel(null)).toBe('—')
  })
  it('plannedPlacement is null for a removed tenant and lower-cases otherwise', () => {
    expect(plannedPlacement({ status: 'terminated' }, { node: { placement: 'pool', type: null, count: 1 } })).toBeNull()
    expect(plannedPlacement({ status: 'active' }, { node: { placement: 'pool', type: null, count: 1 } })).toBe('Planned: shared pool')
  })
  it('notDeployedNote joins the state and the plan', () => {
    expect(notDeployedNote(infra({}), null, { node: { placement: 'pool', type: null, count: 1 } })).toBe('Not deployed yet. Planned: shared pool.')
  })
})
