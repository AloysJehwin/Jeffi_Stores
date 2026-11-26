// Network, flagship Postgres, Key Vault and the identities that read it (the GitHub deploy job, and the cluster's
// service accounts through the k3s OIDC issuer).
param location string
param prefix string
param keyVaultName string
param pgAdminLogin string
@secure()
param pgAdminPassword string
param oidcIssuerUrl string
param githubRepo string
// Whoever runs apply.sh: kv-sync.sh writes the copied secrets, pg-init.sh the app_user password.
param operatorPrincipalId string = ''
param operatorPrincipalType string = 'User'
param tags object

param vnetCidr string = '10.60.0.0/16'
param nodesSubnetCidr string = '10.60.1.0/24'
param pgSubnetCidr string = '10.60.2.0/24'
param pgSku string = 'Standard_B2s'
@description('Postgres availability zone; empty lets Azure choose.')
param pgZone string = ''
param pgStorageGb int = 32
param githubEnvironments array = [
  'production'
  'production-release'
]
// Platform pods that may read the vault from any node (an AWS store or edge node has no Azure IMDS).
param clusterAppSubjects array = [
  'system:serviceaccount:jeffi:jeffi-app'
]
param clusterControllerSubjects array = [
  'system:serviceaccount:jeffi:jeffi-stores-controller-service'
]

var roles = {
  kvSecretsUser: '4633458b-17de-408a-b874-0445c86b69e6'
  kvSecretsOfficer: 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7'
  reader: 'acdd72a7-3385-48ef-bd42-f606fba81ae7'
}

resource nsg 'Microsoft.Network/networkSecurityGroups@2024-05-01' = {
  name: '${prefix}-nodes-nsg'
  location: location
  tags: tags
  properties: {
    securityRules: [
      {
        name: 'allow-http'
        properties: {
          priority: 100
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: 'Internet'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '80'
        }
      }
      {
        name: 'allow-https'
        properties: {
          priority: 110
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: 'Internet'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '443'
        }
      }
      {
        // Tailscale direct (peer-to-peer) path; the k3s API, SSH and Postgres are reached only inside the tailnet.
        name: 'allow-tailscale-udp'
        properties: {
          priority: 120
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Udp'
          sourceAddressPrefix: 'Internet'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '41641'
        }
      }
      {
        name: 'deny-internet'
        properties: {
          priority: 4000
          direction: 'Inbound'
          access: 'Deny'
          protocol: '*'
          sourceAddressPrefix: 'Internet'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '*'
        }
      }
    ]
  }
}

resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: '${prefix}-vnet'
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: [
        vnetCidr
      ]
    }
    subnets: [
      {
        name: 'nodes'
        properties: {
          addressPrefix: nodesSubnetCidr
          networkSecurityGroup: {
            id: nsg.id
          }
        }
      }
      {
        name: 'postgres'
        properties: {
          addressPrefix: pgSubnetCidr
          delegations: [
            {
              name: 'flexibleServers'
              properties: {
                serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers'
              }
            }
          ]
        }
      }
    ]
  }
}

resource ip 'Microsoft.Network/publicIPAddresses@2024-05-01' = {
  name: '${prefix}-core-ip'
  location: location
  tags: tags
  sku: {
    name: 'Standard'
  }
  properties: {
    publicIPAllocationMethod: 'Static'
    publicIPAddressVersion: 'IPv4'
  }
}

resource dnsZone 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: '${prefix}.private.postgres.database.azure.com'
  location: 'global'
  tags: tags
}

resource dnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: dnsZone
  name: '${prefix}-vnet'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnet.id
    }
  }
}

resource pg 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: '${prefix}-pg'
  location: location
  tags: tags
  sku: {
    name: pgSku
    tier: 'Burstable'
  }
  properties: {
    version: '16'
    availabilityZone: empty(pgZone) ? null : pgZone
    administratorLogin: pgAdminLogin
    administratorLoginPassword: pgAdminPassword
    storage: {
      storageSizeGB: pgStorageGb
      autoGrow: 'Disabled'
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
    authConfig: {
      activeDirectoryAuth: 'Disabled'
      passwordAuth: 'Enabled'
    }
    network: {
      delegatedSubnetResourceId: '${vnet.id}/subnets/postgres'
      privateDnsZoneArmResourceId: dnsZone.id
      publicNetworkAccess: 'Disabled'
    }
  }
  dependsOn: [
    dnsLink
  ]
}

