// Azure App Service (Linux) hosting for Mimir: one Node process that serves the
// built app and the collaboration WebSocket (/ws).
//
// For deploys from GitHub Actions (.github/workflows/azure-app-service.yml):
//   az deployment group create -g <rg> -f infra/main.bicep -p appName=<name> githubRepo=<owner>/<repo>
// For manual zip deploys of source code, built on Azure:
//   az deployment group create -g <rg> -f infra/main.bicep -p appName=<name> buildOnAzure=true
//
// See README.md, "Deploy to Azure".

@description('Web app name. Must be globally unique; the site is https://<appName>.azurewebsites.net.')
@minLength(2)
@maxLength(60)
param appName string

@description('Azure region. Defaults to the resource group\'s region.')
param location string = resourceGroup().location

@description('App Service plan size. Basic (B1) or higher is needed for Always On.')
@allowed([
  'B1'
  'B2'
  'B3'
  'S1'
  'S2'
  'S3'
  'P0v3'
  'P1v3'
  'P2v3'
])
param skuName string = 'B1'

@description('Node.js runtime (az webapp list-runtimes --os linux shows the options).')
param nodeVersion string = 'NODE|22-lts'

@description('Build on Azure during deployment (npm install + npm run build). True for manual zip deploys of source; false when GitHub Actions deploys an already-built package.')
param buildOnAzure bool = false

@description('GitHub repository (owner/name) allowed to deploy via GitHub Actions, e.g. hemolack/mimir. Leave empty to skip creating the deployment identity.')
param githubRepo string = ''

@description('GitHub Actions environment the deploy job runs in; must match the workflow.')
param githubEnvironment string = 'production'

// Built-in role "Website Contributor": manage web apps (including deploying), nothing else.
var websiteContributorRoleId = 'de139f84-1756-47ae-9be6-808fbbe84772'
var createDeployIdentity = !empty(githubRepo)

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${appName}-plan'
  location: location
  kind: 'linux'
  sku: {
    name: skuName
    // Board state lives in the process: run exactly one instance (no scale-out).
    capacity: 1
  }
  properties: {
    reserved: true // Linux
  }
}

resource site 'Microsoft.Web/sites@2023-12-01' = {
  name: appName
  location: location
  kind: 'app,linux'
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    // Single instance, so no need for ARR affinity cookies.
    clientAffinityEnabled: false
    siteConfig: {
      linuxFxVersion: nodeVersion
      appCommandLine: 'npm start'
      // Required for live collaboration.
      webSocketsEnabled: true
      // Keep the process (and open boards) loaded instead of idling out.
      alwaysOn: true
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      appSettings: [
        {
          // true: zip deploys run `npm install` and `npm run build` on Azure (Oryx).
          // false: the uploaded package is already built (GitHub Actions).
          name: 'SCM_DO_BUILD_DURING_DEPLOYMENT'
          value: buildOnAzure ? 'true' : 'false'
        }
        {
          // /home is persistent storage on App Service, outside the deployed
          // code (/home/site/wwwroot), so boards survive restarts and redeploys.
          name: 'DATA_DIR'
          value: '/home/data/boards'
        }
        {
          name: 'WEBSITES_ENABLE_APP_SERVICE_STORAGE'
          value: 'true'
        }
      ]
    }
  }
}

// ---------- Deployment identity for GitHub Actions (optional) ----------
// A managed identity that GitHub Actions signs in as via OpenID Connect: no
// passwords or publish profiles are stored in GitHub. It trusts only the given
// repo's environment, and may only manage this one web app.

resource deployIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = if (createDeployIdentity) {
  name: '${appName}-github-deploy'
  location: location
}

resource githubTrust 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2023-01-31' = if (createDeployIdentity) {
  parent: deployIdentity
  name: 'github-${githubEnvironment}'
  properties: {
    issuer: 'https://token.actions.githubusercontent.com'
    subject: 'repo:${githubRepo}:environment:${githubEnvironment}'
    audiences: [
      'api://AzureADTokenExchange'
    ]
  }
}

resource deployRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (createDeployIdentity) {
  name: guid(site.id, '${appName}-github-deploy', websiteContributorRoleId)
  scope: site
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', websiteContributorRoleId)
    principalId: deployIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

output url string = 'https://${site.properties.defaultHostName}'
output appName string = site.name
// Values for the GitHub repository secrets (identifiers, not passwords).
output AZURE_CLIENT_ID string = createDeployIdentity ? deployIdentity.properties.clientId : ''
output AZURE_TENANT_ID string = tenant().tenantId
output AZURE_SUBSCRIPTION_ID string = subscription().subscriptionId
