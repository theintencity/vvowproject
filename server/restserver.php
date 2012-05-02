#!/php -q
<?php

//-----------------------------------------------
// Configurations
//-----------------------------------------------

error_reporting(E_ALL);
set_time_limit(0);
ob_implicit_flush();

$port = 8080;
$master = WebSocket("0.0.0.0", $port);
$sockets = array($master);
$users = array();
$debug = true;

$db_hostname = '127.0.0.1';
$db_database = 'webconf';
$db_username = 'user';
$db_password = 'pass';

//-----------------------------------------------
// Main: connect database, start websocket server
//-----------------------------------------------

$db_server = connect_db();
if (!$db_server) {
    say("Failed to connect to database");
    exit();
}

while (true) {
    $changed = $sockets;
    $write = NULL;
    $except = NULL;
    socket_select($changed, $write, $except, NULL); //have some issues here for connect
    foreach ($changed as $socket) {
        if ($socket == $master) {
            $client = socket_accept($master);
            if ($client < 0) {
                console("socket_accept() failed");
                continue;
            } else {
                connect($client);
            }
        } else {
            $bytes = socket_recv($socket, $buffer, 2048, 0);
            if ($bytes == 0) {
                on_disconnect(getuserbysocket($socket));
                disconnect($socket);
            } else {
                $user = getuserbysocket($socket);
                if (!$user->handshake) {
                    dohandshake($user, $buffer);
                } else {
                    ensure_db();
                    process_multiple($user, $buffer);
                }
            }
        }
    }
}

//-----------------------------------------------
// MySQL database connector
//-----------------------------------------------

function connect_db() {
    global $db_hostname, $db_username, $db_password, $db_database;
    $db_server = mysql_connect($db_hostname, $db_username, $db_password);
    if (!$db_server) {
        say("ERROR: unable to connect to MySQL: " . mysql_error());
        return NULL;
    }
    mysql_select_db($db_database, $db_server);
    
    // cleanup the subscribe table, since there are no subscription on startup
    mysql_query("DELETE FROM subscribe");
    mysql_query("DELETE FROM resource WHERE cid != ''");
    
    return $db_server;
}

function ensure_db() {
    global $db_server, $db_hostname, $db_username, $db_password, $db_database;
    if (!mysql_ping($db_server)) {
        say("ERROR: mysql_ping failed. attempting reconnect");
        mysql_close($db_server);
        $db_server = mysql_connect($db_hostname, $db_username, $db_password);
        if (!$db_server) {
            say("ERROR: unable to connect to MySQL: " . mysql_error());
            return NULL;
        }
        mysql_select_db($db_database, $db_server);
    }
}

function disconnect_db() {
    mysql_close($db_server);
}

//-----------------------------------------------
// Our websocket data processing
//-----------------------------------------------

function process_multiple($user, $msg) {
    if ($user->version) {
        $user->pending_msg = $user->pending_msg . $msg;
        while ($user->pending_msg) {
            $m = $user->pending_msg;
            $opcode = ord($m[0]) & 0x0f;
            $len = ord($m[1]) & 0x7f;
            # TODO: ignore the has-mask field and assume it to be 1.
            #say('opcode ' . $opcode . ' len ' . $len . ' raw ' . bin2hex($m));
            if ($opcode != 0x01) {
                say('ERROR: only text opcode is supported');
                return;
            }
            if ($len === 126) {
                $l1 = unpack('n', substr($m,2,2));
                $len = $l1[1];
                $masks = substr($m, 4, 4);
                $offset = 8;
            }
            else if ($len === 127) {
                $l1 = unpack('N', substr($m,2,4));
                $l2 = unpack('N', substr($m,6,4));
                $len = $l1[1] * pow(2, 32) + $l2[1];
                $masks = substr($m, 10, 4);
                $offset = 14;
            }
            else {
                $masks = substr($m, 2, 4);
                $offset = 6;
            }
            say('offset '. $offset . ' len '. $len);
            if (strlen($m) < $offset+$len) { # not enough data yet
                say('ERROR: incomplete message.');
                return;
            }
            $decoded = "";
            $data = substr($m, $offset, $len);
            $user->pending_msg = substr($m, $offset+$len);
            
            for ($index = 0; $index < strlen($data); $index++) {
                $decoded .= $data[$index] ^ $masks[$index % 4];
            }
            #say('decoded '. $opcode . ' ' . $decoded . ' raw ' . $data . ' offset ' . $offset . ' len ' . $len);
            if ($decoded) {
                process($user, $decoded);
            }
        }
    }
    else {
        $user->pending_msg = $user->pending_msg . $msg;
        if ($user->pending_msg[strlen($user->pending_msg)-1] != chr(255)) {
            say("ERROR: incomplete message.");
            return;
        }
        
        $msg = $user->pending_msg;
        $user->pending_msg = "";
        
        $first = 0;
        $last = 0;
        while ($last < (strlen($msg))) {
            $first = strpos($msg, chr(0), $last);
            $last = strpos($msg, chr(255), $first) + 1;
            process($user, unwrap(substr($msg, $first, $last-$first)));
        }
    }
}

