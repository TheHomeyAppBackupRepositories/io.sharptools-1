const Settings = require("./Settings");
const {createLogger} = require('./Logger');
const DEFAULT_ATTRIBUTES = ["friendly_name", "device_class", "unit_of_measurement"];
const Homey = require("./HomeyUtils");
const Config = require("./Config");


let status = {
    locationSync: "idle",
}
let logger;

let initLogger = ({homey}) => {
    //if we don't already have a logger instance, initialize it
    if(!logger && homey != null)
        logger = createLogger({homey});
}

let requestDeviceSync = ({homey, stioSocket}) => {
    initLogger({homey});
    //Request the SharpTools.io to start the device sync process;
    let event = {
        platform: "homey",
        data:{
            source: "CUSTOM",
            value: "APP_UPDATED"
        }
    }
    //Set the device sync flag
    status.locationSync = "inProgress"; //Will be set to "completed" when receive sync completed event from stio.
    try {
        logger.info('Send APP_UPDATE message to SharpTools.io');
        return stioSocket.emit("state_changed", event, (response) => {
            logger.debug('APP_UPDATE was received and queued in SharpTools.io');
            return homey.api.realtime("stio.socket.emit", "APP_UPDATE");
        });
    }
    catch(err){
        logger.error(`Failed to emit APP_UPDATE event to SharpTools.io. ${err.message}`,);
        return homey.api.realtime("stio.socket.error", "APP_UPDATE");
    }
}

let convertStateChangeEvent = async ({eventData, homey}) =>{
    initLogger({homey});
    let convertedEvent;
    let entityId = eventData.entity_id;
    if (entityId){
        //Check the entity's subscribed state/attributes info
        let entitySubscription = await Settings.getEntitySubscriptions(entityId);
        if (entitySubscription) {
            //Grab the information needed but not in the state_changed event
            convertedEvent ={
                new_state: eventData.new_state
            };
            //Is state changed?
            if (eventData.old_state.state !== eventData.new_state.state) {
                //TODO: to verify if this is true!!
                //Is the "state" subscribed?
                if (entitySubscription.state && entitySubscription.state.type === "state" && entitySubscription.state.subscribed) {
                    //If "state" property is changed, we can skip the rest of the attribute changes
                    Object.entries(eventData.new_state.attributes).forEach(([key, value]) => {
                        // Delete the non-default attributes5
                        if (!DEFAULT_ATTRIBUTES.includes(key))
                            delete convertedEvent.new_state.attributes[key];
                    });
                }
            } else {
                delete convertedEvent.new_state.state;
                //TODO: do we need to check from the old_state side too?
                for (let [attr,value] of Object.entries(eventData.new_state.attributes)){
                    if (DEFAULT_ATTRIBUTES.includes(attr)){
                        //Do nothing
                    }
                    else {
                        //TODO: is there a better way to compare here?
                        //Was the attribute's value changed
                        if (JSON.stringify(value) !== JSON.stringify(eventData.old_state.attributes[attr])) {
                            //Remove the unsubscribed attributes
                            if (entitySubscription[attr] == null || !entitySubscription[attr].subscribed){
                                logger.debug(`Removed ${attr} attribute from entity (${entityId}) event because it is not subscribed.`)
                                delete convertedEvent.new_state.attributes[attr];
                            }
                            //Media_player's entity image can be a relative URL, which proxy through the hub, so we need to attach the hub ip and port
                            if (attr === "entity_picture" || attr === "media_image_url") {
                                let imgUrl = convertedEvent.new_state.attributes[attr];
                                //If the URL is a relative URL, it is meant to be proxy through the Home Assistant hub
                                if (imgUrl && imgUrl.length > 0 && imgUrl.indexOf("http") < 0 && imgUrl[0] === "/") {
                                    let baseUrl = Config.HASS_REST_URL;
                                    convertedEvent.new_state.attributes[attr] = baseUrl + imgUrl;
                                }
                            }
                        } else {
                            delete convertedEvent.new_state.attributes[attr];
                        }
                    }
                }
            }
        }
    }
    return convertedEvent;
}

let convertCommand = async ({command, homey}) =>{
    initLogger({homey})
    //Climate set_temperature service needs both high and low temperature
    if (command.data.domain === "climate" && command.data.service === "set_temperature"){
        let states = await hassManager.getStates();
        if (Array.isArray(states)) {
            let targetEntity = states.find(s => s.entity_id === command.entityId)
            if (targetEntity && targetEntity.attributes) {
                if (command && command.data && command.data.serviceData){
                    if (!command.data.serviceData.hasOwnProperty("target_temp_high"))
                        command.data.serviceData.target_temp_high = targetEntity.attributes.target_temp_high
                    else if (!command.data.serviceData.hasOwnProperty("target_temp_low"))
                        command.data.serviceData.target_temp_low = targetEntity.attributes.target_temp_low
                }
            }
        }
    }
    return command;
}

