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

var hasVersion10 = DetectFlashVer(10, 0, 0);
var hasVersion10_3 = DetectFlashVer(10, 3, 0);
var VideoIO = (hasVersion10_3 ? "VideoIO45.swf" : (hasVersion10 ? "VideoIO.swf" : null));

function getVideoIO(id, flashVars, width, height, bgcolor, wmode) {
    if (width == undefined)
        width = '100%';
    if (height == undefined)
        height = '100%';
    if (flashVars == undefined)
        flashVars = '';
    if (bgcolor == undefined)
        bgcolor = '#000000';
    if (wmode == undefined)
        wmode = 'window';
    return '<object classid="clsid:D27CDB6E-AE6D-11cf-96B8-444553540000"\
    id="' + id + '" width="' + width + '" height="' + height + '"\
    codebase="http://fpdownload.macromedia.com/get/flashplayer/current/swflash.cab">\
    <param name="movie" value="' + VideoIO + '" />\
    <param name="quality" value="high" />\
    <param name="bgcolor" value="' + bgcolor + '" />\
    <param name="flashVars" value="' + flashVars + '" />\
    <param name="allowFullScreen" value="true" />\
    <param name="allowScriptAccess" value="always" />\
    <param name="wmode" value="' + wmode + '" />\
    <embed src="' + VideoIO + '" bgcolor="' + bgcolor + '"\
        width="' + width + '" height="' + height + '" name="' + id + '" align="middle"\
        play="true" loop="false" quality="high"\
        flashVars="' + flashVars + '"\
        allowFullScreen="true" allowScriptAccess="always" wmode="' + wmode +'"\
        type="application/x-shockwave-flash"\n\
        pluginspage="http://www.adobe.com/go/getflashplayer">\
        </embed>\
    </object>';
}