// Configuration writes on one server must not overlap: each waits for the previous.
resource pgExtensions 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: pg
  name: 'azure.extensions'
  properties: {
    value: 'pg_trgm,uuid-ossp,unaccent,vector'
    source: 'user-override'
  }
}

resource pgTls 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: pg
  name: 'require_secure_transport'
  properties: {
    value: 'ON'
    source: 'user-override'
  }
  dependsOn: [
    pgExtensions
  ]
}

resource pgDb 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: pg
  name: 'jeffi_stores'
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
  dependsOn: [
    pgTls
  ]
}

resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  tags: tags
  properties: {
    tenantId: tenant().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      defaultAction: 'Allow'
      bypass: 'AzureServices'
    }
  }
}

resource pgAdminSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'pg-admin-password'
  properties: {
    value: pgAdminPassword
    contentType: 'text/plain'
  }
}

resource githubId 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${prefix}-github-deploy'
  location: location
  tags: tags
}

// Federated credentials are written one at a time across the tenant, so the three loops are chained too.
@batchSize(1)
resource githubFic 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2023-01-31' = [
  for env in githubEnvironments: {
    parent: githubId
    name: 'github-${env}'
    properties: {
      issuer: 'https://token.actions.githubusercontent.com'
      subject: 'repo:${githubRepo}:environment:${env}'
      audiences: [
        'api://AzureADTokenExchange'
      ]
    }
  }
]

resource appsId 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${prefix}-cluster-apps'
  location: location
  tags: tags
}

@batchSize(1)
resource appsFic 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2023-01-31' = [
  for (sub, i) in clusterAppSubjects: {
    parent: appsId
    name: 'k3s-apps-${i}'
    dependsOn: [githubFic]
    properties: {
      issuer: oidcIssuerUrl
      subject: sub
      audiences: [
        'api://AzureADTokenExchange'
      ]
    }
  }
]

resource controllerId 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${prefix}-cluster-controller'
  location: location
  tags: tags
}

@batchSize(1)
resource controllerFic 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2023-01-31' = [
  for (sub, i) in clusterControllerSubjects: {
    parent: controllerId
    name: 'k3s-controller-${i}'
    dependsOn: [appsFic]
    properties: {
      issuer: oidcIssuerUrl
      subject: sub
      audiences: [
        'api://AzureADTokenExchange'
      ]
    }
  }
]

resource githubKv 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: kv
  name: guid(kv.id, githubId.id, roles.kvSecretsUser)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.kvSecretsUser)
    principalId: githubId.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// Reader on the group: release-db.sh finds the Postgres address in the private DNS zone when the runner can't resolve it.
resource githubReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, githubId.id, roles.reader)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.reader)
    principalId: githubId.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource appsKv 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: kv
  name: guid(kv.id, appsId.id, roles.kvSecretsUser)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.kvSecretsUser)
    principalId: appsId.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// The controller creates and deletes tenant-db-* secrets.
resource controllerKv 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: kv
  name: guid(kv.id, controllerId.id, roles.kvSecretsOfficer)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.kvSecretsOfficer)
    principalId: controllerId.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource operatorKv 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(operatorPrincipalId)) {
  scope: kv
  name: guid(kv.id, operatorPrincipalId, roles.kvSecretsOfficer)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.kvSecretsOfficer)
    principalId: operatorPrincipalId
    principalType: operatorPrincipalType
  }
}

output nodesSubnetId string = '${vnet.id}/subnets/nodes'
output pgSubnetCidr string = pgSubnetCidr
output publicIpId string = ip.id
output publicIpAddress string = ip.properties.ipAddress
output postgresFqdn string = pg.properties.fullyQualifiedDomainName
output postgresDnsZone string = dnsZone.name
output keyVaultUri string = kv.properties.vaultUri
output githubClientId string = githubId.properties.clientId
output clusterAppsClientId string = appsId.properties.clientId
output clusterControllerClientId string = controllerId.properties.clientId