let filterUnauthorizedSubscriptions = async (subscriptionData, homey) => {
    //Remove the unauthorized entities from the subscription request
    for (let [fullId, data] of Object.entries(subscriptionData)){
        let [id, type] = fullId.split("|");
        let deviceId = type == null && id
        let userId = type === "user" && id

        let isAuthorizedDevice = deviceId && await Settings.isDeviceAuthorized({homey, deviceId})
        let isAuthorizedUser = userId && await Settings.isUserAuthorized({homey, userId})
        
        //if it's not an authorized user or device
        if (!isAuthorizedDevice && !isAuthorizedUser){
            delete subscriptionData[deviceId];
        }
    }
    return subscriptionData;
}

let injectDeviceMetadata = (device, customCapabilities, selections) => {
    if(customCapabilities == null || selections == null)
        return;

    if(device.id in customCapabilities){
        //loop through the device capabilities object and inject 
        for(let cap of Object.keys(device.capabilitiesObj ?? {})){
            if(cap in customCapabilities[device.id]){
                device.capabilitiesObj[cap].__isCustom = true;
                device.capabilitiesObj[cap].__stAttributes = customCapabilities[device.id][cap];
            }
        }
        //also map it at the top-level for convenience
        if(device.metadata == null) device.metadata = {}
        device.metadata.customCapabilities = customCapabilities[device.id]
    }

    //we already know the parent device is in the authorizations, but we 
    // want to inject metadata for the subcapability (children) authorizations
    let children = selections[device.id]?.children ?? {}
    for(let cap of Object.values(device.capabilitiesObj ?? {})){
        let [mainCapability, subIdentifier] = cap.id.split(".")
        //if we have a subidentifier and it's in our list of authorized children (and is explcitly authorized)
        if(subIdentifier != null && children[subIdentifier] === true)
            cap.__authorized = true; //inject the relevant authorization metadata
    }
}

//given a user (from Homey getUsers object), convert it to a 'thing'
let convertUserToThing = (user) => {
    let thing = {
        id: `${user.id}|user`, //postfix with pipe splitter (colon is used for subcapabilities already)
        name: user.name ?? `Unknown User ${user.id}`,
        capabilities: [],
        capabilitiesObj: {},
    }

    let addCapability = (id, value) => {
        thing.capabilities.push(id);
        thing.capabilitiesObj[id] = {
            "id": id,
            "type":typeof(value),
            "iconObj": null,
            "title": id.split("_")[1], //presence or sleep (not used)
            "getable":true,
            "setable":false,
            "insightsTitleTrue": "",
            "insightsTitleFalse": "",
            "units": null,
            "value": value,
            "lastUpdated": Date.now(), //the timestamp isn't stored for presence/sleep on the user object
        }
    }

    addCapability("$user_present", user.present)
    addCapability("$user_asleep", user.asleep) //will get inverted to sleepSensor:sleeping = 'sleeping' | 'not sleeping' server side

    return thing;
}

