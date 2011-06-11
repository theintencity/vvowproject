// assumes $ and log functions are defined.

var room = {
    //-------------------------------------------
    // PROPERTIES
    //-------------------------------------------
    
    // identifier of the room, created by replacing non-word (\W) to _ in room_name
    room_id: null,
    
    // preferences for this room -- initialized to defaults
    preferences: null,
    
    // whether this user is the moderator of this room?
    is_moderator: false,
    
    // list of users. each item has name, id, stream_url.
    userlist: [],
    
    // my user name (is sanitized)
    user_name: null,
    
    // my user identifier created by backend
    user_id: null,
    
    // my stream name if publishing
    stream: null,
    
    // my stream url for others to play
    stream_url: null,
    
    // layout of the video boxes (div)
    layout: null,
    
    // the maximized box object (div)
    maximized: null,
    
    // the last sender name
    last_sender: null,
    
    // the presentation data
    presentation: null,
    
    // the mouse of the presenter
    presenter_mouse: null,
    
    // last mouse position/time
    last_mouse_move: 0,
    
    // list of slides if sharing slides.
    slides: null,
    
    // min video dimension
    min_video_width: 216,
    min_video_height: 162,
    
    // rx quality sending
    send_rx_quality_timer: null,
    send_rx_quality_interval: 10000,
    
    //-------------------------------------------
    // METHODS invoked by restserver
    //-------------------------------------------
    
    on_open: function(data) {
        room.get_roomlist(function(rooms) {
            rooms.sort(function(a, b) {return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);});
            $("join_room").innerHTML = "";
            for (var i=0; i<rooms.length; ++i) {
                var r = rooms[i];
                var child = document.createElement("option");
                child.setAttribute("value", r.id);
                child.appendChild(document.createTextNode(r.name));
                $("join_room").appendChild(child);
            }
        });
        
        var user_name = get_query_param("name");
        var room_name = get_query_param("room");
        var user_password = get_query_param("password");
        if (user_name && room_name) {
            room.join(room_name, user_name, user_password || "");
        }
    },
    
    on_notify: function(request) {
        if (request.notify == "PUT" && request.resource == "/webconf/" + room.room_id) {
            room.set_preferences(request.entity);
        } else if (request.notify == "DELETE" && request.resource == "/webconf/" + room.room_id) {
            room.delete_conference();
        } else if (request.notify == "UPDATE" && request.resource == "/webconf/" + room.room_id + "/userlist") {
            room.on_userlist_update(request);
        } else if (request.notify == "UPDATE" && request.resource == "/webconf/" + room.room_id + "/chathistory") {
            room.on_chathistory_update(request);
        } else if (request.notify == "PUT" && request.resource == "/webconf/" + room.room_id + "/presentation") {
            room.on_presentation_change(request);
        } else if (request.notify == "DELETE" && request.resource == "/webconf/" + room.room_id + "/presentation") {
            room.on_presentation_delete(request);
        } else if (request.notify == "NOTIFY" && request.resource == "/webconf/" + room.room_id + "/presentation") {
            if (request.data.mouse)
                room.on_presenter_mouse_move(request);
        } else if (request.notify == "UPDATE" && request.resource == "/webconf/" + room.room_id + "/userlist/" + room.user_id + "/rxquality") {
            room.on_rx_quality_update(request);
        }
    },

    //-------------------------------------------
    // METHODS initialization, create, join
    //-------------------------------------------
    
    init: function() {
        this.preferences = this.get_default_preferences();
        
        //room.user_list_init();
        //room.user_videos_init();
        window.onresize = room.resize_handler;
        //room.resize_handler();
        
        this.stream = "webconf" + Math.random();
        
        this.show_media_quality(false);
        this.show_network_quality(null, false);
    },
    
    create: function(room_name, user_name, user_password, verify_password) {
        var error = "";
        if (!room_name) 
            error += 'missing "Conference name".<br/>';
        if (!user_name)
            error += 'missing "Your full name".<br/>';
        if (!user_password)
            error += 'missing "Moderator password".<br/>';
        if (!verify_password)
            error += 'missing "Password again".<br/>';
        else if (user_password != verify_password)
            error += 'please enter the same password in "password again" box.<br/>';
        
        if (error) {
            this.main_error(error);
            return;
        }
        
        var room_id = room_name.replace(/\W/g, '_');
        restserver.send({"method": "GET", "resource": "/webconf/" + room_id},
            function(response) {
                if (response.code == "success") {
                    room.main_error("This conference \"" + room_name + "\" already exists");
                } else {
                    room.preferences.name = room_name;
                    room.preferences.owner = user_name;
                    room.preferences.password = user_password;
                    restserver.send({"method": "PUT", "resource": "/webconf/" + room_id, "entity": room.preferences},
                        function(response) {
                            if (response.code == "success") {
                                room.join(room_name, user_name, user_password);
                            } else if (response.code == "failed") {
                                room.main_error("failed to create: " + response.reason);
                            }
                        });
                }
            });
    },
    
    join: function(room_name, user_name, user_password) {
        var error = "";
        if (!room_name) 
            error += 'missing "Conference name".<br/>';
        if (!user_name)
            error += 'missing "Your full name".<br/>';
        
        if (error) {
            this.main_error(error);
            return;
        }
        
        var room_id = room_name.replace(/\W/g, '_');
        restserver.send({"method": "GET", "resource": "/webconf/" + room_id},
            function(response) {
                if (response.code == "success") {
                    if (user_password && response.entity.password != user_password) {
                        room.main_error("Invalid moderator password.");
                    } else {
                        room.logout();
                        room.user_name = user_name;
                        room.room_id = room_id;
                        room.is_moderator = response.entity.password == null || (user_password && response.entity.password == user_password);
                        if (!room.is_moderator) {
                            $("document-icon").style.visibility = "hidden";
                            //$("add-icon").style.visibility = "hidden";
                        }
                        room.set_preferences(response.entity);
                        room.on_select_tab("conference");
                        room.login();
                    }
                } else if (response.code == "failed") {
                    room.main_error("This conference \"" + room_name + "\" does not exist");
                }
            });
    },
    
    login_only: function(user_name) {
        
    },
    
    login: function() {
        setTimeout("room.post_userlist()", 0);
        setTimeout("room.get_userlist()", 200);
        setTimeout("room.get_chathistory()", 300);
        setTimeout("room.subscribe_preferences()", 100);
        setTimeout("room.subscribe_userlist()", 400);
        setTimeout("room.subscribe_chathistory()", 600);
        setTimeout("room.subscribe_presentation()", 800);
        setTimeout("room.get_presentation()", 1000);
        if (room.send_rx_quality_timer == null) {
          room.send_rx_quality_timer = setInterval("room.send_rx_quality()", room.send_rx_quality_interval);
        }
    },
    
    logout: function() {
      if (this.user_id != null) {
        restserver.send({"method": "DELETE", "resource": "/webconf/" + this.room_id + "/userlist/" + this.user_id});
        this.user_id = null;
        this.user_name = null;
      }
      $("chat-history").innerHTML = "";
      this.set_preferences(this.get_default_preferences());
      
      if (this.send_rx_quality_timer != null) {
        clearInterval(this.send_rx_quality_timer);
        this.send_rx_quality_timer = null;
      }
    },
    
    get_roomlist: function(callback) {
        restserver.send({"method": "GET", "resource": "/webconf"},
            function(response) {
                if (response.code == "success") {
                    var remaining = response.entity.length;
                    var result = [];
                    for (var i=0; i<response.entity.length; ++i) {
                        var id = response.entity[i];
                        restserver.send({"method": "GET", "resource": "/webconf/" + id},
                            function(response) {
                                remaining -= 1;
                                if (response.code == "success") {
                                    var conf = response.entity;
                                    conf.id = response.resource.substr(9);
                                    result.push(conf);
                                }
                                if (remaining <= 0) {
                                  callback(result);
                                }
                            });
                    }
                } else if (response.code == "failed") {
                    callback([]);
                }
            });
    },
    
    //-------------------------------------------
    // METHODS preferences
    //-------------------------------------------
        
    subscribe_preferences: function() {
        restserver.send({"method": "SUBSCRIBE", "resource": "/webconf/" + this.room_id});
    },
    
    get_default_preferences: function() {
        return {"name": null, "password": null, "owner": null,
                "allow_html": false, "video_auto": false, "persistent": false,
                "show_header": true, "show_footer": true, "video_controls": false};  
    },
    
    delete_conference: function() {
        this.error("This conference is deleted");
        var old = this.userlist;
        this.userlist = [];
        for (var i=0; i<old.length; ++i) {
            var user = old[i];
            this.on_userlist_removed(user);
        }
    },
    
    set_preferences: function(data) {
        var old = this.preferences;
        this.preferences = data;
        var has_password = (this.preferences.password != null);
        
        for (var s in this.preferences) {
            if (typeof this.preferences[s] != "function" && s != "name" && s != "owner" && s != "password") {
                $("change_" + s).checked = this.preferences[s];
                $("change_" + s).disabled = !has_password || !this.is_moderator;
            }
        }
        $("save-conference-settings").disabled = !has_password || !this.is_moderator;
        $("save-moderator-password").disabled = !has_password;
        
        if (old.show_header && !data.show_header) {
            $("div-header").style.visibility = "hidden";
            $("div-main").style.top = "0px";
        } else if (!old.show_header && data.show_header) {
            $("div-header").style.visibility = "visible";
            $("div-main").style.top = "60px";
        }
        if (old.show_footer && !data.show_footer) {
            $("div-footer").style.visibility = "hidden";
            $("div-main").style.bottom = "10px";
        } else if (!old.show_footer && data.show_footer) {
            $("div-footer").style.visibility = "visible";
            $("div-main").style.bottom = "60px";
        }
        if (old.allow_html && !data.allow_html) {
            this.info("Text chat disallows HTML tags");
        } else if (!old.allow_html && data.allow_html) {
            this.info("Text chat allows HTML tags");
        }
        if (old.persistent && !data.persistent) {
            this.info("Text chat messages are for this session only");
        } else if (!old.persistent && data.persistent) {
            this.info("Text chat messages are persistent");
        }
        if (old.video_controls && !data.video_controls) {
            this.info("Removed participant video controls");
        } else if (!old.video_controls && data.video_controls) {
            this.info("Added participant video controls");
        }
        if (old.video_controls && !data.video_controls || !old.video_controls && data.video_controls) {
            for (var s=0; s<this.userlist.length; ++s) {
                var user = this.userlist[s];
                if (user.video && $("user-video-" + user.id)) {
                    getFlashMovie("video-" + user.id).setProperty("controls", data.video_controls);
                }
            }
        }
    },
    
    change_conference_settings: function(persistent, video_auto, allow_html, show_header, show_footer, video_controls) {
        if (this.is_moderator) {
            var data = {};
            for (var s in this.preferences) {
                data[s] = this.preferences[s];
            }
            data.persistent = persistent;
            data.video_auto = video_auto;
            data.video_controls = video_controls;
            data.allow_html = allow_html;
            data.show_header = show_header;
            data.show_footer = show_footer;
            $("save-conference-settings").value = "Saving...";
            restserver.send({"method": "PUT", "resource": "/webconf/" + this.room_id, "persistent" : persistent, "entity": data},
                function(response) {
                    $("save-conference-settings").value = "Save";
                    if (response.code == "failed") {
                        room.preferences_error("failed to save conference settings: " + response.reason);
                    }
                });
        }
    },
    
    change_moderator_password: function(current, password, password2) {
        var error = "";
        if (!current) 
            error += 'missing "current password".<br/>';
        if (!password)
            error += 'missing "new password".<br/>';
        if (!password2)
            error += 'missing "re-enter new password".<br/>';
        if (password != password2)
            error += 'please enter the same password in "re-enter new password" box.<br/>';
        if (current != this.preferences.password)
            error += 'invalid current password.<br/>';
            
        if (error) {
            this.preferences_error(error);
            return;
        }
        
        var data = {};
        for (var s in this.preferences) {
            data[s] = this.preferences[s];
        }
        data.password = password;
        $("save-moderator-password").value = "Saving...";
        restserver.send({"method": "PUT", "resource": "/webconf/" + this.room_id, "persistent" : this.preferences.persistent, "entity": data},
            function(response) {
                $("save-moderator-password").value = "Save";
                if (response.code == "failed") {
                    room.preferences_error("failed to save moderator: " + response.reason);
                }
            });
    },

    change_privacy: function(is_private, password, password2) {
    },
    
    //-------------------------------------------
    // METHODS text chat related
    //-------------------------------------------
        
    subscribe_chathistory: function() {
        restserver.send({"method": "SUBSCRIBE", "resource": "/webconf/" + this.room_id + "/chathistory"});
    },

    get_chathistory: function() {
        restserver.send({"method": "GET", "resource": "/webconf/" + this.room_id + "/chathistory"}, 
            function(response) {
                if (response.code == "success") {
                  room._chathistory = [];
                  room._remaining_chathistory = response.entity.length;
                  for (var i=0; i<response.entity.length; ++i) {
                    var id = response.entity[i];
                    restserver.send({"method": "GET", "resource": "/webconf/" + room.room_id + "/chathistory/" + id},
                        function(response) {
                            room._chathistory.push(response.entity);
                            room._remaining_chathistory -= 1;
                            if (room._remaining_chathistory == 0) {
                                room.on_chathistory_load(room._chathistory);
                                room._chathistory = null;
                            }
                        });
                  }
                  if (room._remaining_chathistory == 0) {
                      room.on_chathistory_load(room._chathistory);
                      room._chathistory = null;
                  }
                }
            });
    },
    
    on_chathistory_load: function(chathistory) {
        chathistory.sort(function(a, b) {
            return a.timestamp - b.timestamp;
        })
        for (var s=0; s<chathistory.length; ++s) {
            var entity = chathistory[s];
            this.message(entity.sender, entity.text);
        }
    },
    
    on_chathistory_update: function(request) {
        if (request.create != null) {
            this.message(request.entity.sender, request.entity.text);
        }
    },
    
    process_command: function(msg) {
        this.send_message(msg);
    },
    
    send_message: function(msg) {
        restserver.send({
            "method": "POST", "resource": "/webconf/" + this.room_id + "/chathistory", "persistent": this.preferences.persistent,
            "entity": {"sender": this.user_name, "text": msg, "timestamp": (new Date()).getTime()}},
            function(response) {
                if (response.code != "success") {
                    room.info('failed to send your message ' + response.reason);
                }
            });
    },
    
    clear_chathistory: function() {
        $("chat-history").innerHTML = "";
        if (this.is_moderator) {
            restserver.send({"method": "GET", "resource": "/webconf/" + this.room_id + "/chathistory"},
                function(response) {
                    if (response.code == "success") {
                        for (var i=0; i<response.entity.length; ++i) {
                            var id = response.entity[i];
                            restserver.send({"method": "DELETE", "resource": "/webconf/" + room.room_id + "/chathistory/" + id});
                        }
                    }
                });
        }
    },
    
    //-------------------------------------------
    // METHODS user list related
    //-------------------------------------------
    
    subscribe_userlist: function() {
        restserver.send({"method": "SUBSCRIBE", "resource": "/webconf/" + this.room_id + "/userlist"});
    },
        
    on_userlist_update: function(request) {
        // got a new user list update
        if (request.create) {
            var user = request.entity;
            user.id = request.create;
            this.userlist.push(user);
            this.on_userlist_added(user);
            this.info(user.name + " joined");
        } else if (request.update) {
            var user = request.entity;
            user.id = request.update;
            this.on_userlist_changed(user);
        } else if (request['delete']) {
            for (var i=0; i<this.userlist.length; ++i) {
                var user = this.userlist[i];
                if (user.id == request['delete']) {
                    this.userlist.splice(i, 1);
                    this.on_userlist_removed(user);
                    this.info(user.name + " left");
                    break;
                }
            }
        }
    },
    
    post_userlist: function() {
        restserver.send({"method": "POST", "resource": "/webconf/" + this.room_id + "/userlist",
            "entity": {"name": this.user_name, "video": this.preferences.video_auto, "stream_url": null}},
            function(response) {
                if (response.code == "success") {
                    room.user_id = response.id;
                    room.subscribe_my_user();
                    room.subscribe_rx_quality();
                } else {
                    room.info('login failed ' + response.reason);
                }
            });
    },
    
    raise_hand: function() {
        var user = this.get_user_by_id(this.user_id);
        var value = user.raise_hand ? false : true;
        restserver.send({"method": "PUT", "resource": "/webconf/" + this.room_id + "/userlist/" + this.user_id,
            "entity": {"name": this.user_name, "video": user.video, "stream_url": user.stream_url, "raise_hand": value}});
        return true;
    },
    
    subscribe_my_user: function() {
        restserver.send({"method": "SUBSCRIBE", "resource": "/webconf/" + this.room_id + "/userlist/" + this.user_id});
    },
    
    get_userlist: function() {
        restserver.send({"method": "GET", "resource": "/webconf/" + this.room_id + "/userlist"}, 
            function(response) {
                if (response.code == "success") {
                  room.userlist = [];
                  room.on_userlist_cleared();
                  for (var i=0; i<response.entity.length; ++i) {
                    var user_id = response.entity[i];
                    restserver.send({"method": "GET", "resource": "/webconf/" + room.room_id + "/userlist/" + user_id},
                        function(response) {
                            var user_id = room.get_resource_end(response.resource);
                            var user = response.entity;
                            user.id = user_id;
                            room.userlist.push(user);
                            room.on_userlist_added(user);
                        });
                  }
                }
            });
    },
    
    //-------------------------------------------
    // METHODS user interface layout
    //-------------------------------------------
    
    on_userlist_added: function(user) {
        var child = document.createElement("li");
        var checkbox = document.createElement("input");
        checkbox.id = "user-checkbox-" + user.id;
        checkbox.type = "checkbox";
        checkbox.checked = user.video;
        checkbox.disabled = !this.is_moderator;
        if (checkbox.addEventListener)
            checkbox.addEventListener("click", function() { room.on_userlist_click(user); return false; }, false);
        else if (checkbox.attachEvent)
            checkbox.attachEvent("onclick", function() { room.on_userlist_click(user); return false; });
        
        child.appendChild(checkbox);
        child.appendChild(document.createTextNode(user.name));
        
        $("participants").appendChild(child);
        
        if (user.raise_hand) {
            this.add_hand(user.id);
        }
        
        if (user.video) {
            this.add_video(user.id);
            this.resize_handler();
        }
        
        this.show_network_quality(user.id, true);
    },
    
    on_userlist_removed: function(user) {
        var child = $("user-checkbox-" + user.id);
        if (child != null) {
          $("participants").removeChild(child.parentNode);
        }
        this.remove_video(user.id);
        this.resize_handler();
        this.show_network_quality(user.id, false);
    },
    
    on_userlist_click: function(user) {
        if (this.is_moderator) {
            if ($("user-checkbox-" + user.id).checked && !user.video) {
                restserver.send({"method": "PUT", "resource": "/webconf/" + this.room_id + "/userlist/" + user.id,
                    "entity": {"name": user.name, "video": true, "stream_url": null}});
            } else {
                restserver.send({"method": "PUT", "resource": "/webconf/" + this.room_id + "/userlist/" + user.id,
                    "entity": {"name": user.name, "video": false, "stream_url": null}});
            }
        }
    },
    
    get_user_by_id: function(id) {
        for (var s=0; s<this.userlist.length; ++s) {
            if (this.userlist[s].id == id) {
                return this.userlist[s];
            }
        }
        return null;
    },
    
    get_resource_end: function(resource) {
        var index = resource.lastIndexOf("/");
        return (index >= 0 ? resource.substr(index+1) : resource);
    },
    
    on_userlist_changed: function(changed) {
        var user = this.get_user_by_id(changed.id);
        if (user) {
            if (user.video != changed.video) {
                user.video = changed.video;
                $("user-checkbox-" + user.id).checked = user.video;
                if (user.video)
                    this.add_video(user.id);
                else
                    this.remove_video(user.id);
                this.resize_handler();
            }
            if (user.stream_url != changed.stream_url) {
                user.stream_url = changed.stream_url;
                var video = getFlashMovie("video-" + user.id);
                if (video && user.id != this.user_id) {
                    video.setProperty("src", user.stream_url);
                }
                if (user.stream_url == null && user.id == this.user_id) {
                    this.stream_url = null;
                }
            }
            if ((user.raise_hand ? true : false) != (changed.raise_hand ? true : false)) {
                user.raise_hand = changed.raise_hand ? true : false;
                if (user.raise_hand) {
                    if (!$("user-hand-" + user.id)) {
                        this.info(user.name + " is raising hand");
                        this.add_hand(user.id);
                    }
                } else {
                    this.remove_hand(user.id);
                    this.info(user.name + " is not raising hand anymore");
                }
            }
        } else {
            log("invalid changed user id " + changed.id);
        }
    },
    
    on_userlist_cleared: function() {
        $("participants").innerHTML = "";
    },
    
    add_hand: function(user_id) {
        var hand_icon = document.createElement("img");
        hand_icon.id = "user-hand-" + user_id;
        hand_icon.src = "hand_icon_16x16.png";
        hand_icon.style['float'] = "right";
        $("user-checkbox-" + user_id).parentNode.appendChild(hand_icon);
    },
    
    remove_hand: function(user_id) {
        var child = $("user-hand-" + user_id);
        if (child) {
            child.parentNode.removeChild(child);
        }
    },
    
    add_video: function(user_id) {
        var child = document.createElement("div");
        child.id = "user-video-" + user_id;
        child.style.width = "240px";
        child.style.height = "180px";
        child.style.minWidth = "215px";
        child.style.minHeight = "138px";
        child.style.position = "absolute";
        child.style.backgroundColor = "#000000";
        child.style.overflow = "hidden";
        child.ondblclick = function() {
            room.maximized = (room.maximized == child ? null : child);
            room.resize_handler();
        };
        $("videos-box").appendChild(child);
        
        var flashVars = 'cameraQuality=80' + (this.preferences.video_controls ? '&controls=true' : '');
        if (VideoIO) {
            child.innerHTML = getVideoIO("video-" + user_id, flashVars);
        } else {
            child.innerHTML = '<span style="color: #ffffff;">You need Flash Player 10.0 or higher for this content</span>';
        }
    },

    remove_video: function(user_id) {
        var child = $("user-video-" + user_id);
        if (child) {
            $("videos-box").removeChild(child);
            if (this.maximized == child) {
                this.maximized = null;
            }
        }
        this.set_receive_quality(user_id); // will set to empty for this
        if (user_id == this.user_id) {
            this.set_transmit_quality(null, null); // will set to empty for all
            this.show_media_quality(false);
        }
    },
  
    on_video_stream_created: function(user_id, stream_url) {
        log("on_video_stream_created " + user_id + " " + stream_url);
        if (stream_url) {
            this.stream_url = stream_url;
            restserver.send({"method": "PUT", "resource": "/webconf/" + this.room_id + "/userlist/" + this.user_id,
                "entity": {"name": this.user_name, "video": true, "stream_url": stream_url}},
                function(response) {
                    if (response.code == "failed") {
                        room.warn("cannot publish my video stream location: " + response.reason);
                    }
                });
            this.show_media_quality(true);
        } else {
            var user = this.get_user_by_id(user_id);
            if (user && user.video && user.stream_url) {
                var video = getFlashMovie("video-" + user_id);
                if (video) {
                    video.setProperty("src", user.stream_url);
                }
            }
            this.set_receive_quality(user_id); // will set to empty
        }
    },
    
    user_videos_init: function() {
        for (var s=0; s<this.userlist.length; ++s) {
            var user = this.userlist[s];
            if (user.video) {
                this.add_video(user.id);
            }
        }
    },
    
    user_videos_count: function() {
        return $("videos-box").childNodes.length;
        //var count = 0;
        //for (var s=0; s<this.userlist.length; ++s) {
        //    var user = this.userlist[s];
        //    if (user.video) {
        //        ++count;
        //    }
        //}
        //if ($("slides"))
        //  count += 1;
        //return count;
    },
    
    
    // The following layout related functions are borrowed from the Internet Videocity project
    // Please see http://code.google.com/p/videocity/ for more
    
    find_best_layout: function(wr, hr, count) {
        var col = 1, row = 1;
        var wn = 0, hn = 0;
        var rem = wr*hr;
        for (var c=1; c<=count; ++c) {
            var r = Math.ceil(count/c);
            var w = Math.min((hr/r)*(4.0/3.0), (wr/c));
            var h = Math.min((hr/r), (wr/c)*(3.0/4.0));
            var space = wr*hr - count*(w*h);
            if (space <= rem) {
                rem = space;
                col = c;
                row = r;
                wn = w;
                hn = h;
            }
        }
        return {"col": col, "row": row, "width": wn, "height": hn};
    },

    calculate_layout: function(count, width, height) {
        var ratio = 3.0/4.0;
        if (count <= 0) {
            return {"col": 1, "row": 1, "width": 1, "height": 1,
                            "x0": 0, "y0": 0, "mwidth": 0, "mheight": 0,
                            "mx0": 0, "my0": 0, "right": true};
        }
        if (this.maximized != null && count > 1) {
            var h1 = Math.min(height, width*ratio);
            var w1 = h1/ratio;
            var hr = height - h1;
            var wr = width - w1;
            if (hr < this.min_video_height && wr < this.min_video_width) {
                wr = this.min_video_width;
                w1 = width - wr;
                hr = 0;
                h1 = w1*ratio;
            }
            l = (hr > this.min_video_height ? this.find_best_layout(width, hr, count-1) : 
                                         this.find_best_layout(wr, height, count-1));
            result={"col": l.col, "row": l.row, 
                "width": Math.floor(l.width), "height": Math.floor(l.height),
                "x0": 0, "y0": 0, "mwidth": Math.floor(w1), "mheight": Math.floor(h1),
                "mx0": 0, "my0": 0, "right": hr > this.min_video_height};
            
        } else {
            var l = this.find_best_layout(width, height, count);
            //var x0 = width/2 - (l.width*l.col)/2;
            //var y0 = height/2 - (l.height*l.row)/2;
            var x0 = 0;
            var y0 = 0;
            result={"col": l.col, "row": l.row, 
                "width": Math.floor(l.width), "height": Math.floor(l.height),
                "x0": x0, "y0": y0, "mwidth": 0, "mheight": 0,
                "mx0": 0, "my0": 0, "right": true};
        }
        //log(result);
        return result;
    },

    get_child_position: function(index, count) {
        var result = {"x": 0, "y": 0};
        var col = index % this.layout.col;
        var row = Math.floor(index / this.layout.col);
        if (this.maximized == null) {
            result.x = this.layout.x0 + col * this.layout.width;
            result.y = this.layout.y0 + row * this.layout.height;
            if ((this.layout.row * this.layout.col - index) <= this.layout.col) {
                    result.x += ((this.layout.row * this.layout.col - count) 
                                            % this.layout.col) * this.layout.width/2;
            }
        } else {
            result.x = (this.layout.right ? 0 : this.layout.mwidth) 
                                 + this.layout.x0 + col*this.layout.width;
            result.y = (this.layout.right ? this.layout.mheight : 0) 
                                 + this.layout.y0 + row*this.layout.height;
        }
        result.x = Math.floor(result.x);
        result.y = Math.floor(result.y);
        return result;
    },

    layout_boxes: function(count) {
        if (this.maximized != null) {
            if (count > 1) {
                this.maximized.style.width = (this.layout.mwidth - 2) + "px";
                this.maximized.style.height = (this.layout.mheight -2) + "px";
                this.maximized.style.left = this.layout.mx0 + this.layout.x0 + "px";
                this.maximized.style.right = this.layout.my0 + this.layout.y0 + "px";
            } else {
                this.maximized.style.width = (this.layout.width - 2) + "px";
                this.maximized.style.height = (this.layout.height -2) + "px";
                this.maximized.style.left = this.layout.mx0 + this.layout.x0 + "px";
                this.maximized.style.right = this.layout.my0 + this.layout.y0 + "px";
            }
        } 
        var index = 0;
        for (var s=0; s<this.userlist.length; ++s) {
            var user = this.userlist[s];
            var child = $("user-video-" + user.id);
            if (child && child != this.maximized) {
                var xy = this.get_child_position(index, count);
                //log(xy.x + "," + xy.y);
                index++;
                child.style.width = (this.layout.width - 2) + "px";
                child.style.height = (this.layout.height - 2) + "px";
                child.style.left = xy.x + "px";
                child.style.top = xy.y + "px";
            }
        }
        if ($("slides") && $("slides") != this.maximized) {
            var child = $("slides");
            var xy = this.get_child_position(index, count);
            index++;
            child.style.width = (this.layout.width - 2) + "px";
            child.style.height = (this.layout.height - 2) + "px";
            child.style.left = xy.x + "px";
            child.style.top = xy.y + "px";
        }
    },

    resize_handler: function() {
        var count = room.user_videos_count();
        room.layout = room.calculate_layout(count, 
                             $("videos-box").offsetWidth, 
                             $("videos-box").offsetHeight);
        //log("resize_handler: count=" + count);
        //log(room.layout);
        room.layout_boxes(count);
    },

    //-------------------------------------------
    // METHODS visual layout positions
    //-------------------------------------------
    
    visual_layout: {
        "false-false": {
            "user-list-box": ["hidden"],
            "text-chat-box": ["hidden"],
            "videos-box"   : ["inherit", "10px", "10px", "auto", "10px", "10px", "auto"]
        },
        "left-false": {
            "user-list-box": ["inherit", "10px", "auto", "200px", "10px", "10px", "auto"],
            "text-chat-box": ["hidden"],
            "videos-box"   : ["inherit", "220px", "10px", "auto", "10px", "10px", "auto"]
        },
        "right-false": {
            "user-list-box": ["inherit", "auto", "10px", "200px", "10px", "10px", "auto"],
            "text-chat-box": ["hidden"],
            "videos-box"   : ["inherit", "10px", "220px", "auto", "10px", "10px", "auto"]
        },
        "false-left": {
            "user-list-box": ["hidden"],
            "text-chat-box": ["inherit", "10px", "auto", "200px", "10px", "10px", "auto"],
            "videos-box"   : ["inherit", "220px", "10px", "auto", "10px", "10px", "auto"]
        },
        "false-right": {
            "user-list-box": ["hidden"],
            "text-chat-box": ["inherit", "auto", "10px", "200px", "10px", "10px", "auto"],
            "videos-box"   : ["inherit", "10px", "220px", "auto", "10px", "10px", "auto"]
        },
        "left-left": {
            "user-list-box": ["inherit", "10px", "auto", "200px", "10px", "auto", "190px"],
            "text-chat-box": ["inherit", "10px", "auto", "200px", "210px", "10px", "auto"],
            "videos-box"   : ["inherit", "220px", "10px", "auto", "10px", "10px", "auto"]
        },
        "right-right": {
            "user-list-box": ["inherit", "auto", "10px", "200px", "10px", "auto", "190px"],
            "text-chat-box": ["inherit", "auto", "10px", "200px", "210px", "10px", "auto"],
            "videos-box"   : ["inherit", "10px", "220px", "auto", "10px", "10px", "auto"]
        },
        "left-right": {
            "user-list-box": ["inherit", "10px", "auto", "200px", "10px", "10px", "auto"],
            "text-chat-box": ["inherit", "auto", "10px", "200px", "10px", "10px", "auto"],
            "videos-box"   : ["inherit", "220px", "220px", "auto", "10px", "10px", "auto"]
        },
        "right-left": {
            "user-list-box": ["inherit", "auto", "10px", "200px", "10px", "10px", "auto"],
            "text-chat-box": ["inherit", "10px", "auto", "200px", "10px", "10px", "auto"],
            "videos-box"   : ["inherit", "220px", "220px", "auto", "10px", "10px", "auto"]
        }
    },
    
    change_visual_layout: function(participant, participant_left, chathistory, chathistory_left) {
        var first = (participant ? (participant_left ? "left": "right") : "false");
        var second = (chathistory ? (chathistory_left ? "left": "right") : "false");
        var layout = this.visual_layout[first + "-" + second];
        for (var s in layout) {
            if (typeof layout[s] != "function") {
                var attrs = layout[s];
                log(s + " " + attrs);
                try {
                    $(s).style.visibility = attrs[0];
                    if (attrs[0] != "hidden") {
                        $(s).style.left   = attrs[1];
                        $(s).style.right  = attrs[2];
                        $(s).style.width  = attrs[3];
                        $(s).style.top    = attrs[4];
                        $(s).style.bottom = attrs[5];
                        $(s).style.height = attrs[6];
                    }
                } catch (e) {
                    log(s + " " + e);
                }
            }
        }
        this.resize_handler();
        this.on_select_tab("conference");
    },

    //-------------------------------------------
    // METHODS slide presentation
    //-------------------------------------------
    
    subscribe_presentation: function() {
        restserver.send({"method": "SUBSCRIBE", "resource": "/webconf/" + this.room_id + "/presentation"});
    },
      
    on_presentation_change: function(request) {
        var old = this.presentation;
        this.presentation = request.entity;
        
        if (old == null || this.presentation.slides_url != old.slides_url) {
            this.set_slides_url(this.presentation.slides_url);
        }
    },
    
    on_presentation_delete: function(request) {
        if (this.presentation != null) {
            this.presentation = null;
            this.set_slides_url('');
        }
        if (this.presentation == null && this.presenter_mouse != null) {
           document.getElementsByTagName("body")[0].removeChild(this.presenter_mouse);
           this.presenter_mouse = null;
        }
    },
    
    get_presentation: function() {
        restserver.send({"method": "GET", "resource": "/webconf/" + this.room_id + "/presentation"},
            function(response) {
                if (response.code == "success") {
                    room.on_presentation_change(response);
                }
            });
    },
    
    stop_presentation: function() {
        restserver.send({"method": "DELETE", "resource": "/webconf/" + this.room_id + "/presentation"});
    },
    
    //-------------------------------------------
    // METHODS slides
    //-------------------------------------------
    
    share_slides: function() {
        if (!this.is_moderator) {
            this.info('you must be a moderator to share slides');
            return false;
        }
        
        var slides_url = prompt("Enter the slideshare URL of your slides:");
        if (!slides_url) {
            return false;
        }
        
        // set the slides url
        if (slides_url.indexOf("http://") != 0)
            slides_url = "http://" + slides_url;
        
        restserver.send({"method": "POST", "resource": "/slideshare", "url": slides_url},
            function(response) {
                if (response.code == "success") {
                    room.on_slides_created(response.entity);
                } else {
                    room.warn('could not translate slideshare url');
                }
            });
        return true;
    },
    
    on_slides_created: function(entity) {
        if (this.is_moderator) {
            this.slides = entity;
            this.set_slides_index(0);
        }
    },
    
    prev_slide: function() {
        if (this.is_moderator && this.slides) {
            var index = this.slides.indexOf(this.presentation.slides_url);
            if (index > 0)
                this.set_slides_index(index - 1);
        }
    },
    
    next_slide: function() {
        if (this.is_moderator && this.slides) {
            var index = this.slides.indexOf(this.presentation.slides_url);
            if (index < (this.slides.length - 1))
                this.set_slides_index(index + 1);
        }
    },
    
    set_slides_index: function(index) {
        if (this.is_moderator) {
            if (this.presentation == null) {
                this.presentation = {"slides_url" : null};
            }
            this.presentation.slides_url = this.slides[index];
            this.set_slides_url(this.presentation.slides_url);
            restserver.send({"method": "PUT", "resource": "/webconf/" + this.room_id + "/presentation",
                "entity": this.presentation},
                function(response) {
                    if (response.code != "success") {
                        room.info('could not share slides url');
                    }
                });
        }
    },
    
    set_slides_url: function(url) {
        var child = $('slides');
        if (url == null || url == '') {
            if (child) {
                child.innerHTML = '';
                $("videos-box").removeChild(child);
                if (child == this.maximized)
                  this.maximized = null;
                this.resize_handler();
            }
        } else {
            if (!child) {
              child = document.createElement("div");
              child.id = "slides";
              child.style.width = "240px";
              child.style.height = "180px";
              child.style.minWidth = "215px";
              child.style.minHeight = "138px";
              child.style.position = "absolute";
              child.style.backgroundColor = "#000000";
              child.style.overflow = "hidden";
              child.ondblclick = function() {
                  room.maximized = (room.maximized == child ? null : child);
                  room.resize_handler();
              };
              $("videos-box").appendChild(child);
            
              child.onmousemove = (this.is_moderator ? room.on_mouse_move : null);
              
              this.maximized = child;
              this.resize_handler();
            }
            
            child.innerHTML = '<object type="application/x-shockwave-flash"'
            //child.innerHTML = '<object classid="clsid:D27CDB6E-AE6D-11cf-96B8-444553540000" codebase="http://fpdownload.macromedia.com/get/flashplayer/current/swflash.cab"'
                                + 'id="slides1" width="100%" height="100%">'
                                + '<param name="movie" value="' + url + '" />'
                                + '<param name="quality" value="high" />'
                                + '<param name="bgcolor" value="#ffffff" />'
                                + '<param name="allowFullScreen" value="true" />'
                                + '<param name="allowScriptAccess" value="always" />'
                                + '<param name="wmode" value="window" />'
            //                    + '<embed id="slides2" src="' + url + '" quality="high" bgcolor="#ffffff" width="100%" height="100%"'
           //                     + '    align="middle" play="true" loop="false" allowFullScreen="true" allowScriptAccess="always"'
           //                     + '    wmode="window" type="application/x-shockwave-flash"'
           //                     + '    pluginspage=http://www.adobe.com/go/getflashplayer"></embed>'
                                + '</object>';
            if (this.is_moderator) {
                child.innerHTML += '<button onclick="room.stop_presentation();" class="closebutton" title="close presentation">X</button>'
                                + '<button onclick="room.prev_slide();" class="prevbutton" title="previous page">&lt;&lt;</button>'
                                + '<button onclick="room.next_slide();" class="nextbutton" title="next page">&gt;&gt;</button>';
            }
        }
    },
    
    //-------------------------------------------
    // Mouse movement
    //-------------------------------------------
    
    // this is mouse event handler, so use presentation instead of this inside.
    on_mouse_move: function(evt) {
        var now = (new Date()).getTime();
        if ((now - room.last_mouse_move) > 200) { // up to 5 events per second
            room.last_mouse_move = now;
            restserver.send({"method": "NOTIFY", "resource": "/webconf/" + room.room_id + "/presentation",
                "data": {"mouse": room.get_mouse_pos(evt)}});
        }
    },
    
    get_mouse_pos: function(evt) {
        return {"x": (window.event ? event.x: evt.clientX) - $('slides').getBoundingClientRect().left,
                "y": (window.event? event.y : evt.clientY) - $('slides').getBoundingClientRect().top,
                "w": $('slides').clientWidth, "h": $('slides').clientHeight};
    },
    
    on_presenter_mouse_move: function(request) {
        this.show_presenter_mouse(request.data.mouse);
    },
    
    show_presenter_mouse: function(xy) {
        if (this.presenter_mouse == null) {
           this.presenter_mouse = document.createElement("div");
           this.presenter_mouse.setAttribute("class", "mouse");
            document.getElementsByTagName("body")[0].appendChild(this.presenter_mouse);
        }
        
        var W = $('slides').clientWidth;
        var H = $('slides').clientHeight;
        var X = $('slides').getBoundingClientRect().left;
        var Y = $('slides').getBoundingClientRect().top;
        var ratio = 4.0/3.0;
        
        var w0 = Math.min(xy.w, xy.h*ratio);
        var h0 = Math.min(xy.h, xy.w/ratio);
        var W0 = Math.min(W, H*ratio);
        var H0 = Math.min(H, W/ratio);
        
        var x = ((xy.x - xy.w/2.0)/w0)*W0 + W/2.0;
        var y = ((xy.y - xy.h/2.0)/h0)*H0 + H/2.0;
        this.presenter_mouse.style.left = (X + x) + "px";
        this.presenter_mouse.style.top = (Y + y) + "px";
    },
    
    //-------------------------------------------
    // METHODS user input processing
    //-------------------------------------------

    on_select_tab: function(name) {
        var selected = $("li-" + name);
        var children = $("ol-tabs").childNodes;
        for (var i in children) {
            var child = children[i];
            child.className = (selected == child ? "current" : null);
        }
        
        var selected = $("div-" + name);
        var children = $("div-main").childNodes;
        for (var i=0; i<children.length; ++i) {
            var child = children[i];
            if (child.nodeType == 1 && child.nodeName.toLowerCase() == "div") {
                child.style.visibility = (selected == child ? "visible": "hidden");
            }
        }
    },

    //-------------------------------------------
    // METHODS network quality control and display
    //-------------------------------------------

    show_media_quality: function(value) {
        try {
            var children = $("transmit-quality").childNodes;
            for (var i=0; i<children.length; ++i) {
                var child = children[i];
                if (child.nodeType == 1 &&
                    (child.nodeName.toLowerCase() == "input" || child.nodeName.toLowerCase() == "select")) {
                    child.disabled = !value;
                }
            }
            if (!value) { // change UI to default values
                $("encodeQuality_default").selected = "selected";
                $("cameraQuality_default").selected = "selected";
                $("cameraBandwidth_default").selected = "selected";
                $("cameraFPS_default").selected = "selected";
                $("cameraDimension_default").selected = "selected";
                
                $("microphone").checked = true;
                $("camera").checked = true;
                $("cameraLoopback").checked = false;
                $("currentFPS").innerHTML = "0";
            }
        } catch (e) {
            log(e);
        }
    },
    
    show_network_quality: function(user_id, value) {
        try {
            if (user_id == null && value == false) {
                $("receive-quality").innerHTML = "";
            }
            if (user_id && user_id != this.user_id) {
                if (value) {
                    if ($("quality-rx-" + user_id) == null) {
                        var rx = document.createElement("div");
                        rx.id = "quality-rx-" + user_id;
                        $("receive-quality").appendChild(rx);
                        var tx = document.createElement("div");
                        tx.id = "quality-tx-" + user_id;
                        $("receive-quality").appendChild(tx);
                    }
                } else {
                    var rx = $("quality-rx-" + user_id);
                    if (rx)
                        $("receive-quality").removeChild(rx);
                    var tx = $("quality-tx-" + user_id);
                    if (tx)
                        $("receive-quality").removeChild(tx);
                }
            }
        } catch (e) {
            log(e);
        }
    },
    
    set_receive_quality: function(user_id) {
        var user = this.get_user_by_id(user_id);
        if (user) {
            var child = $("quality-rx-" + user_id);
            if (child) {
                var video = getFlashMovie("video-" + user_id);
                if (user.video && getFlashMovie("video-" + user_id)) {
                    var bw = video.getProperty("bandwidth");
                    var q  = video.getProperty("quality");
                    bw =  (isNaN(bw) ? "undefined" : "" + Math.round(bw/1000) + " kb/s");
                    q =  (isNaN(q) ? "undefined" : "" + q);
                    child.innerHTML = "&lt;= <b>" + user.name + "</b>: bandwidth: " + bw + ", quality: " + q;
                } else if (child.innerHTML != "") {
                    child.innerHTML = "";
                }
            }
        }
    },

    set_transmit_quality: function(user_id, entity) {
        for (var i=0; i<this.userlist.length; ++i) {
            var user = this.userlist[i];
            if (user && (user_id == null || user.id == user_id)) {
                var child = $("quality-tx-" + user.id);
                if (child) {
                    if (entity) {
                        var bw = entity.bandwidth;
                        var q  = entity.quality;
                        bw =  (isNaN(bw) ? "undefined" : "" + Math.round(bw/1000) + " kb/s");
                        q =  (isNaN(q) ? "undefined" : "" + q);
                        child.innerHTML = "=&gt; <b>" + user.name + "</b>: bandwidth: " + bw + ", quality: " + q;
                    } else if (child.innerHTML != "") {
                        child.innerHTML = "";
                    }
                }
            }
        }
    },
    
    set_video_property: function(name) {
        if (this.user_id) {
            var video = getFlashMovie("video-" + this.user_id);
            if (video) {
                if (name == "microphone" || name == "camera" || name == "cameraLoopback") {
                    video.setProperty(name, $(name).checked ? true : false);
                } else if (name == "encodeQuality" || name == "cameraQuality" || name == "cameraBandwidth" || name == "cameraFPS") {
                    video.setProperty(name, parseInt($(name).value));
                } else if (name == "cameraDimension") {
                    var parts = $(name).value.split("x");
                    if (parts.length == 2) {
                        video.setProperty("cameraWidth", parseInt(parts[0]));
                        video.setProperty("cameraHeight", parseInt(parts[1]));
                    }
                }
            }
        }
        return true;
    },
    
    on_video_propertychange: function(user_id, property, value) {
        if ((property == "bandwidth" || property == "quality") && user_id != this.user_id) {
            this.set_receive_quality(user_id);
        }
        if (user_id == this.user_id) {
            if (property == "microphone" || property == "camera" || property == "cameraLoopback")
                $(property).checked = value;
            else if (property == "currentFPS") {
                $(property).innerHTML = "" + Math.round(value);
            }
        }
    },

    subscribe_rx_quality: function() {
        restserver.send({"method": "SUBSCRIBE", "resource": "/webconf/" + this.room_id + "/userlist/" + this.user_id + "/rxquality"});
    },
    
    send_rx_quality: function() {
        try {
            if (room.user_id != null) {
                for (var i=0; i<room.userlist.length; ++i) {
                    var user = room.userlist[i];
                    var user_id = user.id;
                    if (user.id != room.user_id) {
                        if (user.video && getFlashMovie("video-" + user.id)) {
                            var video = getFlashMovie("video-" + user.id);
                            var bw = video.getProperty("bandwidth");
                            var q = video.getProperty("quality");
                            restserver.send({"method": "PUT", "resource": "/webconf/" + room.room_id + "/userlist/" + user_id + "/rxquality/" + room.user_id,
                                "entity": {"bandwidth": bw, "quality": q}});
                        }
                    }
                }
            }
        } catch (e) {
            log(e);
        }
    },
    
    on_rx_quality_update: function(request) {
        if (request.update) {
            var user_id = request.update;
            if (request.entity) { // already has changed entity
                room.set_transmit_quality(user_id, request.entity);
            } else { // need to fetch separately
                restserver.send({"method": "GET", "resource": "/webconf/" + room.room_id + "/userlist/" + this.user_id + "/rxquality/" + user_id},
                    function(response) {
                        if (response.code == "success") {
                            var user_id = room.get_resource_end(response.resource);
                            room.set_transmit_quality(user_id, response.entity);
                        }
                    });
            }
        }
    },
    
    //-------------------------------------------
    // Help and utilities
    //-------------------------------------------
    
    colors: { 'You': 'blue', 'They': 'green',
            'info': '#808080', 'warn': '#ff0000', 'error': '#ff0000', 'normal': '#000000' },
    
    color: function(user, msg) {
        return (this.colors[user] != undefined) ?
            '<font color="' + this.colors[user] + '">' + msg + '</font>' : msg;
    },
    
    info: function(msg) {
        this.last_sender = null;
        this.chathistory_append(this.color('info', msg));
    },

    warn: function(msg) {
        this.last_sender = null;
        this.chathistory_append(this.color('warn', msg));
    },

    error: function(msg) {
        this.last_sender = null;
        this.chathistory_append(this.color('error', msg));
    },

    message: function(sender, message) {
        if (this.last_sender != sender) {
            this.last_sender = sender;
            this.chathistory_append(this.color('normal', sanitize(sender) + ":"));
        }
        if (!this.preferences.allow_html)
            message = replaceLinks(sanitize(message));
        this.chathistory_append("&nbsp;&nbsp;" + message);
    },
    
    chathistory_append: function(msg) {
        //$('chat-history').innerHTML = msg + "<br/>" + $('chat-history').innerHTML;
        var child = $('chat-history');
        child.innerHTML += (child.innerHTML ? "<br/>" : "") + msg;
        child.scrollTop = child.scrollHeight;
    },

    main_error: function(msg) {
        $('main_error').innerHTML = msg;
    },
    
    preferences_error: function(msg) {
        $('preferences-error').innerHTML = msg;
    },
    
    // add new members above this line
    last_item: null
    
};
