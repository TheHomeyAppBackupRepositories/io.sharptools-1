'use strict';

const Homey = require('homey');
// const { HomeyAPIApp } = require('homey-api');
const { HomeyAPI } = require('homey-api');
const StioUtils = require("./lib/StioUtils")
const StioSocket = require("./lib/StioSocket")
const HomeyUtils = require('./lib/HomeyUtils');
const DiagnosticTests = require('./lib/DiagnosticTests');


if (process.env.DEBUG === '1') {
  // console.debug(JSON.stringify(process.env, null, 2))
  const inspector = require('inspector')
  let debugUrl = inspector.url() //the 2023 Homey will automatically enter into debug mode whereas we have to explicitly do it in Homey 2019
  if(debugUrl){
    console.debug('Debugger is already available. Continuing...')
  }
  else{
    console.debug('Opening up a debugger...')
    inspector.open(9229, '0.0.0.0', false); //fall back for the old Homey
  }
  
}


class SharpTools extends Homey.App {

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('Setting up internal API usage...')
    // const api = new HomeyAPIApp({
    //   homey: this.homey,
    // });
    const api = await HomeyAPI.createAppAPI({ homey: this.homey}); 
    this.homeyApi = api;

    //run any migrations as needed
    await HomeyUtils.checkAndMigrate({homey: this.homey});

    //register the event listeners
    await HomeyUtils.registerChangeListener({homey: this.homey, callback: StioUtils.stateChangeHandler, socket: StioSocket});

    //initialize the socket (if we have the appropriate settings)
    await StioSocket.init({homey: this.homey});

    //and initialize the listener for the settings events
    this.homey.settings.on('set', (key) => HomeyUtils.onSettingChanged({key, homey: this.homey}))

    this.homey.settings.on('set', (key) => {
      //if the list of event subscriptions changes
      if(key === "eventSubscriptions"){
        //update the event listeners
        HomeyUtils.registerChangeListener({homey: this.homey, callback: StioUtils.stateChangeHandler, socket: StioSocket});
      }
    });
    this.log('The app has been initialized');

    // await DiagnosticTests.runDiagnosticTests({homey: this.homey, api: this.homeyApi, that: SharpTools})
    
  }

}

module.exports = SharpTools;