function process($user, $action) {
    say("< " . $action);

    $request = json_decode($action, true);

    if (empty($request)) {
        say("ERROR: invalid request body");
        return;
    }

    if (!array_key_exists("method", $request)
        || !array_key_exists("resource", $request)
        || !array_key_exists("msg_id", $request)) {
        say("ERROR: missing mandatory property");
        return;
    }

    $method = $request["method"];
    $response = NULL;

    if ($method == "POST" && $request["resource"] == "/slideshare") {
        $response = get_slideshare($request);  
    } else if ($method == "POST") {
        $response = do_post($user, $request);
    } else if ($method == "PUT") {
        $response = do_put($user, $request);
    } else if ($method == "GET") {
        $response = do_get($user, $request);
    } else if ($method == "DELETE") {
        $response = do_delete($user, $request);
    } else if ($method == "SUBSCRIBE") {
        $response = do_subscribe($user, $request);
    } else if ($method == "UNSUBSCRIBE") {
        $response = do_unsubscribe($user, $request);
    } else if ($method == "NOTIFY") {
        $response = do_notify($user, $request);
    } else {
        // this is an unknown request
        $response = array("code" => "failed", "reason" => "unknown command " . $method . " " . $resource);
    }

    $response['msg_id'] = $request['msg_id'];
    //header("Content-type: application/json");
    send($user, json_encode($response));
}


function on_disconnect($user) {
    $cid = mysql_real_escape_string($user->id);
    
    // first delete all subscriptions of this client
    mysql_command(sprintf("DELETE FROM subscribe WHERE cid='%s'", $cid));
    
    // get all the transient resources of this client
    $result = mysql_query(sprintf("SELECT rid FROM resource WHERE cid='%s'", $cid));
    $result_count = mysql_numrows($result);
    $transient_resources = array();
    for ($j=0; $j < $result_count; ++$j) {
        $row = mysql_fetch_row($result);
        array_push($transient_resources, $row[0]);
    }
    //mysql_freeresult($result);
    
    // remove all the transient resources of this client
    mysql_command(sprintf("DELETE FROM resource WHERE cid='%s'", $cid));
    
    // notify all the subscribers of those transient resources
    foreach ($transient_resources as $rid) {
        do_notify($user, $rid, "DELETE");
    }
    return array('code' =>'success');
}

//-----------------------------------------------
// Generic RESTful web service
//-----------------------------------------------

function do_post($user, $request) {
    // TODO: validate that resource is in correct format.
    $parent = $request["resource"];
    $id = array_key_exists("id", $request) ? $request["id"] : uniqid();
    $resource = $parent . "/" . $id;
    $type = array_key_exists("type", $request) ? $request["type"] : "application/json";
    $entity = json_encode($request["entity"]);
    $cid = array_key_exists("persistent", $request) && $request["persistent"] ? '' : $user->id;
    
    $result = mysql_query(sprintf("INSERT INTO resource (rid, prid, type, entity, cid) VALUES ('%s', '%s', '%s', '%s', '%s')",
        mysql_real_escape_string($resource), mysql_real_escape_string($parent),
        mysql_real_escape_string($type), mysql_real_escape_string($entity),
        mysql_real_escape_string($cid)));
    if (!$result) {
        return array('code' => 'failed', 'reason' => 'failed to insert this resource');
    }
    //mysql_freeresult($result);
    
    do_notify($user, $resource, "POST");
    return array('code' => 'success', 'id' => $id);
}

