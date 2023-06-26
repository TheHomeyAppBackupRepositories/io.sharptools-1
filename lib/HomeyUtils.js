//Declare homey as a parameter to stylistically mimic the API approach for consistency
// Keeps the scope of 'this' more flexible so we can use arrow functions, et al. and reference
// local scope without worrying about needing to access this.log() or other features
// const SharpTools = require("./StioUtils")

const { createHash } = require("crypto");
const { executeMigration } = require("./Migrations");

let listeners = {}; //for tracking the registered listeners over time

let registerListener = (deviceId, capabilityId, listener) => {
    //see if the deviceId is already registered
    if(!listeners.hasOwnProperty(deviceId))
        listeners[deviceId] = {}

    //see if the capabilityId is already registered
    if(listeners[deviceId][capabilityId] != undefined)
        console.warn(`Capability ${capabilityId} is already registered on device ID ${deviceId}. Skipping`)
    else
        listeners[deviceId][capabilityId] = listener
}

let isListenerRegistered = (deviceId, capabilityId) => {
    return listeners?.[deviceId]?.[capabilityId] != undefined
}

let EVENT_CACHE = {}
let EVENT_TIMERS = {}
let getEventCacheValue = (key, deleteOnRead=false) => {
    let event = EVENT_CACHE[key]
    if(deleteOnRead)
        delete EVENT_CACHE[key];
    return event;
}
let setEventCacheValue = (key, value) => {
    EVENT_CACHE[key] = value;
}
const getBaseUrl = async ({homey}) => {
    let address = await homey.cloud.getLocalAddress() ?? "";
    let re = /^.*?((?:\d+\.){3}\d+).*$/
    let matches = address.match(re);
    if(Array.isArray(matches) && matches.length > 1){
        let ip = matches[1];
        let dashedIp = ip.split(".").join("-")
        return `https://${dashedIp}.homey.homeylocal.com`
    }
    return; //nothing to return if it's bad
}
const getAlbumArtUrl = async ({homey, deviceId}) => {
    let api = homey.app.homeyApi
    let device = await api.devices.getDevice({id: deviceId});
    homey.app.log(`DEBUG device images: ${JSON.stringify(device.images, null, 2)}`)
    let img = device.images?.find(img => img.type === "media" && img.id === "albumart")
    let {url: path, id, lastUpdated} = (img?.imageObj ?? {})
    //the url is more like a path, so we rename it

    homey.app.log(`Received art path as: ${path}`);

    //get the base URL
    let baseUrl = await getBaseUrl({homey})
    if(baseUrl && path){
        let fullUrl = baseUrl + path + `?ts=${Date.now()}`
        homey.app.log(`Full URL is: ${fullUrl}`)
        return fullUrl
    }
}
const speaker_to_meta_attribute = {
    "speaker_track": "title",
    "speaker_artist": "artist",
    "speaker_album": "album"
}
let aggregateAudioTrackData = ({event, homey, socket, callback}) => {
    let {deviceId, capability, value, timestamp} = event;
    
    homey.app.log(`Aggregating audio_track_data subattribute: ${capability}=${value} for device ${deviceId}`)
    let key = `${deviceId}_audio_track_data`

    let timer = EVENT_TIMERS[key];
    //if we already have a timer, clear it (reset the time)
    if(timer)
        clearTimeout(timer)
    
    let baseEvent = getEventCacheValue(key) ?? {}
    //we need a structured 'value' that merges an object of [metakey]: value mappings
    let metakey = speaker_to_meta_attribute[capability]
    //so we build the base event either with the existing value (already in that format) or an empty object
    let baseEventValue = baseEvent.value ?? {}
    //then we format the event
    let formattedEvent = {
        ...baseEvent,
        deviceId,
        capability: "audio_track_data",
        value: {
            ...baseEventValue, 
            [metakey]: value
        },
        timestamp
    }
    //store our updated merged event (in case further events come in)
    setEventCacheValue(key, formattedEvent);
    //set a time to emit the new event
    EVENT_TIMERS[key] = setTimeout(async ()=>{
        //grab the album art and add it to the event
        let artUrl = await getAlbumArtUrl({homey, deviceId})
        if(artUrl){
            homey.app.log(`Injecting album art URL to event: ${artUrl}`);
            formattedEvent.value["albumArtUrl"] = artUrl
        }
        //execute the callback and clear the timeout
        callback({event: formattedEvent, homey, socket})
        clearTimeout(EVENT_TIMERS[key]) //probably not necessary
        delete EVENT_TIMERS[key];
    }, 500)
    
}

const AUDIO_TRACK_DATA_CAPABILITIES = ["speaker_artist", "speaker_album", "speaker_track"]

