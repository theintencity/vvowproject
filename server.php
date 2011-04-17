#!/php -q
<?php
/*  >php -q server.php  */

error_reporting(E_ALL);
set_time_limit(0);
ob_implicit_flush();

$master = WebSocket("127.0.0.1", 8080);
$sockets = array($master);
$users = array();
$debug = false;

$db_hostname = 'localhost';
$db_database = 'somedb';
$db_username = 'someuser';
$db_password = 'somepw';

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

//---------------------------------------------------------------
function connect_db() {
    global $db_hostname, $db_username, $db_password, $db_database;
    $db_server = mysql_connect($db_hostname, $db_username, $db_password);
    if (!$db_server) {
        say("ERROR: " . "Unable to connect to MySQL: " . mysql_error());
        return NULL;
    }
    mysql_select_db($db_database, $db_server);
    return $db_server;
}

function disconnect_db() {
    mysql_close($db_server);
}

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
        $result = do_whoisonline($request_body, $user);
    } else {
        // this is an unknown request
        $result = array("code"=>"failed", "reason"=>"unknown command " . $method . " " . $resource);
    }

    $result["msg_id"] = $request_body["msg_id"];
    send($user->socket, json_encode($result));
}

function do_login($request, $user) {
    $email = $request["email"];
    $password = $request["password"];
    $wsid = $user->id;
    $sock_id = $user->socket;

    $result = mysql_query(sprintf("SELECT email FROM user WHERE email='%s' AND password='%s'",
        mysql_real_escape_string($email), mysql_real_escape_string($password)));
    $result_true = mysql_num_rows($result);
    if (!$result_true) {
        return array("code"=>"failed", "reason"=>"user is not registered");
    }
//    mysql_query(sprintf("INSERT INTO contact (email, wsid) VALUES ('%s', '%s')",
//        mysql_real_escape_string($email), mysql_real_escape_string($wsid)));
    mysql_query(sprintf("INSERT INTO contact (email, wsid,sockid) VALUES " . "('$email','$wsid','$sock_id')"));

    return array("code"=>"success");
}

function do_signup($request) {
    $email = $request["email"];
    $firstname = $request["firstname"];
    $lastname = $request["lastname"];
    $password = $request["password"];

    $result = mysql_query(sprintf("SELECT email FROM user WHERE email='%s'",
        mysql_real_escape_string($email)));
    $result_true = mysql_num_rows($result);
    if ($result_true) {
        return array("code"=>"failed", "reason"=>"user is already registered");
       }
        mysql_query(sprintf("INSERT INTO user (email, password, firstname, lastname) VALUES ('%s', '%s', '%s', '%s')",
        mysql_real_escape_string($email), mysql_real_escape_string($password),
        mysql_real_escape_string($firstname), mysql_real_escape_string($lastname)));
        return array("code"=>"success");
}

function do_whoisonline($request, $user){
  $result = mysql_query("SELECT contact.email,firstname,lastname FROM user,contact WHERE user.email=contact.email");
  $result_true = mysql_num_rows($result);
  $member = mysql_fetch_row($result);
  if(!$member){
      return array("code"=>"failed", "reason"=>"not working");
    }
 //   for ($j=0; $j <$result_true ; ++$j){
       say($member);
       return array("code"=>"success");
//   if(!$member){
//      return array("code"=>"failed", "reason"=>"not working");
//    }
//    for ($j=0; $j <$result_true ; ++$j){
//      var row =
//       echo "<table><tr> <th>Email</th> <th>FirstName</th><th>LastName</th></tr>";
//       for ($j = 0 ; $j < $rows ; ++$j){
//      $member = mysql_fetch_row($result);
//        echo "<tr>";
//        for ($k = 0 ; $k < 3 ; ++$k)
//        echo "<td>$member[$k]</td>";
//        echo "</tr>";
//        }
//        echo "</table>"
//        ;
//    }
//        say($row);
//       return array("code"=>"success");
//
}
function send($client, $msg) {
    say("> " . $msg);
    $msg = wrap($msg);
    socket_write($client, $msg, strlen($msg));
}

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

function say($msg="") {
    echo $msg . "\n";
}

function wrap($msg="") {
    return chr(0) . $msg . chr(255);
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
    var $username;
    var $name;
    var $param;

}
?>