//Process the command sent from SharpTools.io
let commandHandler = async (command, homey, options={}) =>{
    initLogger({homey})
    logger.debug(`Received command. ${JSON.stringify(command)}`);
    let returnData = {success: false};
    if (["send_command", "call_service"].includes(command?.type)) {
        let deviceId = command.deviceId;
        let entries = []

        //if it's an array, use it directly
        if(Array.isArray(command.data))
            entries = command.data
        //otherwise add it to the array
        else
            entries.push(command.data ?? {})

        //if the device isn't authorized, skip the command(s)
        let isDeviceAuthorized = await Settings.isDeviceAuthorized({homey, deviceId});
        if (!isDeviceAuthorized){
            logger.debug(`Command to device ${deviceId} is ignored because this device is not authorized. Please verify the device authorization.`);
            return returnData; //return early
        }

        let promises = [];

        for(let entry of entries){
            let {capability, value} = entry;
            if (deviceId && capability && value != undefined) {
                //send the command
                let p = Homey.sendCommand({homey, deviceId, capability, value});
                promises.push(p);
            } else
                logger.warn(`Received invalid send_command command format.`)
        }

        let results = await Promise.all(promises)
        returnData = {success: true}
    }
    else if (["get_device", "get_entity", "get_thing"].includes(command?.type)) {
        let deviceId = command.data?.deviceId;

        let selections = (await Settings.get({key: "selectedThings", homey})) ?? {};

        let customCapabilities = (await Settings.get({key: "customCapabilities", homey})) ?? {}

        if (selections[deviceId]?.authorized === true){
            let device = await Homey.getDevice({homey, deviceId});

            //if we got a valid device
            if (device){
                //inject the relevant metadata
                injectDeviceMetadata(device, customCapabilities, selections)

                //and return the formatted message
                returnData = {success: true, data: device};
            }
                
        }
    }
    else if (["get_devices", "get_entities", "get_things"].includes(command?.type)) {
        let deviceMap = await Homey.getDevices({homey})
        //Filter out non-authorized entities
        let selections = (await Settings.get({key: "selectedThings", homey})) ?? {}
        // let selectionMap = selectedIds.reduce((obj, key) => ({...obj, [key]: {} }), {}) //convert the array into an object for faster future references

        let customCapabilities = (await Settings.get({key: "customCapabilities", homey})) ?? {}

        let userMap = await Homey.getUsers({homey});
        let selectedUsers = (await Settings.get({key: "selectedUsers", homey})) ?? {}

        //loop through them, filter to ones we care about, and register event listeners
        let authorizedDevices = [];
        for(let device of Object.values(deviceMap)){
            if (selections[device.id]?.authorized === true){
                //inject the relevant metadata
                injectDeviceMetadata(device, customCapabilities, selections)
                
                //and add it to our authorized devices list
                authorizedDevices.push(device);
            }
        }

        //handle users as 'Things' (eg. for presence status)
        for(let user of Object.values(userMap)){
            //if it's a 'user' that has been selected
            if(selectedUsers[user.id] === true){
                //convert it to a 'thing'
                let userThing = convertUserToThing(user)
                authorizedDevices.push(userThing)
            }
        }
        
        //Consolidate the states and supported services to each entity's object
        returnData = {success: true, data: authorizedDevices};
    }
    else if (command?.type === "get_subscriptions") {
        let allSubscriptions = await Settings.getEventSubscriptions({homey});
        let filteredSubscriptionData = await filterUnauthorizedSubscriptions(allSubscriptions, homey);
        returnData = {success: true, data: filteredSubscriptionData};
    }
    else if (["add_subscriptions", "remove_subscriptions"].includes(command?.type)) {
        //TODO add mutex alike lock
        if (command.data) {
            //get the list of authorized deviceIds
            let selectedThings = (await homey.settings.get("selectedThings")) ?? {};
            let selectedUsers = (await homey.settings.get("selectedUsers")) ?? {};

            let filteredSubscriptionData = Array.isArray(command.data) ? command.data.filter(subscription => {
                let [id, type] = subscription.deviceId.split("|");
                return selectedThings[id]?.authorized === true || selectedUsers[id] === true;
            }) : [];
            let action = command.type === "add_subscriptions" ? "add" : "remove";

            await Settings.updateEventSubscriptions({homey, subscriptions: filteredSubscriptionData, action});
        }
        returnData = {success: true};
    }
    else if(command.type === "send_location_command"){
        if(["triggerFlow", "triggerAdvancedFlow"].includes(command.data?.command)){
            await Homey.sendFlowCommand({homey, ...command.data}) //command, payload: {id}
            returnData = {success: true}
        }
    }
    else if(command.type === "get_location_property"){
        if(command.data?.property === "flows"){
            let flows = await Homey.getFlows({homey})
            returnData = {success: true, data: flows}
        }
    }
    else if (command.type === "get_event_url") {
        //TODO add mutex alike lock
        let url = await Settings.getSocketUrl({homey});
        returnData = {success: true, url};
    }
    else if (command && command.type === "set_event_url") {
        let {init, disconnect} = options; //The passed in socket init and disconnect functions
        //TODO add mutex alike lock
        let url = command.data;
        //Save the new socket (event) url
        await Settings.setSocketUrl(url); //no-op
        //Re-init the socket connection
        if (disconnect) disconnect();
        if (init) await init();
        returnData = {success: true};
    }
    return returnData;
}

//Filter the state change events and send to SharpTools.io
let stateChangeHandler = async ({event, homey, socket}) =>{
    initLogger({homey})
    try {
        if (event?.deviceId) {
            let [id, type] = event.deviceId.split("|")
            let deviceId = type == null && id || undefined;
            let userId = type === "user" && id

            logger.info(`Received state_changed event for ${deviceId ?? userId} from Homey.`)
            // logger.debug(`Received state_changed event ${JSON.stringify(event)}`);
            let isAuthorizedDevice = !!deviceId && await Settings.isDeviceAuthorized({homey, deviceId})
            let isAuthorizedUser = !!userId && await Settings.isUserAuthorized({homey, userId})
            //Is the event belongs to an authorized entity?
            if (isAuthorizedDevice || isAuthorizedUser) {
                logger.info(`Sending ${deviceId ?? userId}'s state change event to SharpTools.io`)
                socket.emit("state_changed", event);
            } 
            else {
                //debug- the entity is not authorized
            }
        } else {
            //error
        }
    }
    catch (err){
        logger.error(`Failed to process the state change event.`, event, err)
    }
};

module.exports = {commandHandler, stateChangeHandler, requestDeviceSync, status};