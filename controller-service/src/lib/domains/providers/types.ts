// What domain purchase needs from AWS and the cluster. Each has a real implementation (route53.ts,
// cluster.ts) used only in production config, and a fake (fake.ts) used locally and in tests.

export type Availability =
  | 'AVAILABLE'
  | 'AVAILABLE_RESERVED'
  | 'AVAILABLE_PREORDER'
  | 'UNAVAILABLE'
  | 'UNAVAILABLE_PREMIUM'
  | 'UNAVAILABLE_RESTRICTED'
  | 'RESERVED'
  | 'DONT_KNOW'
  | 'INVALID_NAME_FOR_TLD'
  | 'PENDING'

export type OperationStatus = 'SUBMITTED' | 'IN_PROGRESS' | 'ERROR' | 'SUCCESSFUL' | 'FAILED'

export interface TldPrice {
  tld: string
  registrationUsd: number
  renewalUsd: number
}

/** Route 53 Domains ContactDetail, in our casing. phoneNumber is +CC.NUMBER (e.g. +91.9876543210). */
export interface DomainContact {
  contactType: 'PERSON' | 'COMPANY'
  firstName: string
  lastName: string
  organizationName?: string
  email: string
  phoneNumber: string
  addressLine1: string
  addressLine2?: string
  city: string
  state: string
  zipCode: string
  countryCode: string
}

/** Route 53 Domains (the API lives in us-east-1). */
export interface DomainRegistrar {
  readonly live: boolean
  checkAvailability(domain: string): Promise<Availability>
  suggestions(domain: string, count: number): Promise<{ domain: string; availability: Availability }[]>
  listPrices(): Promise<TldPrice[]>
  /** Always one year, AWS auto-renew off, privacy protection on every contact. */
  register(domain: string, contact: DomainContact): Promise<{ operationId: string }>
  operation(operationId: string): Promise<{ status: OperationStatus; message: string | null }>
  /** The latest operation of this type for the domain, to recover one whose id was never saved. */
  findOperation(domain: string, type: 'REGISTER_DOMAIN' | 'RENEW_DOMAIN'): Promise<{ operationId: string; status: OperationStatus } | null>
  domainDetail(domain: string): Promise<{ expiresAt: Date | null } | null>
  renew(domain: string, currentExpiryYear: number): Promise<{ operationId: string }>
  /** Whether the registrant confirmed their email (registries suspend the domain after 15 days without). */
  contactVerified(domain: string): Promise<boolean>
}

/** Route 53 hosted zones: registration creates one for the domain. */
export interface DomainDns {
  hostedZoneFor(domain: string): Promise<string | null>
  /** UPSERT A records for each host to the cluster's ingress. */
  pointAtCluster(zoneId: string, hosts: string[]): Promise<void>
}

/** The cluster: IngressRoutes and cert-manager Certificates for a store's routed domains. */
export interface DomainHosting {
  readonly live: boolean
  applyRoutes(tenantId: string): Promise<void>
  /** Whether the host's certificate is issued; requestedAt is when its route was rendered. */
  certReady(tenantSlug: string, host: string, requestedAt: Date): Promise<boolean>
}

export class RegistrarError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false
  ) {
    super(message)
  }
}