function do_put($user, $request) {
    $resource = $request["resource"];
    $parent = get_parent($resource);
    $type = array_key_exists("type", $request) ? $request["type"] : "application/json";
    $entity = json_encode($request["entity"]);
    $cid = array_key_exists("persistent", $request) && $request["persistent"] ? '' : $user->id;
    
    $result = mysql_query(sprintf("REPLACE INTO resource (rid, prid, type, entity, cid) VALUES ('%s', '%s', '%s', '%s', '%s')",
        mysql_real_escape_string($resource), mysql_real_escape_string($parent),
        mysql_real_escape_string($type), mysql_real_escape_string($entity),
        mysql_real_escape_string($cid)));
    if (!$result) {
        return array('code' => 'failed', 'reason' => 'failed to replace this resource');
    }
    //mysql_freeresult($result);
    
    do_notify($user, $resource, "PUT");
    return array('code' => 'success');
}


function do_get($user, $request) {
    $resource = $request['resource'];
    $result = mysql_query(sprintf("SELECT type, entity FROM resource WHERE rid='%s'",
                        mysql_real_escape_string($resource)));
    if (!$result) {
        say('mysql_query failed: ' . mysql_error());
        return array('code' => 'failed', 'reason' => 'failed to get this resource');
    }
    
    $result_count = mysql_num_rows($result);
    if ($result_count) {
        // found this resource with valid value. There should be only one value.
        $row = mysql_fetch_row($result);
        $type = $row[0];
        $entity = json_decode($row[1]);
        //mysql_freeresult($result);
        
        return array('code' => 'success', 'resource' => $resource,
                     'type' =>  $type, 'entity' => $entity);
    }
    
    $result = mysql_query(sprintf("SELECT rid FROM resource WHERE prid='%s'",
                        mysql_real_escape_string($resource)));
    if (!$result) {
        return array('code' => 'failed', 'reason' => 'failed to get child resources');
    }
    
    $response = array();
    $result_count = mysql_num_rows($result);
    for ($j=0; $j<$result_count; ++$j) {
        $row = mysql_fetch_row($result);
        if (substr($row[0], 0, strlen($resource)) === $resource)
            array_push($response, substr($row[0], strlen($resource) + 1));
        else
            array_push($response, $row[0]);
    }
    //mysql_freeresult($result);
    
    if (count($response) > 0) {
        return array('code' => 'success', 'resource' => $resource,
                     'type' => 'application/json', 'entity' => $response);
    }
    
    // try to get sub resources
    return array('code' => 'failed', 'reason' => 'no value found for this resource');
}

function do_delete($user, $request) {
    $resource = $request['resource'];
    
    // disable delete if the child resource exists
    $result = mysql_query(sprintf("SELECT rid FROM resource WHERE prid='%s'",
                        mysql_real_escape_string($resource)));
    $result_count = mysql_num_rows($result);
    //mysql_freeresult($result);
    
    if ($result_count) {
        return array('code' => 'failed', 'reason' => 'this parent resource has children');
    }
    
    // remove the specific resource.
    mysql_command(sprintf("DELETE FROM resource WHERE rid='%s'",
        mysql_real_escape_string($resource)));
    
    do_notify($user, $resource, "DELETE");
    return array('code' => 'success');
}

function do_subscribe($user, $request) {
    $cid = mysql_real_escape_string($user->id);
    $resource = $request['resource'];
    
    $result = mysql_command(sprintf("REPLACE INTO subscribe (rid, cid) VALUES ('%s', '%s')",
                mysql_real_escape_string($resource), $cid));
    if (!$result) {
        return array('code' => 'failed', 'reason' => 'failed to subscribe the client to the resource');
    }
    
    return array('code' => 'success');
}

