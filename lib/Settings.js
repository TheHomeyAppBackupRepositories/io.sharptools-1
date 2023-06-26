const { all } = require("axios");
const Config = require("./Config")

module.exports = {
    async getSocketConfig({homey}){
        //return at least the Socket Init features        
        return {
            uid: await homey.settings.get('uid'), 
            locationId: await homey.settings.get('locationId'), 
            apiKey: await homey.settings.get('token'), 
            stioWsUrl: Config.STIO_WS_URL
        }
    },
    async get({key, homey}){
        return homey.settings.get(key);
    },
    async getEventSubscriptions({homey}){
        return homey.settings.get("eventSubscriptions") ?? {};
    },
    async updateEventSubscriptions({homey, subscriptions, action}){
        let allSubscriptions = await this.getEventSubscriptions({homey});
        if(action === "add"){
            //layer in our new subscriptions
            for(let {deviceId, capability, stAttribute, stCapability} of subscriptions){
                //make sure we have the device branch
                if(!allSubscriptions.hasOwnProperty(deviceId))
                    allSubscriptions[deviceId] = {}
                
                //make sure we have the capability branch
                if(!allSubscriptions[deviceId].hasOwnProperty(capability))
                    allSubscriptions[deviceId][capability] = {subscribed: true, stAttribute, stCapability}
                else //it already exists... make sure it's still marked as subscribed
                    allSubscriptions[deviceId][capability].subscribed = true;
            }
        }
        else if (action === "remove"){
            //pop off the requested subscriptions
            for(let {deviceId, capability, stAttribute, stCapability} of subscriptions){
                //make sure we have the device branch
                if(!allSubscriptions.hasOwnProperty(deviceId))
                    continue; //we're good as it doesn't exist
                
                //make sure we have the capability branch
                if(!allSubscriptions[deviceId].hasOwnProperty(capability))
                    continue; //we're good as it doesn't exist
                else{ //it exists - remove it
                    delete allSubscriptions[deviceId][capability];
                    //if there aren't any keys left on the device, remove that branch too
                    if(Object.keys(allSubscriptions[deviceId]).length === 0)
                        delete allSubscriptions[deviceId]
                }
            }
        }
        
        //store it
        await homey.settings.set("eventSubscriptions", allSubscriptions);

        return allSubscriptions;
    },
    async getSocketUrl({homey}){
        return Config.STIO_WS_URL;
    },
    async setSocketUrl({homey, url}){
        return; //no-op
    },
    async isDeviceAuthorized({homey, deviceId}){
        let selections = (await homey.settings.get("selectedThings")) ?? {}
        return selections[deviceId]?.authorized === true;
    },
    async isUserAuthorized({homey, userId}){
        //if it still has the trailing |user, pop that off
        userId = userId.replace("|user", "")
        let selectedUsers = (await homey.settings.get("selectedUsers")) ?? {}
        return selectedUsers[userId] === true;
    }
}