//setup a generic registration function that can reuse the homey and socket instances, but can be customized for each device/capability with a callback and optional transformer 
let handleDeviceEventRegistration = ({device, capabilityId, callback, transformer, homey, socket, customCapabilities}) => {
    //create the listener
    let listener = device.makeCapabilityInstance(capabilityId, value => {
        homey.app.log(`${device?.name}::${capabilityId}=${value}`)
        let event = {deviceId: device.id, capability: capabilityId, value, timestamp: (new Date()).toISOString()}
        //if the device+capability has a custom mapping, inject it
        if(device.id in customCapabilities && capabilityId in customCapabilities[device.id]){
            event.__isCustom = true;
            event.__stAttributes = customCapabilities[device.id][capabilityId];
        }
        //determine if we pass it through a transformer or directly to the callback
        if(transformer)
            transformer({event, homey, socket, callback}); //run the transformer and let it handle the callback
        else
            callback({event, homey, socket}) //run the callback directly
    });
    //register the listener
    registerListener(device.id, capabilityId, listener);
    
    homey.app.log(` + Registered listener for ${capabilityId} of ${device.id}`)
}

let isUserListenerActive = false;
let _monitoredUsers = {};
//setup a generic registration function that can reuse the homey and socket instances, but can be customized for each device/capability with a callback and optional transformer 
let handleUsersEventRegistration = ({callback, homey, socket, monitoredUsers}) => {
    let api = homey.app.homeyApi;

    //stub a callback for user events    
    let onUserEvent = (user) => {
        console.log(`User event for ${user.id}`)
        //filter out unmonitored user events
        if(!(user.id in _monitoredUsers))
            return; //skip unmonitored users

        let userSnap = _monitoredUsers[user.id];

        //stub the shared event attributes
        const deviceId = `${user.id}|user`
        const timestamp = (new Date()).toISOString()
        
        //remap the Homey User Event into an appropriate format to send to SharpTools
        //only update it if it's different than what's on record (snapshotted)
        //present
        if(user.present !== userSnap.present){
            callback({homey, socket, event: {deviceId, capability: "$user_present", value: user.present ?? false, timestamp}})
            userSnap.present = user.present;
        }
        //asleep
        if(user.asleep !== userSnap.asleep){
            callback({homey, socket, event: {deviceId, capability: "$user_asleep", value: user.asleep ?? false, timestamp}})
            userSnap.asleep = user.asleep;
        }

    }

    //update the list of users we are monitoring
    _monitoredUsers = monitoredUsers;

    //register the listener for all user events
    if(!isUserListenerActive){
        api.users.connect()
        api.users.on('user.update', onUserEvent)
        isUserListenerActive = true;
        homey.app.log(` + Registered listener for USER events`)
    }
}

let patchSubscriptions = ({subscriptions, deviceId, homey}) => {
    //fix the battery bug (for early beta adopters)
    if("battery" in subscriptions[deviceId]){
        homey.app.log(` Δ Patch battery -> measure_battery subscription on device ${deviceId}`);
        subscriptions[deviceId]["measure_battery"] = JSON.parse(JSON.stringify(subscriptions[deviceId]["battery"]))
        delete subscriptions[deviceId]["battery"];
    }
}


