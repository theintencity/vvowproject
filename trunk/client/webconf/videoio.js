function getFlashMovie(movieName) {
    var isIE = navigator.appName.indexOf("Microsoft") != -1;
    return (isIE) ? window[movieName] : document[movieName];  
}
 
function onCreationComplete(event) {
    if (event.objectID == "privacy") {
        getFlashMovie(event.objectID).callProperty("showSettings");
    } else if (event.objectID == ("video-" + room.user_id)) {
        // set our video stream
        var stream_url = "rtmfp://stratus.rtmfp.net/d1e1e5b3f17e90eb35d244fd-c711881365d9/"
                            + "?publish=" + room.stream;
        getFlashMovie(event.objectID).setProperty("src", stream_url);
    } else if (event.objectID.substr(0, 6) == "video-") {
        room.on_video_stream_created(event.objectID.substr(6), null);
    }
}
 
function onPropertyChange(event) {
    if (event.property == "nearID" && event.newValue != null) {
        if (event.objectID == ("video-" + room.user_id)) {
            var stream_url = "rtmfp://stratus.rtmfp.net/d1e1e5b3f17e90eb35d244fd-c711881365d9/"
                            + "?play=" + room.stream + "&farID=" + event.newValue;
            room.on_video_stream_created(event.objectID.substr(6), stream_url);
        }
    }
}

