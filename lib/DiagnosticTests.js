module.exports = {
    async runDiagnosticTests({homey, api, that}){
        const BASE_REFS = {homey, api}
        
        // homey.log('Testing wildcard events')
        // let kvEmitter = (namespace) => {
        //   return (key, value) => { 
        //     homey.log(`${namespace}::${JSON.stringify(key, null, 2)}=${JSON.stringify(value, null, 2)}`); 
        //   }
        // }
        // this.homey.on('*',  kvEmitter('*'))
        // api.users.connect()
        // api.users.on('user.update', kvEmitter('user.update'))
        // api.devices.connect()
        // api.devices.on('device.update', kvEmitter('device.update'))
        // api.presence.connect()
        // homey.log('DONE testing wildcard events')
      
        // let state = await api.users.getState() //v3 api call?
        // console.log(state) //null
      
        const API_TESTS = {
          "api.images.getImage": {
            params: {id: "2fac90e3-58bf-4965-974e-717dde9fb83d"},
          },
          "homey.images.getImage": {
            params: {id: "2fac90e3-58bf-4965-974e-717dde9fb83d"},
          },
          "api.presence.setAsleep": {
            params: {id: "7e6962b0-5a1a-49fc-8370-f3e26c4354dd", value: true},
            notes: "Missing scopes. Won't work."
          }
      
        }
      
        let runTest = async (command, test) => {
          try{
            homey.log(`Calling ${command}`)
            // //split the command into parts and get those nested properties to narrow down to our actual command that we will execute
            // let cmd;
            // command.split(".").forEach(part => cmd = cmd ? cmd[part] : BASE_REFS[part]);
            // //make the API call
            // let result = await cmd() 

            //getting the reference and executing it has context scoping issues. This is just an internal diagnostic / development thing, so we'll excuse the use of eval as it will never be used except by this diagnostic
            let p = test?.params ? eval(`${command}(${JSON.stringify(test.params)})`) : eval(`${command}()`)
            let result = await p;

            homey.log(`▸ ${command} result: ${JSON.stringify(result)}`)
          }catch(error){
            homey.log(`error calling ${command}: ${error.message}`)
          }
        }
      
        //try the tests
        const TESTS_TO_RUN = ["api.users.getUsers","api.presence.setAsleep", "api.images.getImages", "homey.cloud.getLocalAddress", "homey.api.getLocalUrl"]
        for(let command of TESTS_TO_RUN){
          if(command in API_TESTS){
            let test = API_TESTS[command];
            await runTest(command, test);
          }
          else {
            await runTest(command)
          }
        }
      }
}

