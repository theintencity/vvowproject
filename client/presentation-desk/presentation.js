function $(id) {
    return document.getElementById(id);
}

function getFlashMovie(movieName) {
    var isIE = navigator.appName.indexOf("Microsoft") != -1;
    return (isIE) ? window[movieName] : document[movieName];  
}
 
function onCreationComplete(event) {
    if (event.objectID == "video1" && !presentation.is_presenter() && presentation.presenter != null) {
        getFlashMovie("video1").setProperty("src", presentation.presenter.stream_url);
    }
}
 
function onPropertyChange(event) {
    if (event.property == "nearID" && event.newValue != null) {
        if (event.objectID == "video1") {
            presentation.on_presenter_stream_created(event.newValue);
        } else if (event.objectID == "video2") {
            presentation.on_viewer_stream_created(event.newValue);
        }
    }
}

var presentation = {
    // the room id we are connected to. Default is "public"
    room: null,
    
    // the websocket address to connect to
    websocket_url: "ws://127.0.0.1:8080/server.php",
    
    // the web socket to the server
    socket: null,
    
    // this sequence number is used to generate the next message id.
    count: 1,
    
    // pending REST request to the server, which are pending a response.
    // In this table: Key is the msg_id and value is the response callback function.
    pending_request: {},
    
    // the timeout in seconds, for retrying connection, with exponential back-off and limit of 1 minute
    timeout: 125,
    
    // the unique identifier of this user in the /room/{room}/userlist/{id} resource.
    userlist_id: null,
    
    // the nickname used for sending text messages in this room
    nickname: null,
    
    // state: idle, presenter, viewer, viewer_my_video
    state: null,
    
    // the presenter resource if any. It has presenter_url, viewer_url and slides_url
    presenter: null,
    
    // the nearID of the local video stream
    nearID: null,
    
    // the stream name to publish/play
    stream: null,
    
    // presentation slides list if we are presenter
    slides: null,
    
    init: function() {
        this.room = this.get_query_param('room', 'public');
        console.log('room=' + this.room);
        
        try{
            this.socket = new WebSocket(this.websocket_url);
            console.log('websocket.init: status=' + this.socket.readyState);
            presentation.info('connecting...');
            presentation.set_cursor('wait');
            
            this.socket.onopen = function(msg){
                console.log("websocket.onopen: status=" + this.readyState);
                timeout = 125;
                presentation.info('connected to websocket server');
                presentation.set_cursor('auto');
                presentation.set_state("idle");
                presentation.login();
            };
            this.socket.onmessage = function(msg){
                var data = msg.data.replace(/\\\//g, '/');
                if (data.charAt(0) == '\u0000')
                    data = data.substring(1);
                console.log("received: " + data);
                presentation.websocket_received(data);
            };
            this.socket.onclose   = function(msg){
                console.log("websocket.onclose: status=" + this.readyState+ ". reconnecting in " + presentation.timeout/1000.0+" seconds");
                presentation.info('Failed, reconnecting in ' + presentation.timeout / 1000.0 + ' seconds.'
                             + (presentation.timeout < 10000 ? "" :
                                ' Reload page to connect now.'));
                
                setTimeout("presentation.init()", presentation.timeout);
                if (presentation.timeout < 30000) {
                    presentation.timeout *= 2;
                } else {
                    presentation.timeout = 60000;
                }
            };
        }
        catch(ex){
            console.log(ex);
        }
    
        $('inputText').focus();
    },
    
    set_cursor: function(value) {
        $('inputText').style.cursor = value;
        $('chathistory').style.cursor = value;
        $('slides').style.cursor = value;
    },
    
    get_query_param: function(variable, default_value) { 
        var query = window.location.search.substring(1); 
        var vars = query.split("&"); 
        for (var i=0;i<vars.length;i++) { 
            var pair = vars[i].split("="); 
            if (pair[0] == variable) { 
                  return pair[1]; 
            } 
        }
        return default_value == undefined ? null : default_value;
    },
    
    login: function() {
        setTimeout("presentation.subscribe_userlist()", 0);
        setTimeout("presentation.subscribe_chathistory()", 200);
        setTimeout("presentation.post_userlist()", 400);
        setTimeout("presentation.subscribe_presenter()", 600);
        setTimeout("presentation.get_presenter()", 800);
    },
    
    //-------------------------------------------
    // Menu items and state change
    //-------------------------------------------
    
    is_presenter: function() {
        return this.state == 'presenter';
    },
    
    has_my_video: function() {
        return this.state == 'viewer_my_video';
    },
    
    has_other_video: function() {
        return this.presenter != null && this.presenter.viewer_url != null;
    },
    
    set_state: function(value) {
        if (this.state != value) {
            var oldValue = this.state;
            this.state = value;
            if (value == "idle") {
                $("menuitem1").innerHTML = "start presentation";
                $("menuitem1").style.visibility = "visible";
                $("menuitem2").style.visibility = "hidden";
                $("menuitem3").style.visibility = "hidden";
                $("menuitem4").style.visibility = "hidden";
            }
            else if (value == "presenter") {
                $("menuitem1").innerHTML = "stop presentation";
                $("menuitem2").innerHTML = "who is online?";
                $("menuitem3").innerHTML = "share slides";
                $("menuitem1").style.visibility = "visible";
                $("menuitem2").style.visibility = "visible";
                $("menuitem3").style.visibility = "visible";
                $("menuitem4").style.visibility = "hidden";
            } else if (value == "viewer_my_video") {
                $("menuitem1").innerHTML = "stop my video";
                $("menuitem1").style.visibility = "visible";
                $("menuitem2").style.visibility = "hidden";
                $("menuitem3").style.visibility = "hidden";
                $("menuitem4").style.visibility = "hidden";
            } else if (value == "viewer") {
                $("menuitem1").innerHTML = "raise hand";
                $("menuitem1").style.visibility = "visible";
                $("menuitem2").style.visibility = "hidden";
                $("menuitem3").style.visibility = "hidden";
                $("menuitem4").style.visibility = "hidden";
            }

            $("bottombar").style.visibility = (value == "presenter" ? "visible" : "hidden");
            $("slides").onmousemove = (value == "presenter" ? presentation.on_mouse_move : null);
        }
    },
    
    on_menuitem: function(item) {
        if (this.state == "idle") {
            if (item == 1)
                this.start_presentation();
        } else if (this.state == "presenter") {
            if (item == 1)
                this.stop_presentation();
            else if (item == 2)
                this.get_userlist();
            else if (item == 3) {
                var url = window.prompt('Paste the slideshare URL');
                if (url)
                    this.share_slides(url);
            }
        } else if (this.state == "viewer_my_video") {
            if (item == 1)
                this.stop_viewer_video();
            this.set_state("viewer");
        } else if (this.state == "viewer") {
            if (item == 1) {
                if ($("menuitem1").innerHTML == "raise hand") {
                    this.raise_hand(true);
                    $("menuitem1").innerHTML = "unraise hand";
                } else {
                    this.raise_hand(false);
                    $("menuitem1").innerHTML = "raise hand";
                }
            }
        }
    },
    
    //-------------------------------------------
    // Text chat
    //-------------------------------------------
    
    subscribe_chathistory: function() {
        this.websocket_send({"method": "SUBSCRIBE", "resource": "/room/" + this.room + "/chathistory"});
    },

    on_chathistory_update: function(request) {
        if (request.create != null) {
            this.chathistory_append(request.entity.sender + ": " + request.entity.text);
        }
        // chathistory_append(this.color("You", "You") + ": " + msg);
    },
    
    send_message: function(msg) {
        if (this.nickname == null) {
            this.nickname = prompt('Please enter your name to send message');
            if (this.nickname == null)
                return;
        }
        this.websocket_send({
            "method": "POST", "resource": "/room/" + presentation.room + "/chathistory",
            "entity": {"sender": this.nickname, "text": msg, "timestamp": (new Date()).getTime()}},
            function(response) {
                if (response.code != "success") {
                    presentation.info('failed to send your message ' + response.reason);
                }
            });
    },
    
    //-------------------------------------------
    // User list
    //-------------------------------------------
    
    subscribe_userlist: function() {
        this.websocket_send({"method": "SUBSCRIBE", "resource": "/room/" + this.room + "/userlist"});
    },
      
    on_userlist_update: function(request) {
        // got a new user list update
        if (this.is_presenter()) {
            if (request.create != null) {
                this.info("new client connected");
            }
            else if (request['delete'] != null) {
                this.info("an existing client disconnected");
            }
        }
    },
    
    post_userlist: function() {
        this.websocket_send({"method": "POST", "resource": "/room/" + this.room + "/userlist"},
            function(response) {
                if (response.code == "success") {
                    presentation.userlist_id = response.id;
                    presentation.subscribe_my_user();
                } else {
                    presentation.info('login failed ' + response.reason);
                }
            });
    },
    
    subscribe_my_user: function() {
        this.websocket_send({"method": "SUBSCRIBE", "resource": "/room/" + this.room + "/userlist/" + this.userlist_id});
    },
    
    get_userlist: function() {
        if (!this.is_presenter) {
            presentation.warn('must be a presenter to get user list');
        } else {
            this.websocket_send({"method": "GET", "resource": "/room/" + this.room + "/userlist"}, 
                function(response) {
                    if (response.code == "success") {
                        presentation.info(response.entity.length + " user(s) online");
                    }
                });
        }
    },
    
    //-------------------------------------------
    // Presentation
    //-------------------------------------------
    
    subscribe_presenter: function() {
        this.websocket_send({"method": "SUBSCRIBE", "resource": "/room/" + this.room + "/presenter"});
    },
      
    on_presenter_change: function(request) {
        var old = this.presenter;
        this.presenter = request.entity;
        
        if (old == null || this.presenter.slides_url != old.slides_url) {
            this.set_slides_url(this.presenter.slides_url);
        }
        
        if (!this.is_presenter() && (old == null || this.presenter.presenter_url != old.presenter_url)) {
            presentation.info('presenter started.');
            this.set_state("viewer");
            getFlashMovie("video1").setProperty("src", this.presenter.presenter_url);
        }
        
        if (old == null || this.presenter.viewer_url != old.viewer_url) {
            this.on_viewer_video_change();
        }
    },
    
    on_presenter_delete: function(request) {
        this.set_state("idle");
        if (this.presenter != null) {
            presentation.info('presenter stopped.');
            this.presenter = null;
            getFlashMovie("video1").setProperty("src", null);
            this.set_slides_url('');
            this.on_viewer_video_delete();
        }
        if (this.presenter == null && this.presenter_mouse != null) {
           document.getElementsByTagName("body")[0].removeChild(this.presenter_mouse);
           this.presenter_mouse = null;
        }
    },
    
    get_presenter: function() {
        this.websocket_send({"method": "GET", "resource": "/room/" + this.room + "/presenter"},
            function(response) {
                if (response.code == "success") {
                    presentation.on_presenter_change(response);
                }
            });
    },
    
    start_presentation: function() {
        if (this.presenter != null) {
            this.info('someone else is already presenting');
            return false;
        }
        
        this.set_state("presenter");
        
        this.presenter = {"presenter_url": null, "slides_url": null, "viewer_url": null, "viewer_id": null};
        
        // set our video stream
        this.stream = "vow" + Math.random();
        var stream_url = "rtmfp://stratus.rtmfp.net/d1e1e5b3f17e90eb35d244fd-c711881365d9/"
                            + "?publish=" + this.stream;
        getFlashMovie("video1").setProperty("src", stream_url);
        return true;
    },
    
    on_presenter_stream_created: function(nearID) {
        if (this.is_presenter()) {
            this.nearID = nearID;
            this.presenter.presenter_url = "rtmfp://stratus.rtmfp.net/d1e1e5b3f17e90eb35d244fd-c711881365d9/"
                            + "?play=" + this.stream + "&farID=" + this.nearID;
            this.websocket_send({"method": "PUT", "resource": "/room/" + this.room + "/presenter",
                "entity": this.presenter},
                function(response) {
                    if (response.code != "success") {
                        presentation.info('could not share video stream url');
                    }
                });
        }
    },
    
    stop_presentation: function() {
        this.set_state("idle");
        this.presenter = null;
        getFlashMovie("video1").setProperty("src", null);
        this.set_slides_url('');
        this.websocket_send({"method": "DELETE", "resource": "/room/" + this.room + "/presenter"});
    },
    
    //-------------------------------------------
    // Slides 
    //-------------------------------------------
    
    share_slides: function(slides_url) {
        if (!this.is_presenter()) {
            this.info('you must be a presenter to share slides');
            return false;
        }
        
        // set the slides url
        if (slides_url.indexOf("http://") != 0)
            slides_url = "http://" + slides_url;
        
        this.websocket_send({"method": "POST", "resource": "/slideshare", "url": slides_url},
            function(response) {
                if (response.code == "success") {
                    presentation.on_slides_created(response.entity);
                } else {
                    presentation.warn('could not translate slideshare url');
                }
            });
        return true;
    },
    
    on_slides_created: function(entity) {
        if (this.is_presenter()) {
            this.slides = entity;
            this.set_slides_index(0);
        }
    },
    
    prev_slide: function() {
        if (this.is_presenter() && this.slides) {
            var index = this.slides.indexOf(this.presenter.slides_url);
            if (index > 0)
                this.set_slides_index(index - 1);
        }
    },
    
    next_slide: function() {
        if (this.is_presenter() && this.slides) {
            var index = this.slides.indexOf(this.presenter.slides_url);
            if (index < (this.slides.length - 1))
                this.set_slides_index(index + 1);
        }
    },
    
    set_slides_index: function(index) {
        if (this.is_presenter()) {
            this.presenter.slides_url = this.slides[index];
            this.set_slides_url(this.presenter.slides_url);
            this.websocket_send({"method": "PUT", "resource": "/room/" + this.room + "/presenter",
                "entity": this.presenter},
                function(response) {
                    if (response.code != "success") {
                        presentation.info('could not share slides url');
                    }
                });
        }
    },
    
    set_slides_url: function(url) {
        if (url == null || url == '') {
            $('slides').innerHTML = '';
        } else {
            $('slides').innerHTML = '<object type="application/x-shockwave-flash"'
                                + 'id="slides1" width="100%" height="100%">'
                                + '<param name="movie" value="' + url + '" />'
                                + '<param name="quality" value="high" />'
                                + '<param name="bgcolor" value="#ffffff" />'
                                + '<param name="allowFullScreen" value="true" />'
                                + '<param name="allowScriptAccess" value="always" />'
                                + '</object>';
        }
    },
    
    //-------------------------------------------
    // Mouse movement
    //-------------------------------------------
    
    last_mouse_move: 0,
    
    // this is mouse event handler, so use presentation instead of this inside.
    on_mouse_move: function(evt) {
        var now = (new Date()).getTime();
        if ((now - presentation.last_mouse_move) > 200) { // up to 5 events per second
            presentation.last_mouse_move = now;
            console.log('on-mouse-move');
            presentation.websocket_send({"method": "NOTIFY", "resource": "/room/" + presentation.room + "/presenter",
                "data": {"mouse": presentation.get_mouse_pos(evt)}});
        }
    },
    
    get_mouse_pos: function(evt) {
        return {"x": (window.event ? event.x: evt.x), "y": (window.event? event.y : evt.y),
                "w": $('slides').clientWidth, "h": $('slides').clientHeight};
    },
    
    on_presenter_mouse_move: function(request) {
        //console.log('presenter mouse ' + request.data.mouse.x + "," + request.data.mouse.y)
        this.show_presenter_mouse(request.data.mouse);
    },
    
    presenter_mouse: null,
    
    show_presenter_mouse: function(xy) {
        if (this.presenter_mouse == null) {
           this.presenter_mouse = document.createElement("div");
           this.presenter_mouse.setAttribute("class", "mouse");
            document.getElementsByTagName("body")[0].appendChild(this.presenter_mouse);
        }
        var W = $('slides').clientWidth;
        var H = $('slides').clientHeight;
        var ratio = 4.0/3.0;
        
        var w0 = Math.min(xy.w, xy.h*ratio);
        var h0 = Math.min(xy.h, xy.w/ratio);
        var W0 = Math.min(W, H*ratio);
        var H0 = Math.min(H, W/ratio);
        
        var x = ((xy.x - xy.w/2.0)/w0)*W0 + W/2.0;
        var y = ((xy.y - xy.h/2.0)/h0)*H0 + H/2.0;
        this.presenter_mouse.style.left = x;
        this.presenter_mouse.style.top = y;
    },
    
    //-------------------------------------------
    // Moderator
    //-------------------------------------------
    
    raise_hand: function(value) {
        if (this.nickname == null) {
            this.nickname = prompt('Please enter your name to raise hand');
            if (this.nickname == null)
                return false;
        }
        
        presentation.websocket_send({"method": "NOTIFY", "resource": "/room/" + presentation.room + "/presenter",
            "data": {"raisehand": value, "name": this.nickname, "id": this.userlist_id}});
        return true;
    },
    
    on_raised_hand: function(request) {
        var value = request.data.raisehand;
        if (value) {
            presentation.info(request.data.name + ' is raising hand'
                + (this.is_presenter() ? ' (<a href="javascript:presentation.allow_viewer_video(\'' + request.data.id + '\')">allow</a>)' : '')
                + (request.data.id == this.userlist_id ? ' (<a href="javascript:presentation.raise_hand(false);">stop</a>)' : ''));
        } else {
            presentation.info(request.data.name + " is not raising hand anymore");
        }
    },
    
    allow_viewer_video: function(userid) {
        if (this.is_presenter()) {
            presentation.websocket_send({"method": "NOTIFY", "resource": "/room/" + this.room + "/userlist/" + userid,
                "data": {"viewer_video": true}});
        }
    },
    
    on_allow_viewer_video: function(request) {
        if (!this.is_presenter() && !this.has_my_video()) {
            this.set_state("viewer_my_video");
            $('viewer_video').style.visibility = "visible";
            presentation.info('you camera and microphone is on. (<a href="javascript:presentation.stop_viewer_video()">stop</a>)');
            this.stream = "vow" + Math.random();
            var stream_url = "rtmfp://stratus.rtmfp.net/d1e1e5b3f17e90eb35d244fd-c711881365d9/"
                                    + "?publish=" + this.stream;
            getFlashMovie("video2").setProperty("src", stream_url);
        }
    },
    
    on_viewer_stream_created: function(nearID) {
        if (this.has_my_video()) {
            this.nearID = nearID;
            this.presenter.viewer_url = "rtmfp://stratus.rtmfp.net/d1e1e5b3f17e90eb35d244fd-c711881365d9/"
                            + "?play=" + this.stream + "&farID=" + this.nearID;
            this.presenter.viewer_id = this.userlist_id;
            this.websocket_send({"method": "PUT", "resource": "/room/" + this.room + "/presenter",
                "entity": this.presenter},
                function(response) {
                    if (response.code != "success") {
                        presentation.info('could not share my video');
                    }
                });
        }
    },
    
    on_viewer_video_change: function() {
        if (this.presenter.viewer_url == null) {
            presentation.info("viewer video removed");
            getFlashMovie("video2").setProperty("src", null);
            $('viewer_video').style.visibility = 'hidden';
            if (this.has_my_video()) {
                this.set_state("viewer");
            }
            
        } else {
            presentation.info('audio video added'
                + (this.is_presenter() || this.has_my_video() ?
                   ' (<a href="javascript:presentation.stop_viewer_video()">stop</a>)' : ''));
            if (this.has_my_video() && this.presenter.viewer_id != userlist_id) {
                this.set_state("viewer");
                getFlashMovie("video2").setProperty("src", null);
                $('viewer_video').style.visibility = 'hidden';
            }
            if (!this.has_my_video()) {
                getFlashMovie("video2").setProperty("src", this.presenter.viewer_url);
                $('viewer_video').style.visibility = 'visible';
            }
        }
        
    },
    
    on_viewer_video_delete: function() {
        presentation.info("viewer video removed");
        if (this.has_my_video()) {
            this.set_state("viewer");
        }
        getFlashMovie("video2").setProperty("src", null);
        $('viewer_video').style.visibility = 'hidden';
    },
    
    stop_viewer_video: function() {
        if ((this.is_presenter() || this.has_my_video()) && this.presenter != null) {
            presentation.info('removing viewer video');
            if (this.has_my_video())
                this.set_state("viewer");
            getFlashMovie("video2").setProperty("src", null);
            $('viewer_video').style.visibility = 'hidden';
            
            this.presenter.viewer_url = null;
            this.presenter.viewer_id = null;
            this.websocket_send({"method": "PUT", "resource": "/room/" + this.room + "/presenter",
                "entity": this.presenter});
        }
    },
    
    //-------------------------------------------
    // Web page
    //-------------------------------------------
    
    set_web_page: function(url) {
        $('slides').innerHTML = '<iframe id="webpage" src="' + url + '" width="100%" height="100%" onLoad="presentation.on_web_page_change();"></iframe>';
    },
    
    on_web_page_change: function() {
        console.log('on-webpage-change');
        console.log($('webpage').contentDocument.location.href);
    },
    
    //-------------------------------------------
    // Commands
    //-------------------------------------------
    
    process_command: function(msg) {
        if (msg.substr(0, 5) == "name=") {
            this.nickname = msg.substr(5);
            this.info('you nickname is ' + this.nickname);
        }
        else if (msg.match(/(http:\/\/)?www.slideshare.net\/\S+$/))
            this.share_slides(msg);
        else
            this.send_message(msg);
    },
    
    //-------------------------------------------
    // Notification
    //-------------------------------------------
    
    received_notify: function(request) {
        if (request.notify == "UPDATE" && request.resource == "/room/" + this.room + "/userlist") {
            this.on_userlist_update(request);
        } else if (request.notify == "UPDATE" && request.resource == "/room/" + this.room + "/chathistory") {
            this.on_chathistory_update(request);
        } else if (request.notify == "PUT" && request.resource == "/room/" + this.room + "/presenter") {
            this.on_presenter_change(request);
        } else if (request.notify == "DELETE" && request.resource == "/room/" + this.room + "/presenter") {
            this.on_presenter_delete(request);
        } else if (request.notify == "NOTIFY" && request.resource == "/room/" + this.room + "/presenter") {
            if (request.data.mouse)
                this.on_presenter_mouse_move(request);
            else if (request.data.raisehand != undefined)
                this.on_raised_hand(request)
        } else if (request.notify == "NOTIFY" && request.resource == "/room/" + this.room + "/userlist/" + this.userlist_id) {
            if (request.data.viewer_video)
                this.on_allow_viewer_video(request);
        }
    },
    
    //-------------------------------------------
    // Websocket
    //-------------------------------------------
    
    websocket_received: function(response) {
        response = JSON.parse(response);
        
        if (response.msg_id && this.pending_request[response.msg_id]) {
            if (this.pending_request[response.msg_id] != null)
                this.pending_request[response.msg_id](response);
            delete this.pending_request[response.msg_id];
        } else if (response.notify != undefined) {
            this.received_notify(response);
        }
    },
    
    websocket_send: function(request, response_callback) {
        request.msg_id = this.count++;
        this.pending_request[request.msg_id] = response_callback;

        try {
            var value = JSON.stringify(request);
            console.log('Sending: ' + value);
            this.socket.send(value);
        } catch (ex) {
            console.log(ex);
        }
    },
    
    //-------------------------------------------
    // Help and utilities
    //-------------------------------------------
    
    colors: { 'You': 'blue', 'They': 'green',
            'info': 'grey', 'warn': 'red', 'error': 'red', 'normal': 'black' },
    
    color: function(user, msg) {
        return (this.colors[user] != undefined) ?
            '<font color="' + this.colors[user] + '">' + msg + '</font>' : msg;
    },
    
    info: function(msg) {
        this.chathistory_append(this.color('info', msg));
    },

    warn: function(msg) {
        this.chathistory_append(this.color('warn', msg));
    },

    error: function(msg) {
        this.chathistory_append(this.color('error', msg));
    },

    chathistory_append: function(msg) {
        $('chathistory').innerHTML = msg + "<br/>" + $('chathistory').innerHTML;
    },
    
    // add new items before this line.
    
    last_member: null
}
