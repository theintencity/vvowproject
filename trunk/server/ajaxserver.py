#!/Python27/python.exe
# This is the CGI script invoked by websocket/web server when started as per restserver_wsh.py
# Please change the first line appropriately for Unix-platform to the path to python2.7.

import sys, traceback, json, re
sys.path.append('cgi-bin') # TODO: move this to outside
from restserver import Database, Handler

class Client(Handler):
    def GET(self, request):
        result = Handler.GET(self, request)
        if result and result['code'] == 'success' and 'resource' in request and re.search(r'\[_password\]$', request['resource']): # TODO: need to send email
            password = result['entity']
            return {"code": "failed", "reason": "Cannot send email. Returning password in clear text as " + password}
        return result

try:
    db = Database()
    handler = Client(db);
    handler.id = '' 
    handler.persistent = True # to make any resource "create" as persistent
    
    data = sys.stdin.read()
    request = json.loads(data)
    method, resource = request['method'], request['resource']
    if method not in ['POST', 'PUT', 'GET', 'DELETE']: raise ValueError("invalid method " + method)
    
    response = eval('handler.%s'%(method,))(request)
    if not response: raise ValueError("method did not return")
    if 'msg_id' in request: response['msg_id'] = request['msg_id']
    
    print 'Content-Type: application/json\n\n%s'%(json.dumps(response),)
except:
    print 'Content-Type: application/json\n\n%s'%(json.dumps({"code": "failed", "reason": str(sys.exc_info()[1])}))
