# The Python version of restserver uses local sqlite3 database file, and restserver.py and ajaxserver.py
# modules for synchronouse and asynchronous requests. The server also acts as a web-server for local files.
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
from mod_pywebsocket import msgutil
from restserver import Database, Handler

logger = logging.getLogger('restserver')


db = Database()
db.reset()

clients = {}
lock = threading.Lock()
        
class Client(Handler):
    def __init__(self, request):
        Handler.__init__(self, db)
        self.request = request
        self.id = str(id(self))
        clients[self.id] = self

    def send(self, data):
        try:
            self.request.ws_stream.send_message(data, binary=False)
        except:
            logger.error("send failed %s"%(sys.exc_info()[1],))
            self.close()

    def received(self, data):
        logger.debug('received ' + data)
        request = json.loads(data)
        
        if 'method' not in request or 'resource' not in request or 'msg_id' not in request:
            logger.warn('missing mandatory property')
            return
        
        method, resource = request['method'], request['resource']
        if method in ['POST', 'PUT', 'GET', 'DELETE', 'SUBSCRIBE', 'UNSUBSCRIBE', 'NOTIFY']:
            try:
                response = eval('self.%s'%(method,))(request) or {"code": "failed", "reason": "method did not return"}
            except:
                logger.exception("exception")
                response = {"code": "failed", "reason": "server programming exception"}
        else:
            response = {"code": "failed", "reason": "unknown command " + method + " " + resource}
        response['msg_id'] = request['msg_id']
        self.send(json.dumps(response))

    def close(self):
        if clients[self.id]:
            del clients[self.id]
            self.request = None
            self.db.commit('DELETE FROM subscribe WHERE cid=?', (self.id, ))
            resources = self.db.fetchall('SELECT rid FROM resource WHERE cid=?', (self.id,))
            self.db.commit('DELETE FROM resource WHERE cid=?', (self.id,))
            for row in resources:
                self.NOTIFY(row[0], 'DELETE')
        return dict(code='success')

    def NOTIFY(self, request, method=None):
        if method: # notification due to POST, PUT or DELETE
            resource = request
            # TODO: change 'from': self.id in the php code too.
            notify = {'notify': method, 'resource': resource, 'type': None, 'entity': None, 'from': self.id}
            if method == 'PUT' or method == 'POST':
                try:
                    result = self.db.fetchone('SELECT type, entity FROM resource WHERE rid=?', (resource,))
                except:
                    traceback.print_exc()
                    return dict(code='failed', reason='failed to get this resource')
                if result:
                    notify['type'], entity = result[0], json.loads(result[1])
                    notify['entity'] = dict([(k, v) for k, v in entity.iteritems() if not k or k[0] != "_"])
            # TODO: also send to parent resource
        else:
            notify = {'notify': 'NOTIFY', 'resource': request['resource'], 'data': request['data'], 'from': self.id}
    
        param = json.dumps(notify)
        
        try:
            result = self.db.fetchall('SELECT cid FROM subscribe WHERE rid=?', (notify['resource'],))
        except:
            traceback.print_exc()
            return dict(code='failed', reason='failed to get this resource subscribers')
        
        sent_count = 0
        for row in result:
            target = self.getuserbyid(row[0])
            if not target:
                logger.debug('invalid user for %r', row[0])
            else:
                target.send(param)
                sent_count += 1
        
        if method in ('POST', 'PUT', 'DELETE'):
            parent = self.get_parent(notify['resource'])
            change = {'notify': 'UPDATE', 'resource': parent, 'type': notify['type'], 'entity': notify['entity']}
            child = notify['resource']
            index = child.rfind('/')
            if index >= 0:
                child = child[index+1:]
            change[{'POST': 'create', 'PUT': 'update', 'DELETE': 'delete'}.get(method)] = child
            result = self.db.fetchall('SELECT cid FROM subscribe WHERE rid=?', (parent,))
            param = json.dumps(change)
            
            logger.debug('change=%r param=%r', change, param)
            for row in result:
                target = self.getuserbyid(row[0])
                if not target:
                    logger.debug('invalid user for %r', row[0])
                else:
                    target.send(param)
                    sent_count += 1
        if not sent_count:
            logger.debug('notify could not send to anyone')
            return dict(code='failed', reason='no available user to send notification to')
        logger.debug('notify sent to %r items', sent_count)
        return dict(code='success', sent_count=sent_count)
        
    def getuserbyid(self, userid):
        return clients.get(userid, None)

    
def web_socket_do_extra_handshake(request):
    # This example handler accepts any request. See origin_check_wsh.py for how
    # to reject access from untrusted scripts based on origin value.
    pass  # Always accept.


def web_socket_transfer_data(request):
    request.ws_client = Client(request)
    
    try:
        while True:
            line = request.ws_stream.receive_message()
            if line is None:
                return
            lock.acquire()
            try:
                request.ws_client.received(line)
            except:
                raise
            finally:
                lock.release()
    except msgutil.ConnectionTerminatedException, e: # Connection closed unexpectedly
        logger.error("ConnectionTerminatedException")
    
    try:
        lock.acquire()
        request.ws_client.close()
    except:
        traceback.print_exc()
    finally:
        lock.release()
    # del request.ws_client

