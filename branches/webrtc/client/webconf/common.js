function $(id) {
    return document.getElementById(id);
}

function log(msg) {
    if (typeof console != "undefined" && typeof console.log != "undefined") 
        console.log(msg);
}

function sanitize(data) {
    return data.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function replaceLinks(text) {
	var exp = /(\b(https?):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
	return text.replace(exp,"<a href='$1' target='_blank'>$1</a>"); 
}

function get_query_param(variable, default_value) { 
    var query = window.location.search.substring(1);
    if (query.charAt(query.length-1) == "/") {
        query = query.substring(0, query.length-1);
    }
    var vars = query.split("&"); 
    for (var i=0;i<vars.length;i++) { 
        var pair = vars[i].split("="); 
        if (pair[0] == variable) { 
            return unescape(pair[1].replace(/\+/g, " "));; 
        } 
    }
    return default_value == undefined ? null : default_value;
}