module.exports = { 
    onSettingChanged({homey, key}){
        homey.app.log?.(`onSettingChanged Setting changed: ${key}`)
    },
    async getDevices({homey}){
        let api = homey.app.homeyApi;
        
        //get the list of devices
        return api.devices.getDevices()
    },
    async getDevice({homey, deviceId}){
        let api = homey.app.homeyApi;
        return api.devices.getDevice({id: deviceId});
    },
    async sendCommand({homey, deviceId, capability, value}){
        let api = homey.app.homeyApi;
        // let device = await api.devices.getDevice({id: deviceId});
        // return device.setCapabilityValue(capability, value);
        return api.devices.setCapabilityValue({deviceId, capabilityId: capability, value});
    },
    async sendFlowCommand({homey, command, payload}){
        //won't work with default app permissions, but leaving it stubbed in case we can get pinned flow.start permissions added
        let api = homey.app.homeyApi;
        return api.flow[command]?.(payload)
    },
    async getFlows({homey}){
        let api = homey.app.homeyApi;
        
        //get the list of flows
        let p1 = api.flow.getFlows()
        let p2 = api.flow.getAdvancedFlows()

        let [basicFlows, advancedFlows] = await Promise.all([p1, p2]);

        //append a special property for the type so we can ID them accordingly
        Object.values(basicFlows).forEach(flow => flow.type = "flow");
        Object.values(advancedFlows).forEach(flow => flow.type = "advancedFlow")

        //combine the two flow types into one object
        return {...basicFlows, ...advancedFlows};
    },
    async getUsers({homey}){
        let api = homey.app.homeyApi;
        
        //get the users
        return api.users.getUsers()
    },
    getHubInfo({homey}){
        return {
            metadata: {
                appVersion: homey.manifest.version ?? "0.0.1.0",
                systemVersion: homey.version,
                platform: homey.platform, //local|cloud
                sdk: homey.app.sdk,
            }
        }
    },
    async registerChangeListener({homey, callback, socket}){
        homey.app.log('Registering or updating change listeners.')
        //we initialized a HomeyAPIApp into the property 'homeyApi' when the app was initialized, so we can reference it here
        //alias it to api for simpler reference
        let api = homey.app.homeyApi;

        //get the list of devices
        let deviceMap = await api.devices.getDevices();
        let userMap = await api.users.getUsers();

        let selectedThings = (await homey.settings.get("selectedThings")) ?? {};
        let selectedUsers = (await homey.settings.get("selectedUsers")) ?? {}

        let subscriptions = (await homey.settings.get("eventSubscriptions")) ?? {} // { thingId: { capabilityId: { subscribed: true }}}

        let customCapabilities = (await homey.settings.get("customCapabilities")) ?? {}

        /*
         * DEVICE EVENT SUBSCRIPTION REGISTRATIONS
         */
        //loop through them, filter to ones we care about, and register event listeners
        for(let device of Object.values(deviceMap)){
            let deviceId = device.id; //alias
            //if it's not a device we have selected
            // or we don't have an Event Subscription entry for the device
            if(selectedThings[deviceId]?.authorized !== true || !(deviceId in subscriptions))
                continue //move on

            //alias the capabilities, so we can safely and quickly validate capabilities later
            let capabilityMap = device.capabilitiesObj ?? {} //community posts indicate this can be null/undefined if the object is not initialized yet, so let's play it safe

            patchSubscriptions({subscriptions, deviceId, homey})
            //loop through the capability keys
            for(let capabilityId of Object.keys(subscriptions[deviceId])){
                //if the capability isn't subscribed
                if(subscriptions[deviceId][capabilityId].subscribed !== true)
                    continue //move on

                //if the device still has that capability and isn't already subscribed, setup the listener
                if(capabilityId in capabilityMap && !isListenerRegistered(deviceId, capabilityId)){
                    handleDeviceEventRegistration({device, capabilityId, callback, homey, socket, customCapabilities})
                }
                //or if it's a special capability, handle it manually
                else if(capabilityId === "audio_track_data"){
                    //for audio_track_data, we need to subscribe to each of the individual speaker_* capabilities
                    for(let capId of AUDIO_TRACK_DATA_CAPABILITIES){
                        //if the device has the subcapability and it's not registered yet
                        if(capId in capabilityMap && !isListenerRegistered(deviceId, capId)){
                            //use the aggregation transformer
                            handleDeviceEventRegistration({device, capabilityId: capId, callback, transformer: aggregateAudioTrackData, homey, socket, customCapabilities}) 
                        }
                    }
                    
                }
            }
        }

        /*
         * USER EVENT SUBSCRIPTION REGISTRATIONS
         */
        //loop through the users 
        let isUserSubscription = false;
        let monitoredUsers = {}
        for(let user of Object.values(userMap)){
            const deviceId = `${user.id}|user` //alias (special format)

            //if it's not a user we have selected
            // or we don't have an Event Subscription entry for the 'device'
            if(selectedUsers[user.id] !== true || !(deviceId in subscriptions))
                continue //move on

            //if there's _any_ capability subscribed for the user
            if(Object.values(subscriptions[deviceId]).some(cap => cap.subscribed === true)){
                monitoredUsers[user.id] = {
                    present: user.present,
                    asleep: user.asleep
                }; //snapshot their status (which also indicates we monitor their events)
            }
        }
        if(Object.keys(monitoredUsers).length > 0)
            handleUsersEventRegistration({callback, homey, socket, monitoredUsers})
        
        homey.app.log('Homey change listeners have been registered.')
    },
    async getFingerprint({homey, systemInfo}){
        //Only create the fingerprint if it doesn't exist yet.
        //Fingerprint is not global unique nor persistent. It is an identifier that we used for suggesting the previous mapping location from SharpTools.io
        let fingerprint = await homey.settings.get('fingerprint');
        if (fingerprint == null || fingerprint === ""){
            //if we have system information available
            if(systemInfo){
                //use the cloud id or hostname (if avaialable) as they should be pretty consistent
                if(systemInfo.cloudId || systemInfo.hostname){
                    fingerprint = systemInfo.cloudId ?? systemInfo.hostname
                }
                //Use the hub's information to generate the fingerprint
                else if (systemInfo.wifiMac || systemInfo.ethernetMac){
                    let mac = systemInfo.wifiMac ?? systemInfo.ethernetMac;
                    fingerprint = createHash("sha256").update(mac).digest("base64");
                }
            }
            //Fallback to use uuid if system info is not available
            else
                fingerprint = uuid.v4();

            await homey.settings.set("fingerprint", fingerprint);
        }
        return fingerprint;
    },
    async checkAndMigrate({homey}){
        return executeMigration({homey})
    }
}