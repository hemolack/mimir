// Azure App Service (Linux) hosting for Mimir: one Node process that serves the
// built app and the collaboration WebSocket (/ws).
//
// App Service pulls the code from the (public) GitHub repo itself and builds it
// on Azure (npm install + npm run build). Nothing is pushed from GitHub:
// pulls happen when you ask (manual sync), not on every commit.
//   az deployment group create -g <rg> -f infra/main.bicep -p appName=<name>
//   az webapp deployment source sync -g <rg> -n <name>      (pull + build again later)
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

@description('Public Git repository App Service pulls the code from.')
param repoUrl string = 'https://github.com/hemolack/mimir.git'

@description('Branch to deploy.')
param branch string = 'master'

@description('Admin token for the board-deletion API (DELETE /api/boards...). Leave empty to disable deleting. Use a long random value.')
@secure()
param adminToken string = ''

@description('Shared access key required to open and list boards. Leave empty to let anyone use the app. Use a long random value.')
@secure()
param accessKey string = ''

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
          // Each sync runs `npm install` and `npm run build` on Azure (Oryx).
          name: 'SCM_DO_BUILD_DURING_DEPLOYMENT'
          value: 'true'
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
        {
          // Empty disables the board-deletion API.
          name: 'ADMIN_TOKEN'
          value: adminToken
        }
        {
          // Empty lets anyone open boards; set it to keep boards to people who have the key.
          name: 'ACCESS_KEY'
          value: accessKey
        }
      ]
    }
  }
}

// Pull-based deployment: Kudu clones the public repo (no credentials needed).
// Manual integration = no webhook; the code is pulled on creation and whenever
// you run `az webapp deployment source sync` (or press Sync in the portal).
resource sourceControl 'Microsoft.Web/sites/sourcecontrols@2023-12-01' = {
  parent: site
  name: 'web'
  properties: {
    repoUrl: repoUrl
    branch: branch
    isManualIntegration: true
  }
}

output url string = 'https://${site.properties.defaultHostName}'
output appName string = site.name