function do_unsubscribe($user, $request) {
    $cid = mysql_real_escape_string($user->id);
    $resource = $request['resource'];
    
    $result = mysql_command(sprintf("DELETE FROM subscribe WHERE rid='%s' AND cid='%s'",
                mysql_real_escape_string($resource), $cid)); //(rid, cid) VALUES ('%s', '%s')",
    if (!$result) {
        return array('code' => 'failed', 'reason' => 'failed to unsubscribe the client from the resource');
    }
    
    return array('code' => 'success');
}

function do_notify($user, $request, $method = NULL) {
    $notify = array("from" => $user->id);
    
    if ($method != NULL) {
        // notification due to POST, PUT or DELETE
        $resource = $request;
        $notify = array("notify" => $method, "resource" => $resource, "type" => NULL, "entity" => NULL);

        if ($method == "PUT" || $method == "POST") {
            $result = mysql_query(sprintf("SELECT type, entity FROM resource WHERE rid='%s'",
                mysql_real_escape_string($resource)));
            if (!$result) {
                say("failed to get this resource");
                return array('code' => 'failed', 'reason' => 'failed to get this resource');
            }
            $result_count = mysql_numrows($result);
            if ($result_count) {
                $row = mysql_fetch_row($result);
                $notify["type"] = $row[0];
                $notify["entity"] = json_decode($row[1]);
            }
            //mysql_freeresult($result);
        }
        // TODO: also send to parent resource
    } else {
        // end to end notify from one client to others
        $notify = array("notify" => "NOTIFY", "resource" => $request["resource"], "data" => $request["data"]);
    }
    
    $param = json_encode($notify);
    $param = str_replace("\/", "/", $param);

    $result = mysql_query(sprintf("SELECT cid FROM subscribe WHERE rid='%s'",
                        mysql_real_escape_string($notify["resource"])));
    if (!$result) {
        say("failed to get this resource subscribers");
        return array('code' => 'failed', 'reason' => 'failed to get this resource subscribers');
    }
    $result_count = mysql_numrows($result);
    
    $sent_count = 0;
    for ($j=0; $j<$result_count; ++$j) {
        $row = mysql_fetch_row($result);
        $target = getuserbyid($row[0]);
        if ($target == null) {
            say("invalid user for " . $row[0]);
        } else {
            send($target, $param);
            ++$sent_count;
        }
    }
    //mysql_freeresult($result);
    
    if ($method == "POST" || $method == "PUT" || $method == "DELETE") {
        $parent = get_parent($notify["resource"]);
        $change = array("notify" => "UPDATE", "resource" => $parent, "type" => $notify["type"], "entity" => $notify["entity"]);
        $child = $notify["resource"];
        $index = strrpos($child, "/");
        if ($index)
            $child = substr($child, $index+1);
        if ($method == "POST")
            $change["create"] = $child;
        else if ($method == "PUT")
            $change["update"] = $child;
        else if ($method == "DELETE")
            $change["delete"] = $child;
        $result = mysql_query(sprintf("SELECT cid FROM subscribe WHERE rid='%s'",
                                      mysql_real_escape_string($parent)));
        $result_count = mysql_numrows($result);
        $param = json_encode($change);
        // JSON specified escapting / but we don't accept that in Javascript
        $param = str_replace("\/", "/", $param);
        
        say("change=" . $change . " param=" . $param);
        for ($k=0; $k<$result_count; ++$k) {
            $row = mysql_fetch_row($result);
            $target = getuserbyid($row[0]);
            if ($target == null) {
                say("invalid user for " . $row[0]);
            } else {
                send($target, $param);
                ++$sent_count;
            }
            ++$sent_count;
        }
        //mysql_freeresult($result);
    }
    
    if ($sent_count == 0) {
        say('notify could not send to anyone');
        return array('code' => 'failed', 'reason' => 'no available user to send notification to');
    }
    
    say('notify sent to ' . count($sent_count) . ' items');
    return array('code' => 'success', 'sent_count' => $sent_count);
}

function get_parent($resource) {
    $index = strrpos($resource, "/");
    if ($index == FALSE)
        return '';
    return substr($resource, 0, $index);
}

function mysql_command($query) {
    $result = mysql_query($query);
    if ($result) {
        //mysql_freeresult($result);
        return TRUE;
    } else {
        return FALSE;
    }
}

