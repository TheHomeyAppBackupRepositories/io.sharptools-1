const migrateSelectedThingsFromArrayToMap = async ({homey}) => {
    let selectedThings = await homey.settings.get("selectedThings")
    //if it's an array, do the migrations
    if(Array.isArray(selectedThings)){
        //if the array has items
        if(selectedThings.length > 0){
            //and they are all strings (thing IDs)
            let newMap = {};
            for(let thingId of selectedThings){
                if(typeof thingId === "string"){
                    newMap[thingId] = {authorized: true}
                }
                else{
                    homey.app.log("[WARNING] Conversion of Selected Things encountered a non-string item. Skipping item.")
                }
            }
            return homey.settings.set("selectedThings", newMap);

        }
        //if it's an empty array
        else{
            return homey.settings.set("selectedThings", {}) //change it to an empty object
        }
    }
    //otherwise do nothing
}

module.exports = {
    async executeMigration({homey}){
        //for now just do the one migration
        //when we extend this, make sure to perform things in sequence as needed (ideally we should store a schema moving forward)
        return migrateSelectedThingsFromArrayToMap({homey});
    }
}