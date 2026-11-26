// The k3s core: E4ps_v6 (Arm, so the arm64-only images run unchanged), Ubuntu 24.04 arm64, P10 OS disk, the static
// public IP for 80/443. cloud-init/core.sh installs Tailscale and the k3s server on first boot. customData can't
// change after creation: a new cloud-init means a new VM.
param location string
param prefix string
param vmSize string = 'Standard_E4ps_v6'
param adminUsername string = 'jeffi'
param sshPublicKey string
param subnetId string
param publicIpId string
@description('The static public IP itself: cloud-init cannot read a Standard-SKU IP from IMDS.')
param publicIpAddress string
param keyVaultName string
param oidcIssuerUrl string
param pgSubnetCidr string
param privateIp string = '10.60.1.4'
param tags object

var kvSecretsOfficer = 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7'
// 168.63.129.16 is Azure DNS: advertised so the tailnet can resolve the Postgres private zone through the core.
var cloudInit = replace(replace(replace(replace(loadTextContent('../cloud-init/core.sh'), '__KEY_VAULT__', keyVaultName), '__OIDC_ISSUER__', oidcIssuerUrl), '__ADVERTISE_ROUTES__', '${pgSubnetCidr},168.63.129.16/32'), '__PUBLIC_IP__', publicIpAddress)

resource kv 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource nic 'Microsoft.Network/networkInterfaces@2024-05-01' = {
  name: '${prefix}-core-nic'
  location: location
  tags: tags
  properties: {
    enableAcceleratedNetworking: true
    ipConfigurations: [
      {
        name: 'ipconfig1'
        properties: {
          subnet: {
            id: subnetId
          }
          privateIPAllocationMethod: 'Static'
          privateIPAddress: privateIp
          publicIPAddress: {
            id: publicIpId
          }
        }
      }
    ]
  }
}

resource vm 'Microsoft.Compute/virtualMachines@2024-07-01' = {
  name: '${prefix}-core'
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    hardwareProfile: {
      vmSize: vmSize
    }
    securityProfile: {
      securityType: 'TrustedLaunch'
      uefiSettings: {
        secureBootEnabled: true
        vTpmEnabled: true
      }
    }
    storageProfile: {
      imageReference: {
        publisher: 'Canonical'
        offer: 'ubuntu-24_04-lts'
        sku: 'server-arm64'
        version: 'latest'
      }
      osDisk: {
        name: '${prefix}-core-os'
        createOption: 'FromImage'
        caching: 'ReadWrite'
        diskSizeGB: 128
        managedDisk: {
          storageAccountType: 'Premium_LRS'
        }
        deleteOption: 'Detach'
      }
    }
    osProfile: {
      computerName: 'jeffi-core'
      adminUsername: adminUsername
      customData: base64(cloudInit)
      linuxConfiguration: {
        disablePasswordAuthentication: true
        ssh: {
          publicKeys: [
            {
              path: '/home/${adminUsername}/.ssh/authorized_keys'
              keyData: sshPublicKey
            }
          ]
        }
      }
    }
    networkProfile: {
      networkInterfaces: [
        {
          id: nic.id
          properties: {
            deleteOption: 'Detach'
          }
        }
      ]
    }
    diagnosticsProfile: {
      bootDiagnostics: {
        enabled: true
      }
    }
  }
}

// The controller creates and deletes tenant-db-* secrets; pods on the core reach the vault through this identity.
resource coreKv 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: kv
  name: guid(kv.id, vm.id, kvSecretsOfficer)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', kvSecretsOfficer)
    principalId: vm.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

output principalId string = vm.identity.principalId