//-----------------------------------------------
// RPC commands
//-----------------------------------------------

// this PHP function borrowed from
// http://hasin.wordpress.com/2008/02/09/hacking-slidesharenet-using-php/

function get_slideshare($request) {
    $url = $request["url"];
    $page = file_get_contents($url);
    $pattern = "~doc=([\w-]+)~";
    preg_match($pattern, $page, $matches);
    $xmlurl = "http://s3.amazonaws.com/slideshare/{$matches[1]}.xml";
    $sxml = simplexml_load_file($xmlurl);
    $result = array();
    foreach ($sxml->Slide as $slide)
        array_push($result, (string) $slide['Src']);
    say("result=" . $result);
    return array('code' => 'success', 'entity' => $result);
}

//-----------------------------------------------
// Third-party web socket related code
//-----------------------------------------------

function WebSocket($address, $port) {
    $master = socket_create(AF_INET, SOCK_STREAM, SOL_TCP) or die("socket_create() failed");
    socket_set_option($master, SOL_SOCKET, SO_REUSEADDR, 1) or die("socket_option() failed");
    socket_bind($master, $address, $port) or die("socket_bind() failed");
    socket_listen($master, 20) or die("socket_listen() failed");
    echo "Server Started : " . date('Y-m-d H:i:s') . "\n";
    echo "Master socket  : " . $master . "\n";
    echo "Listening on   : " . $address . " port " . $port . "\n\n";
    return $master;
}

function connect($socket) {
    global $sockets, $users;
    $user = new User();
    $user->id = uniqid();
    $user->socket = $socket;
    $user->version = null;
    $user->pending_msg = "";
    array_push($users, $user);
    array_push($sockets, $socket);
    $peername = "<undefined>";
    $peerport = "<undefined>";
    socket_getpeername($socket, $peername, $peerport);
    console($socket . " CONNECTED from " . $peername . "!");
}

function disconnect($socket) {
    global $sockets, $users;
    $found = null;
    $n = count($users);
    for ($i = 0; $i < $n; $i++) {
        if ($users[$i]->socket == $socket) {
            $found = $i;
            break;
        }
    }
    if (!is_null($found)) {
        array_splice($users, $found, 1);
    }
    $index = array_search($socket, $sockets);
    if ($index >= 0) {
        array_splice($sockets, $index, 1);
    }
    socket_close($socket);
    console($socket . " DISCONNECTED!");
}

function dohandshake($user, $buffer) {
    global $sockets, $port;
    console("\nRequesting handshake...");
    console($buffer);
    if (substr($buffer, 0, 22) == "<policy-file-request/>") {
        console("Responding with policy file request...");
        $response = '<!DOCTYPE cross-domain-policy SYSTEM "http://www.macromedia.com/xml/dtds/cross-domain-policy.dtd">' . "\n"
            . '<cross-domain-policy><allow-access-from domain="*" to-ports="' . $port . '"/></cross-domain-policy>';
        socket_write($user->socket, $response, strlen($response));
        $index = array_search($user->socket, $sockets);
        if ($index >= 0) {
            array_splice($sockets, $index, 1);
        }
        socket_close($user->socket);
        return false;
    }
    
    list($resource, $host, $origin, $version, $strkey, $strkey1, $strkey2, $data) = getheaders($buffer);
    console("Handshaking...");
    
    $user->version = $version && intval($version);
    if ($version && intval($version) >= 8) {
        $accept = base64_encode(sha1($strkey . "258EAFA5-E914-47DA-95CA-C5AB0DC85B11", true));
        $upgrade = "HTTP/1.1 101 Switching Protocols\r\n" .
                "Upgrade: WebSocket\r\n" .
                "Connection: Upgrade\r\n" .
                "Sec-WebSocket-Accept: " . $accept . "\r\n" .
                "\r\n";
        socket_write($user->socket, $upgrade, strlen($upgrade));
    }
    else {
        $pattern = '/[^\d]*/';
        $replacement = '';
        $numkey1 = preg_replace($pattern, $replacement, $strkey1);
        $numkey2 = preg_replace($pattern, $replacement, $strkey2);
    
        $pattern = '/[^ ]*/';
        $replacement = '';
        $spaces1 = strlen(preg_replace($pattern, $replacement, $strkey1));
        $spaces2 = strlen(preg_replace($pattern, $replacement, $strkey2));
    
        if ($spaces1 == 0 || $spaces2 == 0 || fmod($numkey1, $spaces1) != 0 || fmod($numkey2, $spaces2) != 0) {
            $index = array_search($user->socket, $sockets);
            if ($index >= 0) {
                array_splice($sockets, $index, 1);
            }
            socket_close($user->socket);
            console('failed');
            return false;
        }
    
        $ctx = hash_init('md5');
        hash_update($ctx, pack("N", $numkey1 / $spaces1));
        hash_update($ctx, pack("N", $numkey2 / $spaces2));
        hash_update($ctx, $data);
        $hash_data = hash_final($ctx, true);
    
        $upgrade = "HTTP/1.1 101 WebSocket Protocol Handshake\r\n" .
                "Upgrade: WebSocket\r\n" .
                "Connection: Upgrade\r\n" .
                "Sec-WebSocket-Origin: " . $origin . "\r\n" .
                "Sec-WebSocket-Location: ws://" . $host . $resource . "\r\n" .
                "\r\n" .
                $hash_data;
    
        socket_write($user->socket, $upgrade . chr(0), strlen($upgrade . chr(0)));
    }
    
    $user->handshake = true;
    console($upgrade);
    console("Done handshaking...");
    return true;
}

