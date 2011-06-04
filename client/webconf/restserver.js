// assumes $ and log functions are defined.
// assumes that json.js is included.

var restserver = {
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
    
    // supplied in initializer
    on_open: null,
    on_close: null,
    on_notify: null,
    div_id: null,
    text_id: null,
    
    init: function(on_open, on_close, on_notify, div_id, text_id) {
        try{
            if (on_open) 
                this.on_open = on_open;
            if (on_close)
                this.on_close = on_close;
            if (on_notify)
                this.on_notify = on_notify;
            if (div_id)
                this.div_id = div_id;
            if (text_id)
                this.text_id = text_id;
            
            if (this.div_id) {
                if (!this.text_id) 
                    this.text_id = this.div_id;
                $(this.div_id).style.visibility = "visible";
                $(this.div_id).style.cursor = "wait";
                $(this.text_id).innerHTML = "Connecting...";
            }
            
            this.socket = new WebSocket(this.websocket_url);
            log('websocket.init: status=' + this.socket.readyState);
            
            this.socket.onopen = function(msg){
                log("websocket.onopen: status=" + this.readyState + " "  + restserver.div_id);
                restserver.timeout = 125;
                if (restserver.div_id) {
                    $(restserver.div_id).style.visibility = "hidden";
                    $(restserver.div_id).style.cursor = "auto";
                    $(restserver.text_id).innerHTML = 'connected to websocket server';
                }
                if (restserver.on_open)
                    restserver.on_open();
            };
            this.socket.onmessage = function(msg){
                var data = msg.data.replace(/\\\//g, '/');
                if (data.charAt(0) == '\u0000')
                    data = data.substring(1);
                log("received: " + data);
                restserver.received(data);
            };
            this.socket.onclose   = function(msg){
                log("websocket.onclose: status=" + this.readyState+ ". reconnecting in " + restserver.timeout/1000.0+" seconds");
                if (restserver.on_close) 
                    restserver.on_close();
                if (restserver.div_id) {
                    $(restserver.text_id).innerHTML = 'Reconnecting in ' + restserver.timeout / 1000.0 + ' seconds.'
                    + (restserver.timeout < 10000 ? "" :
                    ' Reload page to connect now.');
                }
                
                setTimeout("restserver.init()", restserver.timeout);
                if (restserver.timeout < 30000) {
                    restserver.timeout *= 2;
                } else {
                    restserver.timeout = 60000;
                }
            };
        }
        catch(ex){
            log(ex);
            if (restserver.div_id) {
              $(restserver.text_id).innerHTML = "No WebSocket found. Please use the Google Chrome web browser. Your this browser does not support the WebSocket protocol.";
            }
            $(restserver.div_id).style.cursor = "auto";
        }
    },
    
    received: function(response) {
        response = JSON.parse(response);
        
        if (response.msg_id && this.pending_request[response.msg_id]) {
            if (this.pending_request[response.msg_id] != null)
                this.pending_request[response.msg_id](response);
            delete this.pending_request[response.msg_id];
        } else if (response.notify != undefined) {
            if (this.on_notify)
                this.on_notify(response);
        }
    },
    
    send: function(request, response_callback) {
        request.msg_id = this.count++;
        this.pending_request[request.msg_id] = response_callback;

        try {
            var value = JSON.stringify(request);
            log('Sending: ' + value);
            this.socket.send(value);
        } catch (ex) {
            console.log(ex);
        }
    },
    
    // add new items before this line.
    
    last_item: null
};
