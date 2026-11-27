// Phase B landing zone in Azure Central India (docs/plans/AZURE_MOVE_AND_AI_GATEWAY_PLAN.md). Two passes, see README.md:
// deployCore=false: resource group, network, Postgres data disk + backup store, Key Vault, identities. deployCore=true adds the k3s core VM,
// once kv-sync.sh has copied the k3s token and Tailscale key into the vault (its first boot reads them).
targetScope = 'subscription'

param location string = 'centralindia'
param rgName string = 'jeffi-prod-cin'
param prefix string = 'jeffi-prod'
@minLength(3)
@maxLength(24)
param keyVaultName string = 'jeffi-prod-kv'
param deployCore bool = false

param pgAdminLogin string = 'jeffiadmin'
@secure()
@minLength(16)
param pgAdminPassword string

// The k3s service-account issuer (deploy/aws/oidc-issuer.yaml serves it); Entra and AWS STS trust it.
param oidcIssuerUrl string = 'https://oidc.jeffistores.in'
param githubRepo string = 'AloysJehwin/Jeffi_Stores'
// Required with deployCore=true. SSH reaches the VM over Tailscale only; the NSG never opens 22.
param sshPublicKey string = ''
param vmSize string = 'Standard_E4ps_v6'
param pgSku string = 'Standard_B2s'
param pgZone string = ''
// The flagship Postgres is a pod on the core; true brings back the managed Flexible Server instead.
param deployPostgres bool = false
param pgBackupStorageAccount string = 'jeffiprodpgbackup'
// apply.sh passes the signed-in user, who then may write the vault's secrets (kv-sync.sh, pg-init.sh).
param operatorPrincipalId string = ''
param tags object = {
  project: 'jeffi-stores'
  env: 'prod'
}

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: rgName
  location: location
  tags: tags
}

module foundation 'modules/foundation.bicep' = {
  scope: rg
  name: 'jeffi-foundation'
  params: {
    location: location
    prefix: prefix
    keyVaultName: keyVaultName
    pgAdminLogin: pgAdminLogin
    pgAdminPassword: pgAdminPassword
    oidcIssuerUrl: oidcIssuerUrl
    githubRepo: githubRepo
    pgSku: pgSku
    pgZone: pgZone
    deployPostgres: deployPostgres
    pgBackupStorageAccount: pgBackupStorageAccount
    operatorPrincipalId: operatorPrincipalId
    tags: tags
  }
}

module core 'modules/core-vm.bicep' = if (deployCore) {
  scope: rg
  name: 'jeffi-core'
  params: {
    location: location
    prefix: prefix
    vmSize: vmSize
    sshPublicKey: sshPublicKey
    subnetId: foundation.outputs.nodesSubnetId
    publicIpId: foundation.outputs.publicIpId
    publicIpAddress: foundation.outputs.publicIpAddress
    keyVaultName: keyVaultName
    oidcIssuerUrl: oidcIssuerUrl
    pgSubnetCidr: foundation.outputs.pgSubnetCidr
    pgDataDiskId: foundation.outputs.pgDataDiskId
    tags: tags
  }
}

output resourceGroup string = rg.name
output tenantId string = tenant().tenantId
output ingressIp string = foundation.outputs.publicIpAddress
output postgresFqdn string = foundation.outputs.postgresFqdn
output keyVaultUri string = foundation.outputs.keyVaultUri
output githubClientId string = foundation.outputs.githubClientId
output clusterAppsClientId string = foundation.outputs.clusterAppsClientId
output clusterControllerClientId string = foundation.outputs.clusterControllerClientId
output pgDataDiskId string = foundation.outputs.pgDataDiskId
output pgBackupStorageAccount string = foundation.outputs.pgBackupStorageAccount
output pgBackupClientId string = foundation.outputs.pgBackupClientId
output corePrincipalId string = deployCore ? core.outputs.principalId : ''
