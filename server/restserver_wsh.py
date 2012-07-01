# The Python version of restserver uses local sqlite3 database file, and restserver.py and ajaxserver.py
# modules for synchronous and asynchronous requests. The server also acts as a web-server for local files.
# This poses security risk, because the database file is also available in current directory.
# Feel free to re-organize the base server for reducing the security risk.
#
# The instructions to launch the server is as follows:
#
# 1) Install Python2.7 in c:\Python27 on Windows, or default path on Unix/Mac OS X.
# 2) Install mod_pywebsocket module of Python.
#    After download, uncompress, and run "python setup.py install" in its "src" directory.
# 3) Run the websocket server as follows.
#   a) Replace python with \Python27\python.exe on Windows platform.
#   b) Replace python with /path/to/your/python2.7 on Unix-like platforms.
#
# python -m mod_pywebsocket.standalone -p 8080 --log-level=error --cgi-paths=.
#

import sys, logging, traceback, json, threading
from mod_pywebsocket import msgutil, handshake
from restserver import Sqlite3Database as Database, Handler
# from restserver import InmemoryDatabase as Database, Handler
# alternatively: use PostgreSQLDatabase or InmemoryDatabase

logger = logging.getLogger('restserver')
databases = {}

for name in ('restserver', 'private'):
    try:
        db = Database(database=name)
        db.reset()
        databases[name] = db;
    except: pass

clients = {}
lock = threading.Lock()
        
class Client(Handler):
    def __init__(self, request, db):
        Handler.__init__(self, db)
        self.request = request
        self.id = str(id(self))
        clients[self.id] = self
        logger.info('%s connection created, uri %s', self.id, request.uri)

    def send(self, data):
        try:
            logger.info('%s send %s', self.id, data);
            self.request.ws_stream.send_message(data, binary=False)
        except:
            logger.error("%s send failed %s", self.id, sys.exc_info()[1])
            #traceback.print_exc()
            self.close()

    def received(self, data):
        logger.info('%s received %s', self.id, data)
        request = json.loads(data)
        
        if 'method' not in request or 'resource' not in request or 'msg_id' not in request:
            logger.warn('%s missing mandatory property', self.id)
            return
        
        method, resource = request['method'], request['resource']
        if not self.allowed(method, resource, request):
            response = {'code': 'failed', 'reason': 'unauthorized resource or method'}
        elif method not in ['POST', 'PUT', 'GET', 'DELETE', 'SUBSCRIBE', 'UNSUBSCRIBE', 'NOTIFY']:
            response = {"code": "failed", "reason": "unknown command %s %s"%(method, resource)}
        else:
            try:
                response = eval('self.%s'%(method,))(request) or {"code": "failed", "reason": "method did not return"}
            except:
                logger.exception("%s exception in %s %s", self.id, method, resource)
                response = {"code": "failed", "reason": "server programming exception"}
        response['msg_id'] = request['msg_id']
        logger.info('%s %s %s (msg-id=%r code=%r)', self.id, method, resource, request['msg_id'], response.get('code', None))
        self.send(json.dumps(response))

    def close(self):
        if self.id in clients and clients[self.id]:
            del clients[self.id]
            self.request = None
            Handler.close(self)
        return dict(code='success')

    def NOTIFY(self, request, method=None):
        sent_count = 0
        try:
            for userid, param in self.notifier(request, method):
                target = self.getuserbyid(userid)
                if not target:
                    logger.debug('%s invalid user for %r', self.id, userid)
                else:
                    logger.info('%s NOTIFY %r (userid=%r)', self.id, param, userid)
                    target.send(param)
                    sent_count += 1
        except ValueError:
            return dict(code='failed', reason=str(sys.exc_info()[1]))
        if not sent_count:
            logger.debug('%s notify could not send to anyone', self.id)
            return dict(code='failed', reason='no available user to send notification to')
        logger.debug('%s notify sent to %r items', self.id, sent_count)
        return dict(code='success', sent_count=sent_count)
        
    def getuserbyid(self, userid):
        return clients.get(userid, None)
    
    def allowed(self, method, resource, request):
        return True


def web_socket_do_extra_handshake(request):
    global databases
    
    # This example handler accepts any request. See origin_check_wsh.py for how
    # to reject access from untrusted scripts based on origin value.
    lock.acquire()
    try:
        database = 'restserver'
        logger.debug("database=%r", database)
        if database not in databases:
            databases[database] = Database(database=database)
        request.db = databases[database]
        request.dbname = database
        # request.db.reset() # TODO: need to cleanup on startup
    except:
        raise handshake.AbortedByUserException("Unauthorized")
    finally:
        lock.release()
    #pass  # Always accept.


def web_socket_transfer_data(request):
    request.ws_client = Client(request, request.db)
    
    try:
        while True:
            line = request.ws_stream.receive_message()
            if line is None:
                break
            lock.acquire()
            try:
                request.ws_client.received(line)
            except:
                raise
            finally:
                lock.release()
    except msgutil.ConnectionTerminatedException, e: # Connection closed unexpectedly
        logger.info("ConnectionTerminatedException")
        # traceback.print_exc()
    
    lock.acquire()
    try:
        request.ws_client.close()
    except:
        logger.exception("exception in cleanup")
        # TODO: experimental code to reset this database
        try:
            if request.db:
                request.db.reconnect()
        except:
            pass
    
    #try:
    #    if request.dbname in databases:
    #        databases[request.dbname]["count"] = databases[request.dbname]["count"] - 1
    #        if databases[request.dbname]["count"] == 0:
    #            db = databases[request.dbname]["db"]
    #            del databases[request.dbname]
    #            db.close()
    #except:
    #    logger.error("exception in closing the database")
    ##request.db.close();
    
    lock.release()
    # del request.ws_client
    request.db = None

#def web_socket_passive_closing_handshake(request):
#    return None, ''
#    #lock.acquire()
#    #try:
#    #    request.ws_client.close()
#    #except:
#    #    try:
#    #        if request.db:
#    #            request.db.reconnect()
#    #    except:
#    #        pass
#    #lock.release()
#    #request.db = None
#    #
#    ## Simply echo a close status code
#    #code, reason = request.ws_close_code, request.ws_close_reason
#    #return code, reason
#
