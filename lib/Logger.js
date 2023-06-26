let app;

module.exports = {
    createLogger({homey}){
        if(!homey){
            throw new Error('Logger Instantiation Failure::Invalid homey reference')
        }
        app = homey.app; //copy the app reference as we'll hold onto it for logging
        
        //return a wrapper for the existing logging code structure
        return {
            info(message){ app.log(message) },
            warn(message){ app.log(message) },
            debug(message){ app.log(message) },
            error(message){ app.log(message) }
        }
    }
}