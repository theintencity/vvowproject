# Voice and Video on Web

> This project was migrated from https://code.google.com/p/vvowproject on May 17, 2015  
> Keywords: *Web*, *Video*, *WebRTC*, *Flash*, *Realtime*, *Voice*, *Conference*  
> Members: *kundan10* (owner, architecture design and implementation), *theintencity* (owner, lead WebRTC integration), *voipresearcher* (committer), *j.conde.m* (committer, student spring 2012, WebRTC), *harinath922* (contributer, student summer 2011, part 4), *Isioma.Ijeh* (committer, spring 2011, part 1-3)  
> Links: [Project](https://sites.google.com/site/vvowproject/), [Video](http://www.youtube.com/watch?v=O2kJbI9sETU&hd=1), [Live](http://gardo1.rice.iit.edu/webconf/)  
> License: [GNU Lesser GPL](http://www.gnu.org/licenses/lgpl.html)  
> Others: starred by 19 users

This is the source repository for the project hosted at <https://sites.google.com/site/vvowproject/>

This site is used for project source code, downloads, and issue tracking. You can try out our demo at <http://gardo1.rice.iit.edu/webconf/> using the Google Chrome web browser. It works with other web browsers as well but not thoroughly tested. Alternatively, check out our demo video at [http://www.youtube.com/watch?v=O2kJbI9sETU](http://www.youtube.com/watch?v=O2kJbI9sETU&hd=1).

Our relevant paper on <a href='http://arxiv.org/abs/1106.6333'>SIP APIs for voice and video communications on the web</a> (<a href='http://www.slideshare.net/kundan10/voice-and-video-communications-on-the-web'>slides</a>) was presented at IPTcomm 2011.

**News** (05/30/2012) merged the WebRTC-based conference implementation of webrtc branch to trunk. Test using Chrome Canary using "Aloha" conference on the demo page.

**News** (12/01/2011) updated the service to work with latest changes in Chrome's websocket implementation, and to enable high quality H.264 encoding if Flash Player 11 is detected. If you find any issues, please let us know.

# Getting Started #

Follow these instructions if you would like to set up the conference service on your own host, similar to ours on gardo1.rice.iit.edu.

Prerequisites:
  1. PHP
  1. existing web server such as Apache
  1. MySQL database server.

The server/restserver.php is the main server application now, which uses the restserver.sql schema for MySQL. The client files are in client/webconf/ directory.

1) Use git to checkout the sources for client and server.
```
$ git clone https://github.com/theintencity/vvowproject.git
$ cd vvowproject
```
This will create the vvowproject directory.

2) Copy all the client webconf files to your web server so that it is served under /webconf URL. For example, for default Apache web server, typically /var/www/html is the root document directory.
```
$ sudo mkdir /var/www/html/webconf
$ sudo cp client/webconf/* /var/www/html/webconf/
```
You can change appropriately if you wish to host the client files at another location or using another web server. For my testing, I use Python built-in web server, by starting as follows.
```
$ cd client/webconf
$ python -m SimpleHTTPServer 8000
```
And then access it at http://localhost:8000/

3) Modify webconf/restserver.js (near line 6) to refer to your web server's IP address instead of 127.0.0.1. For example, if your web server's IP address is 192.1.2.3 then change as follows.
```
-   websocket_url: "ws://127.0.0.1:8080/restserver.php",
+   websocket_url: "ws://192.1.2.3:8080/restserver.php",
```

4) Install and configure your MySQL database. You can install it on the same machine as your web server or on a different machine. Create a new database named "restserver", assuming your user name is root and password is mypassword in MySQL.
```
$ mysql -uroot -pmypassword -hlocalhost
mysql> create database restserver;
mysql> grant all privileges on restserver.* to 'root'@'localhost' 
       identified by 'mypassword';
mysql> flush privileges;
```
This creates the database and assigns access. If your database server is different from web server host, or you use a different user name or password, please modify the above commands accordingly.

5) Create the vvowproject database tables using restserver.sql schema as follows.
```
$ mysql -uroot -pmypassword -hlocalhost restserver < server/restserver.sql
```
This creates two tables in that database.

6) Edit restserver.php to point to the correct database IP and use the correct username and password (near line 19 to 22). Following is the default configuration to connect to the database on local host.
```
$db_hostname = '127.0.0.1';
$db_database = 'restserver';
$db_username = 'root';
$db_password = 'mypassword';
```

7) Start restserver.php using the PHP command prompt.
```
$ cd server
$ php restserver.php
```
This starts the server on foreground. I usually start the server in background as follows.
```
$ php restserver.php >restserver.log 2>&1 &
```
On Linux you can also use the start up script restserver-lsb. Just copy it to /etc/init.d/restserver and either use service start|stop commands or chkconfig to launch on startup. You can edit restserver-lsb to point to the correct location for restserver.php.

8) Once the server is started it will try to connect to the database, and show error, if any. If you do not see any error you are good to continue. Otherwise, you need to check the connectivity and access to the database.

9) If needed, open the firewall for port 8080 (for restserver.php) and port 80 or 8000 (for your web server). On Linux, typically iptables is used to open firewall ports. If you database is running on another host instead of co-located with your web server, you may need to open the MySQL port as well on 3306.

10) Open a web browser, Google Chrome, and point it to your web server, say http://your-server-ip/webconf which should open the index.html file of webconf/. This index file shows the conference page. It also uses Websocket (or Flash Player) to connect to restserver.php on port 8080.Once connected, it will show list of conferences and allow you to create or join conference. After that just refer to the help tab on the conference page to proceed further.

# Known Issues #

As an intermediate step to implementing our media path, we use Flash Player to facilitate media. It does not work for restricted NAT and firewall, e.g., UDP blocking firewall or if both parties in a conference are behind symmetric NAT.

If WebSocket is not natively supported in your web browser, then there is usually a delay of few seconds before the browser connects to the restserver.php using Flash Player. You can start flashpolicyd.pl and open up firewall port 843 to speed up the connection.
```
$ cd server
$ perl flashpolicyd.pl --port=843 --file=crossdomain.xml
```
The Flash policy server is used by Flash Player to verify whether it can connect to the server or not. The Flash Player falls back to in-line policy request after a few seconds, which works with restserver.php.
