const io = require('socket.io-client');
const {createLogger} = require('./Logger');
const Stio = require('./StioUtils');
const Settings = require("./Settings");
const Homey = require('./HomeyUtils');

const DEFAULT_TIMEOUT = 60 * 1000;

//singleton placeholders
let socket, logger;

let lastError = null;


//A set of additional socket extensions, helpers, or extra utilities
const TYPE_RESPONSE = 'message_response';

let generateResponseHandler = (socket, messageId) => {
    //return a function that accepts the data and passes the response back
    return (data) =>{
        //add the messageId back into the payload of the response
        data.__messageId = messageId;
        socket.emit(TYPE_RESPONSE, data)
    }

}

//TODO: add error handling
//TODO: log error/debug messages based on the log level setting. Add timestamp to the log
let init = async ({homey}) => {
    //create the logger that we'll continue to reference moving forward
    logger = createLogger({homey});

    let {uid, locationId, apiKey, stioWsUrl} = await Settings.getSocketConfig({homey});
    // let uid = await Settings.getUid();
    // let locationId = await Settings.getLocationId();
    // let apiKey = await Settings.getApikey();
    // let stioWsUrl = await Settings.getSocketUrl()

    let initialized = false;
    //Do we have the data we need before establishing the connection to SharpTools?
    if (uid && locationId && apiKey && stioWsUrl) {
        let hubInfo = await Homey.getHubInfo({homey});
        logger.info(`addon version: ${hubInfo.metadata.appVersion}`)
        let stioHeaderJsonString = JSON.stringify({
            platform: "homey", uid, locationId,
            smartappVersion: hubInfo.metadata.appVersion,
            metadata: {
                // supervisor: hubInfo.metadata.supervisor,
                systemVersion: hubInfo.metadata.systemVersion,
                platform: hubInfo.metadata.platform,
                sdk: hubInfo.metadata.sdk,
            }
        })


        //if there's already a socket, disconnect and destroy it
        if(socket){
            logger.info(`Disconnecting previously connected socket instance (${socket.id})`)
            socket.disconnect();
        }
        //Init the socket connection to SharpTools
        logger.info("Establishing socket connection to SharpTools.");
        socket = io(stioWsUrl, {
            transports: ["websocket"],
            reconnectionDelay: 100, //100ms + random factor
            randomizationFactor: 0.25,
            timeout: 10000,
            reconnectionDelayMax: 10000,
            extraHeaders: {
                "authorization": `apikey ${apiKey}`,
                "x-sharptools-metadata": Buffer.from(stioHeaderJsonString, 'utf8').toString('base64')
            }
        });

        logger.info("Setup the SharpTools' socket message handlers")
        socket.on('connect', (data) => {
            logger.info(`SharpTools socket connection is established (${socket.id}).`)
            //Send an "App Update" event?
            homey.api.realtime("stio.socket.status", "connected")
            //clear out the last error
            lastError = null;
        });

        socket.on('disconnect', (data) => {
            logger.info(`SharpTools socket is disconnected.`)
            logger.debug(data);
        });

        socket.on('command', (data) => {
            let commandType = data && data.type;
            logger.info(`Received command ${commandType} from SharpTools.io.`);
            //strip the __messageId off and leave the payload to pass forward
            let {__messageId, ...payload} = data;
            let responseHandler  = generateResponseHandler(socket, __messageId);
            Stio.commandHandler(payload, homey, {init, disconnect}).then(responseHandler).catch((err) => {
                logger.error(`Error with command '${err.message}' ${JSON.stringify(data)}`,)
            });
        });

        socket.on('update_settings', (data={}) => {
            logger.info(`Received update_settings event from SharpTools.io.`);
            //loop through each of the top level keys
            for(let [key, value] of Object.entries(data)){
                //and set the related setting based on that top-level object key name
                logger.info(` ▸ Updating setting: ${key}`);
                homey.settings.set(key, value);
            }
        });

        socket.on('location_sync_completed', (data) => {
            logger.info(`Received location_sync_completed event from SharpTools.io.`);
            homey.api.realtime("stio.socket.message", "location_sync_completed").then(()=>{
                logger.info('emitted stio.socket.message=location_sync_completed')
            }) //ignore promise result
            Stio.status.locationSync = "completed";
            setTimeout(()=>{
                //if the status is still completed, change it to idle
                if(Stio.status.locationSync === "completed"){
                    Stio.status.locationSync = "idle";
                }
            }, 6000); //6 seconds (just past the refresh interval client side)
        });

        socket.on("connect_error", (error) => {
            logger.error(`SharpTools socket connect_error: ${error.message}`);
            //TODO add the reconnect mechanism but in some cases like EndPointNotFound, we will not want to retry.
            homey.api.realtime("stio.socket.status", "disconnected")
            lastError = error;
        });
        initialized = true;
    }
    return initialized;
}

let asyncEmit = (eventType, payload, callback, {timeout=DEFAULT_TIMEOUT}={}) => {
    return new Promise((resolve, reject) => {
        //setup the timeout (including a flag as a double check that it wasn't already called)
        let isCalled = false;
        let timer = setTimeout(()=> isCalled ? undefined : reject(), timeout);

        let promisifiedCallback = (...args) =>{
            //if it was already called, then bail out
            if (isCalled) return;

            //otherwise flag it as run and clear the timeout
            isCalled = true; //flag this as called for the timer
            clearTimeout(timer); //clear the timer

            //could try/catch the callback and determine if we should resolve or reject
            try {
                return resolve(callback(...args));
            }catch(error){
                logger.error(`Error in asyncEmit from ${eventType} with message ${error.message}`, error)
                return reject(error);
            }
        }
        socket.emit(eventType, payload, promisifiedCallback)
    });
}

const emit = (eventType, payload, callback) =>{
    if(callback){
        return asyncEmit(eventType, payload, callback);
    }
    else {
        socket.emit(eventType, payload);
    }
}

const disconnect = () =>{
    if (socket)
        socket.disconnect();
}

module.exports = {
    init, emit, disconnect,
    isConnected(){
        return socket && socket.connected;
    },
    getLastError(){
        return lastError;
    }
}