function getheaders($req) {
    $r = $h = $o = $key1 = $key2 = $data = $v = $key = null;
    if (preg_match("/GET (.*) HTTP/", $req, $match)) {
        $r = $match[1];
    }
    if (preg_match("/Host: (.*)\r\n/", $req, $match)) {
        $h = $match[1];
    }
    if (preg_match("/Origin: (.*)\r\n/", $req, $match)) {
        $o = $match[1];
    }
    if (preg_match("/Sec-WebSocket-Key2: (.*)\r\n/", $req, $match)) {
        $key2 = $match[1];
    }
    if (preg_match("/Sec-WebSocket-Key1: (.*)\r\n/", $req, $match)) {
        $key1 = $match[1];
    }
    if (preg_match("/Sec-WebSocket-Version: (.*)\r\n/", $req, $match)) {
        $v = $match[1];
    }
    if (preg_match("/Sec-WebSocket-Key: (.*)\r\n/", $req, $match)) {
        $key = $match[1];
    }
    if (preg_match("/\r\n(.*?)\$/", $req, $match)) {
        $data = $match[1];
    }
    return array($r, $h, $o, $v, $key, $key1, $key2, $data);
}

function getuserbysocket($socket) {
    global $users;
    $found = null;
    foreach ($users as $user) {
        if ($user->socket == $socket) {
            $found = $user;
            break;
        }
    }
    return $found;
}

function getuserbyid($wsid) {
    global $users;
    $found = null;
    foreach ($users as $user) {
        if ($user->id == $wsid) {
            $found = $user;
            break;
        }
    }
    return $found;
}

function send($user, $msg) {
    say("> ".$msg);
    if ($user->version) {
        if (strlen($msg) < 126) {
            $init = chr(0x81) . chr(strlen($msg));
        }
        else if (strlen($msg) < 65536) {
            $init = chr(0x81) . chr(126) . pack('n', strlen($msg));
        }
        else {
            say('ERROR: cannot send a long message');
            return;
        }
        $msg = $init . $msg;
    }
    else {
        $msg = wrap($msg);
    }
    socket_write($user->socket, $msg, strlen($msg));
}

function say($msg="") {
    echo $msg . "\n";
}

function wrap($msg="") {
   return chr(0) . $msg . chr(255);
  //  return $msg;
}

function unwrap($msg="") {
    return substr($msg, 1, strlen($msg) - 2);
}

function console($msg="") {
    global $debug;
    if ($debug) {
        echo $msg . "\n";
    }
}

class User {
    var $id;
    var $socket;
    var $handshake;
    var $version;
    var $pending_msg;
}
?>
