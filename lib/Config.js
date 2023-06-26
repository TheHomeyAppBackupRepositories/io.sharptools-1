let GLOBAL_CONSTANTS = require("./constants.json");
// process.env.DEBUG = '1' //force debug mode
// process.env.DEBUG = '0' //force normal
process.env.NODE_ENV = process.env.DEBUG === '1' ? "DEV" : "production";

const ENV = getEnvironment();
console.log(`Using environment: ${ENV} based on NODE_ENV ${process.env.NODE_ENV}`);
console.log(`DEBUG environment variable is ${process.env.DEBUG === '1'}`)
const CONST = GLOBAL_CONSTANTS[ENV];

function getEnvironment(){
    switch(process.env.NODE_ENV){
        case "DEV":
            return "development";
        case "TEST":
            return "test";
        case "production":
        case "PROD":
        case "PRODUCTION":
        default:
            return "production";
    }
}

//System and DEV Variables
module.exports = {
    ENV: ENV,
    CLIENT_ID: CONST["CLIENT_ID"],
    FRONTEND_PUBLIC_PATH: "/",
    STIO_FRONTEND_URL: CONST["STIO_FRONTEND_URL"],
    STIO_API_URL: CONST["STIO_API_PROTOCOL"] + CONST["STIO_API_HOST"],
    STIO_WS_URL: CONST["STIO_WS_PROTOCOL"] + CONST["STIO_API_HOST"],
    LABS_URL: CONST["STIO_LABS_URL"]
};