/* Homey 2019
      
      [log] 2023-04-25 20:34:40 [SharpTools] Calling api.images.getImages
      error getting images [HomeyAPIError: You have no access to do this.] {
        statusCode: 403,
        description: 'You have no access to do this.'
      }
      [log] 2023-04-25 20:34:41 [SharpTools] error getting api.images.getImages: You have no access to do this.
      [log] 2023-04-25 20:34:41 [SharpTools] Calling api.images.getImage
      [log] 2023-04-25 20:34:41 [SharpTools] SharpTools socket connection is established (VJBwIS8_VqZXsct8AAAf).
      error getting api.images.getImage [HomeyAPIError: You have no access to do this.] {
        statusCode: 403,
        description: 'You have no access to do this.'
      }
      [log] 2023-04-25 20:34:41 [SharpTools] error getting api.images.getImage: You have no access to do this.
      [log] 2023-04-25 20:34:41 [SharpTools] Calling homey.images.getImage
      [log] 2023-04-25 20:34:41 [SharpTools] error getting homey.images.getImage: Invalid Image
      error getting homey.images.getImage Error: Invalid Image
          at ManagerImages.getImage (/opt/homey-client/system/manager/ManagerApps/AppProcess/node_modules/homey-apps-sdk-v3/manager/images.js:47:23)
          at SharpTools.onInit (/app.js:101:43)
          at processTicksAndRejections (node:internal/process/task_queues:96:5)
          at async SDK._initApp (/opt/homey-client/system/manager/ManagerApps/AppProcess/node_modules/homey-apps-sdk-v3/lib/SDK.js:249:7)      
          at async SDK.createClient (/opt/homey-client/system/manager/ManagerApps/AppProcess/node_modules/homey-apps-sdk-v3/lib/SDK.js:131:7)  
      
      */
      
      
      
      
      /* Homey 2023
      
      2023-04-25T21:25:37.986Z [log] [SharpTools] Calling api.images.getImages
      2023-04-25T21:25:37.999Z [log] [SharpTools] SharpTools socket connection is established (wYTX573nGeCyKZTcAAAh).
      {
        dummy: Item {
          id: 'dummy',
          ownerUri: 'homey:manager:images',
          url: '/api/image/dummy',
          lastUpdated: 1682456852542
        },
        '67187294-376f-4013-8353-f35aa014eaa7': Item {
          id: '67187294-376f-4013-8353-f35aa014eaa7',
          ownerUri: 'homey:app:com.athom.screenshot',
          url: '/api/image/67187294-376f-4013-8353-f35aa014eaa7',
          lastUpdated: 1682456852542
        },
        'adb5e1b4-bb9b-4e0c-b3e8-c104ae0c9b32': Item {
          id: 'adb5e1b4-bb9b-4e0c-b3e8-c104ae0c9b32',
          ownerUri: 'homey:app:com.athom.screenshot',
          url: '/api/image/adb5e1b4-bb9b-4e0c-b3e8-c104ae0c9b32',
          lastUpdated: 1682456852542
        }
      }
      2023-04-25T21:25:38.032Z [log] [SharpTools] images: {"dummy":{"id":"dummy","ownerUri":"homey:manager:images","url":"/api/image/dummy","lastUpdated":1682456852542},"67187294-376f-4013-8353-f35aa014eaa7":{"id":"67187294-376f-4013-8353-f35aa014eaa7","ownerUri":"homey:app:com.athom.screenshot","url":"/api/image/67187294-376f-4013-8353-f35aa014eaa7","lastUpdated":1682456852542},"adb5e1b4-bb9b-4e0c-b3e8-c104ae0c9b32":{"id":"adb5e1b4-bb9b-4e0c-b3e8-c104ae0c9b32","ownerUri":"homey:app:com.athom.screenshot","url":"/api/image/adb5e1b4-bb9b-4e0c-b3e8-c104ae0c9b32","lastUpdated":1682456852542}}
      2023-04-25T21:25:38.032Z [log] [SharpTools] Calling api.images.getImage
      error getting api.images.getImage [HomeyAPIError: <!DOCTYPE html>
      <html lang="en">
      <head>
      <meta charset="utf-8">
      <title>Error</title>
      </head>
      <body>
      <pre>Cannot GET /api/manager/images/image/2fac90e3-58bf-4965-974e-717dde9fb83d</pre>
      </body>
      </html>
      ] {
        statusCode: 404,
        description: null
      }
      2023-04-25T21:25:38.079Z [log] [SharpTools] error getting api.images.getImage: <!DOCTYPE html>
      <html lang="en">
      <head>
      <meta charset="utf-8">
      <title>Error</title>
      </head>
      <body>
      <pre>Cannot GET /api/manager/images/image/2fac90e3-58bf-4965-974e-717dde9fb83d</pre>
      </body>
      </html>
      
      2023-04-25T21:25:38.079Z [log] [SharpTools] Calling homey.images.getImage
      error getting homey.images.getImage Error: Invalid Image
          at ManagerImages.getImage (/node_modules/@athombv/homey-apps-sdk-v3/manager/images.js:47:23)
          at SharpTools.onInit (/app/app.js:101:43)
          at processTicksAndRejections (node:internal/process/task_queues:96:5)
          at async SDK._initApp (/node_modules/@athombv/homey-apps-sdk-v3/lib/SDK.js:249:7)
          at async SDK.createClient (/node_modules/@athombv/homey-apps-sdk-v3/lib/SDK.js:131:7)
          at async /homey-app-runner/lib/App.js:372:22
          at async App.createClient (/homey-app-runner/lib/App.js:416:5)
      2023-04-25T21:25:38.080Z [log] [SharpTools] error getting homey.images.getImage: Invalid Image
      
      */
      
      
      /*
      2019:
      localAddress
      "192.168.1.37:80"
      localUrl
      "http://localhost:80"
      
      2023
      localAddress
      "192.168.1.82:80"
      localUrl
      "http://127.0.0.1:80"
      
      2023 Container:
      localAddress
      "192.168.1.82:80"
      localUrl
      "https://192-168-1-82.homey.homeylocal.com"
      */