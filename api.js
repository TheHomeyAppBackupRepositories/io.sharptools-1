const axios = require("axios");
const PkceChallenge = require('./lib/PkceChallenge');
const Config = require("./lib/Config");
const StioSocket = require("./lib/StioSocket");
const StioUtils = require("./lib/StioUtils")
const HomeyUtils = require("./lib/HomeyUtils");

//stored in memory for simplicity
let storedPkce = {}
let channels = [];

const DEFAULT_TIMEOUT = 60 * 5; // 5 minutes
const DEFAULT_TYPE = "auth_code";
const MAX_COUNT = 100;

let storeMessageChannel = ({messageType, channelId, timeout=DEFAULT_TIMEOUT, ignoreIfTypeExists=true}) => {
    if(ignoreIfTypeExists){
        let existingChannel = channels.find(ch => ch.messageType === messageType);
        if (existingChannel)
            return {success: true, message: `Ignored. Existing channel found for type: ${messageType}`};
    }
    let channel = {
        messageType,
        id: channelId,
        expiresOn: Date.now() + timeout * 1000,
        createdOn: Date.now()
    }
    channels.push(channel);
    return {success: true}
}

module.exports = {
    //system
    async getSystemInfo({homey}){
        let api = homey.app.homeyApi;
        //some information is only available via the API, so let's use it
        let systemInfo = await api.system.getInfo()
        let systemName = await api.system.getSystemName();
        
        let fingerprint = await HomeyUtils.getFingerprint({homey, systemInfo});

        let localAddress = await homey.cloud.getLocalAddress()
        let localUrl = await homey.api.getLocalUrl()

        return {...systemInfo, systemName, fingerprint, stExtra: { localAddress, localUrl}}
    },
    async generateSystemDiagnostics({homey}){
        //generate the diagnostics content
        homey.app.log('Generating system diagnostics')
        //list of devices
        let devices = await this.getDevices({homey});
        //eventSubscriptions
        let subscriptions = await homey.settings.get("eventSubscriptions");
        //system info
        let systemInfo = await this.getSystemInfo({homey})
        //future: 'custom' capability elections
        let content = {
            devices,
            subscriptions,
            systemInfo
        }

        let key;
        let error;
        
        //upload the content
        try {
            let response = await axios.post(Config.LABS_URL + "/diagnostics", content)
            key = response.data?.key;
        } catch (err) {
            homey.app.error('Unable to write diagnostic file: ' + err.message)
            error = {message: err.message, code: err.response?.status};

            if(err.response?.status === 413){
                homey.app.error(`PayloadTooLarge: ${Buffer.from(JSON.stringify(content)).length} bytes`)
            }
        }
        return {key, error}
    },
    //general
    async getConnectionSettings({homey}){
        return Config
    },
    async getConnectionStatus({homey, query, body, params}){
        //check if the socket is connected
        return {
            "homey": true,
            "sharptools": StioSocket.isConnected(),
        }
    },
    //use the API to get ALL the things and return it as a JSON response
    async getDevices({homey, query, body, params}){
        homey.app.log("getDevices() called")
        
        //we initialized a HomeyAPIApp into the property 'homeyApi' when the app was initialized, so we can reference it here
        //alias it to api for simpler reference
        let api = homey.app.homeyApi;
        
        //get the list of devices
        let devices = await api.devices.getDevices()
        // console.log('devices', devices)

        //return those directly - let the frontend have the raw data and it can remap it accordingly
        return devices;
    },
    async getFlows({homey, query, body, params}){
        homey.app.log("getFlows() called")
        
        //get the combined flows
        return HomeyUtils.getFlows({homey});
    },
    async getUsers({homey, query, body, params}){
        homey.app.log("getUsers() called")
        
        //get the combined flows
        return HomeyUtils.getUsers({homey});
    },
    async generateCodeChallenge({homey, query, body, params}){
        homey.app.log('Generating PKCE challenge for SharpTools.io authorization process.')
        storedPkce = PkceChallenge()
        return {success: true, code_challenge: storedPkce.code_challenge}
    },
    async swapToken({homey, query, body, params}){
        //get the body parameters
        let {code, platform="homey", location_id, fingerprint } = body;
        homey.app.log('Received request to swap SharpTools.io OAuth code for token.')

        //get the code_verifier based on the code_challenge
        let {code_challenge, code_verifier } = storedPkce;
        if(code_challenge == null || code_verifier == null){
            homey.app.error('Missing code_challenge. Aborting OAuth token swap.')
            return {success: false, error: "Missing code challenge. Retry the authorization process."}
        }
        //attempt to swap the token
        let url = `${Config.STIO_API_URL}/oauth/token`;
        let response;
        try{
            response = await axios.post(url,{client_id: Config.CLIENT_ID, code, platform, location_id, fingerprint, code_verifier})
        }catch(error){
            homey.app.error(`Unable to swap code ${code} for ${platform} location ${location_id} with code_verifier ${code_verifier}`, error)
            return {success: false}
        }
        let {uid, token} = response.data;

        //store the settings
        homey.app.log('Updating stored settings.')
        if (uid) homey.settings.set('uid', uid)
        if (token) homey.settings.set('token', token)
        if (location_id) homey.settings.set('locationId', location_id)

        //initialize the websocket
        homey.app.log('Initializing SharpTools.io websocket')
        let isInitialized = false;
        try{
            isInitialized = await StioSocket.init({homey});
        }catch(error){
            let errorMessage = `Failed to connect to SharpTools.io through websocket after received apikey.`;
            homey.app.error(errorMessage, error);
            return {success: false, error: errorMessage};
        }
        if (isInitialized) {
            //TODO: why isn't this automatic within StioSocket based on the connect event?
            homey.app.log("Setup state_changed event handler.")
            //Add the state change event handler
            await HomeyUtils.registerChangeListener({homey, callback: StioUtils.stateChangeHandler, socket: StioSocket});
        }
        return {success: true};
    },
    requestDeviceSync({homey}){
        StioUtils.requestDeviceSync({homey, stioSocket: StioSocket});
    },

    /*
     *  MESSAGE CHANNELS
     */
    async createMessageChannel({homey, body}){
        homey.app.log('Request to create a communication channel for oauth code.')
        let url = `${Config.STIO_API_URL}/api/v3/channel`;
        let {type} = body;
        try{
            let data ={
                type: type == null ? "store" : type,
            }
            let response = await axios.post(url, data);
            homey.app.log(`Received communication channel creation response. ${JSON.stringify(response?.data)}`);
            if (response?.data?.type === data.type && response?.data?.channelId != null){
                storeMessageChannel({messageType: type, channelId: response.data.channelId})
                return {success: true, channelId: response.data.channelId};
            }
        }catch(error){
            homey.app.error(`Communication channel creation failed.`, error)
            return {success: false}
        }
    },
    async getMessageFromChannel({homey, query, body, params}){
        let {id} = params;
        let {type="store"} = query;
        homey.app.log(`Retrieve data through channel ${id}`);
        let url = `${Config.STIO_API_URL}/api/v3/channel/${id}/message?type=${type}`;
        try{
            let response = await axios.get(url);
            homey.app.log(`Received auth code request response.  ${JSON.stringify(response?.data)}`);
            if (response?.data?.success)
                return {success: true, messages: response.data.message};
            else {
                return {success: false, error: response?.data?.error ?? 'Unknown Error'};
            }
        }catch(error){
            let errMessage = `Failed to get auth code from channel.`
            homey.app.error(errMessage, error)
            return {success: false, error: errMessage};
        }

    },
    setMessageChannel({homey, query, body, params}){
        //TODO: support storing multiple ids in one call?
        let {channelId, messageType, timeout, ignoreIfTypeExist } = body;
        if (channels.length > MAX_COUNT)
            return {success: false, error: `Max number of channels is reached.`}
        if (!channelId)
            return {success: false, error: `Invalid channelId`}
        if (timeout == null)
            timeout = DEFAULT_TIMEOUT;
        if (messageType == null)
            messageType = DEFAULT_TYPE;
        if (ignoreIfTypeExist == null)
            ignoreIfTypeExist = true;
        return storeMessageChannel({type: messageType, id: channelId, timeout})
        // return {success: true};
    },
    getMessageChannels({homey, query, body, params}){
        let {messageType, newestOnly} = query;
        if (messageType == null)
            messageType = DEFAULT_TYPE;
        if (newestOnly == null)
            newestOnly = true; //Default to get the newest one for the same type
        //Always clear the expired channel ids
        channels = channels.filter(ch => ch.expiresOn > Date.now());
        //Get the specific type of channel
        let filteredChs = channels.filter(ch => ch.messageType === messageType);
        if (newestOnly && filteredChs.length > 0){
            filteredChs = [filteredChs.reduce((prev, curr)=> prev.createdOn > curr.createdOn ? prev : curr)];
        }
        return {success: true, channels: filteredChs};
    },
    deleteMessageChannel({homey, params}){
        let {id} = params;
        //remove the specific channel id
        channels = channels.filter(ch => ch.id !== id);
        return {success: true};
    }
}