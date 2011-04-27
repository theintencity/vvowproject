#!/php -q
<?php
/*  > php -q server.php  */

//-----------------------------------------------
// Configurations
//-----------------------------------------------

error_reporting(E_ALL);
set_time_limit(0);
ob_implicit_flush();

$master = WebSocket("127.0.0.1", 8080);
$sockets = array($master);
$users = array();
$debug = true;

$db_hostname = 'localhost';
$db_database = 'xxxproject';
$db_username = 'xxxuser';
$db_password = 'xxxpass';

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
    socket_select($changed, $write = NULL, $except = NULL, NULL); //have some issues here for connect
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
                do_logout(getuserbysocket($socket));
                disconnect($socket);
            } else {
                $user = getuserbysocket($socket);
                if (!$user->handshake) {
                    dohandshake($user, $buffer);
                } else {
                    process($user, $buffer);
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

    // cleanup the contact and subscribe table, since there are no
    // connected contact on startup
    mysql_query("DELETE FROM contact");
    mysql_query("DELETE FROM subscribe");

    return $db_server;
}

function disconnect_db() {
    mysql_close($db_server);
}

//-----------------------------------------------
// Our web service rendezvous API
//-----------------------------------------------


function process($user, $msg) {
    $action = unwrap($msg);
    say("< " . $action);

    $request_body = json_decode($action, true);

    if (empty($request_body)) {
        say("ERROR: invalid request body");
        return;
    }

    if (!array_key_exists("method", $request_body) ||
            !array_key_exists("resource", $request_body) ||
            !array_key_exists("msg_id", $request_body)) {
        say("ERROR: missing mandatory property");
        return;
    }

    $method = $request_body["method"];
    $resource = $request_body["resource"];

    $result = NULL;

    if ($method == "POST" && $resource == "/user") {
        $result = do_signup($request_body);
    } else if ($method == "POST" && $resource == "/contact") {
        say("process login");
        $result = do_login($request_body, $user);
    } else if ($method == "GET" && $resource == "/contact") {
        say("process whoisonline");
        $result = do_whoisonline($user);
    } else if ($method == "DELETE" && $resource == "/contact") {
        say("process logout");
        $result = do_logout($user);
    } else if ($method == "NOTIFY" && $resource == "/contact") {
        say("process notify");
        $result = do_notify($request_body, $user);
    } else if ($resource != "/user" && $resource != "/contact") {
        if ($method == "POST") {
            $result = do_post_resource($request_body, $user);
        } else if ($method == "PUT") {
            $result = do_put_resource($request_body, $user);
        } else if ($method == "GET") {
            $result = do_get_resource($request_body, $user);
        } else if ($method == "DELETE") {
            $result = do_delete_resource($request_body, $user);
        } else if ($method == "SUBSCRIBE") {
            $result = do_subscribe_resource($request_body, $user);
        } else if ($method == "NOTIFY") {
            $result = do_publish_resource($request_body, $user);
        }
    } else {
        // this is an unknown request
        $result = array("code" => "failed", "reason" => "unknown command " . $method . " " . $resource);
    }

    $result['msg_id'] = $request_body['msg_id'];
    header("Content-type: application/json");
    $param = json_encode($result);
    send($user->socket, $param);
}

//-----------------------------------------------
// Signup, login, logout, and online users
//-----------------------------------------------

function do_login($request, $user) {
    $email = $request["email"];
    $password = $request["password"];
    $wsid = $user->id;

    $result = mysql_query(sprintf("SELECT email FROM user WHERE email='%s' AND password='%s'",
                            mysql_real_escape_string($email), mysql_real_escape_string($password)));
    $result_count = mysql_num_rows($result);
    if (!$result_count) {
        header("Content-type: application/json");
        return array("code" =>"failed", "reason" =>"user is not registered");
    }
    mysql_query(sprintf("INSERT INTO contact (email, wsid) VALUES ('%s', '%s')",
        mysql_real_escape_string($email), mysql_real_escape_string($wsid)));
//    mysql_query(sprintf("INSERT INTO contact (email, wsid, sockid) VALUES " . "('$email','$wsid','$sock_id')"));

    $new_request = do_whoisonline($user);
    unset($new_request['code']);
    $new_request['email'] = '*';
    do_notify($new_request, $user);

    return array('code' =>'success');
}

function do_signup($request) {
    $email = $request["email"];
    $firstname = $request["firstname"];
    $lastname = $request["lastname"];
    $password = $request["password"];

    $result = mysql_query(sprintf("SELECT email FROM user WHERE email='%s'",
                            mysql_real_escape_string($email)));
    $result_count = mysql_num_rows($result);
    if ($result_count) {
        header("Content-type: application/json");
        return array("code" => "failed", "reason" => "user is already registered");
    }
    mysql_query(sprintf("INSERT INTO user (email, password, firstname, lastname) VALUES ('%s', '%s', '%s', '%s')",
                    mysql_real_escape_string($email), mysql_real_escape_string($password),
                    mysql_real_escape_string($firstname), mysql_real_escape_string($lastname)));
    return array('code' => 'success');
}

function do_logout($user) {
    $wsid = $user->id;
    mysql_query(sprintf("DELETE FROM contact WHERE wsid='%s'",
                            mysql_real_escape_string($wsid)));
    mysql_query(sprintf("DELETE FROM subscribe WHERE wsid='%s'",
                            mysql_real_escape_string($wsid)));

    $new_request = do_whoisonline($user);
    unset($new_request['code']);
    $new_request['email'] = '*';
    do_notify($new_request, $user);

    return array('code' =>'success');
}

function do_whoisonline($user) {
    $result = mysql_query("SELECT DISTINCT contact.email, user.firstname, user.lastname FROM contact LEFT JOIN user ON contact.email = user.email");
    $result_count = mysql_num_rows($result);
    $members = array();
    for ($j = 0; $j < $result_count; ++$j) {
        $row = mysql_fetch_row($result);
        $member = array("email" => $row[0], "firstname" => $row[1], "lastname" => $row[2]);
        array_push($members, $member);
    }
    say('whoisonline returning ' . count($members) . ' items');
    return array('code' => 'success', 'contact' => $members);
}

function get_users_by_email($email) {
    global $users;
    if ($email == "*") {
        // send to all connected users
        return $users;
    } else {
        $targets = array();
        // send to contact items with matching email
        $result = mysql_query(sprintf("SELECT wsid FROM contact WHERE email='%s'",
                            mysql_real_escape_string($email)));
        $result_count = mysql_num_rows($result);
        if (!$result_count) {
            return $targets;
        }
        // get the users form $users array by matching id
        for ($j = 0; $j < $result_count; ++$j) {
            $row = mysql_fetch_row($result);
            $found = getuserbyid($row[0]);
            array_push($targets, $found);
        }
        return $targets;
    }
}

function get_email_by_wsid($wsid) {
    $result = mysql_query(sprintf("SELECT email FROM contact WHERE wsid='%s'",
                        mysql_real_escape_string($wsid)));
    $result_count = mysql_num_rows($result);
    if (!$result_count) {
        return null;
    }
    $row = mysql_fetch_row($result);
    return $row[0];
}

function do_notify($request, $user) {
    $targets = array();
    if ($request["wsid"]) {
        // get the target by id
        $target = getuserbyid($request["wsid"]);
        if ($target) {
            array_push($targets, $target);
        }
    } else {
        // get all targets by email
        $targets = get_users_by_email($request["email"]);
    }

    $new_request = $request;
    unset($new_request["msg_id"]);

    $new_request["from_email"] = get_email_by_wsid($user->id);
    $new_request["from_wsid"] = $user->id;
    $new_request["method"] = "NOTIFY";
    $new_request["resource"] = "/contact";

    $param = json_encode($new_request);

    $sent_count = 0;
    say("found targets " . $targets);
    foreach ($targets as $target) {
        if ($target != $user) {
            send($target->socket, $param);
            ++$sent_count;
        }
    }

    if ($sent_count == 0) {
        say('notify could not send to anyone: ' . $new_request);
        return array('code' => 'failed', 'reason' => 'no available user to send notification to\n');
    }

    say('notify sent to ' . count($sent_count) . ' items: ' . $new_request);
    return array('code' => 'success', 'sent_count' => $sent_count);
}

//-----------------------------------------------
// Generic REST resource with subscribe/notify
//-----------------------------------------------

function do_post_resource($request, $user, $resource) {
    $value = json_encode(get_resource_from_request($request));
    $result = mysql_query(sprintf("INSERT INTO resource (resource, json) VALUES ('%s', '%s')",
                        mysql_real_escape_string($resource), mysql_real_escape_string($value)));
    if (!$result) {
        return array('code' => 'failed', 'reason' => 'failed to insert this resource');
    }

    notify_subscribers($resource, $user);

    return array('code' => 'success');
}

function do_put_resource($request, $user, $resource) {
    $value = json_encode(get_resource_from_request($request));
    $result = mysql_query(sprintf("REPLACE INTO resource (resource, json) VALUES ('%s', '%s')",
                        mysql_real_escape_string($resource), mysql_real_escape_string($value)));
    if (!$result) {
        return array('code' => 'failed', 'reason' => 'failed to replace this resource');
    }

    notify_subscribers($resource, $user);

    return array('code' => 'success');
}

function do_get_resource($request, $user, $resource) {
    $result = mysql_query(sprintf("SELECT json FROM resource WHERE resource='%s'",
                        mysql_real_escape_string($resource)));
    if (!$result) {
        return array('code' => 'failed', 'reason' => 'failed to replace this resource');
    }
    $result_count = mysql_num_rows($result);
    if ($result_count) {
        $row = mysql_fetch_row($result);
        $value = json_encode($row[0]);
        $value['code'] = 'success';
        return $value;
    }
    return array('code' => 'failed', 'reason' => 'no value found for this resource');
}

function do_delete_resource($request, $user, $resource) {
    $result = mysql_query(sprintf("DELETE FROM resource WHERE resource='%s'",
                        mysql_real_escape_string($resource)));
    if (!$result) {
        return array('code' => 'failed', 'reason' => 'failed to delete this resource');
    }

    notify_subscribers($resource, $user);

    return array('code' => 'success');
}

function do_subscribe_resource($request, $user, $resource) {
    $result = mysql_query(sprintf("REPLACE INTO subscribe (resource, subscriber_wsid) VALUES ('%s', '%s')",
                mysql_real_escape_string($resource), mysql_real_escape_string($user->id)));
    if (!$result) {
        return array('code' => 'failed', 'reason' => 'failed to subscribe the user to the resource');
    }

    return array('code' => 'success');
}

function do_notify_resource($request, $user, $resource) {
    $new_request = $request;
    unset($new_request["msg_id"]);
    $sent_count = notify_subscribers($resource, $user, $new_request);
    if ($sent_count == 0) {
        say('notify could not send to anyone: ' . $new_request);
        // don't fail the request.
    }
    return array('code' => 'success');
}

// notify the state of this resource to all the subscribers.
function notify_subscribers($resource, $user, $request=NULL) {
    if ($request == NULL) {
        $result = mysql_query(sprintf("SELECT json FROM resource WHERE resource='%s'",
                            mysql_real_escape_string($resource)));
        $result_count = mysql_num_rows($result);
        $request = array();
        if ($result_count) {
            $row = mysql_fetch_row($result);
            $request = json_encode($row[0]);
        }
    }

    $request["from_email"] = get_email_by_wsid($user->id);
    $request["from_wsid"] = $user->id;
    $request["method"] = "NOTIFY";
    $request["resource"] = $resource;

    $param = json_encode($request);

    $result = mysql_query(sprintf("SELECT subscriber_wsid FROM subscribe WHERE resource='%s'",
                        mysql_real_escape_string($resource)));
    $result_count = mysql_num_rows($result);
    $targets = array();
    for ($j = 0; $j < $result_count; ++$j) {
        $row = mysql_fetch_row($result);
        $found = getuserbyid($row[0]);
        array_push($targets, $found);
    }

    $sent_count = 0;
    foreach ($targets as $target) {
        send($target->socket, $param);
        ++$sent_count;
    }
    return $sent_count;
}

function get_resource_from_request($request) {
    $value = $request;
    unset($value['msg_id']);
    unset($value['method']);
    unset($value['resource']);
    return $value;
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
    array_push($users, $user);
    array_push($sockets, $socket);
    console($socket . " CONNECTED!");
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
    socket_close($socket);
    console($socket . " DISCONNECTED!");
    if ($index >= 0) {
        array_splice($sockets, $index, 1);
    }
}

function dohandshake($user, $buffer) {
    console("\nRequesting handshake...");
    console($buffer);
    list($resource, $host, $origin, $strkey1, $strkey2, $data) = getheaders($buffer);
    console("Handshaking...");

    $pattern = '/[^\d]*/';
    $replacement = '';
    $numkey1 = preg_replace($pattern, $replacement, $strkey1);
    $numkey2 = preg_replace($pattern, $replacement, $strkey2);

    $pattern = '/[^ ]*/';
    $replacement = '';
    $spaces1 = strlen(preg_replace($pattern, $replacement, $strkey1));
    $spaces2 = strlen(preg_replace($pattern, $replacement, $strkey2));

    if ($spaces1 == 0 || $spaces2 == 0 || $numkey1 % $spaces1 != 0 || $numkey2 % $spaces2 != 0) {
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
    $user->handshake = true;
    console($upgrade);
    console("Done handshaking...");
    return true;
}

function getheaders($req) {
    $r = $h = $o = null;
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
    if (preg_match("/\r\n(.*?)\$/", $req, $match)) {
        $data = $match[1];
    }
    return array($r, $h, $o, $key1, $key2, $data);
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

function send($client, $msg) {
    say(">".$msg);
    $msg = wrap($msg);
    socket_write($client, $msg, strlen($msg));
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
}
?>
