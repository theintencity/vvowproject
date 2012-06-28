# This is the Python restserver module used in the websocket server by
# restserver_wsh.py and AJAX server by ajaxserver.py.

import logging, sqlite3, json, time, random, re

logger = logging.getLogger('restserver')

class Database():
    def __init__(self, filename="restserver.db"):
        self.conn = sqlite3.connect(filename, check_same_thread=False)
        self.cursor = self.conn.cursor()
        self._create()
        
    def _create(self):
        try:
            self.commit('''CREATE TABLE resource (
                rid varchar(1024) PRIMARY KEY NOT NULL DEFAULT '',
                prid varchar(1024) NOT NULL DEFAULT '',
                type varchar(64) NOT NULL DEFAULT 'application/json',
                entity blob,
                cid varchar(25)
            )''')
            self.commit('''create table subscribe (
                rid varchar(1024) NOT NULL DEFAULT '',
                cid varchar(25) NOT NULL DEFAULT '',
                PRIMARY KEY (rid, cid)
            )''')
            logger.debug('Database created')
        except sqlite3.OperationalError:
            logger.debug('Database already created')
        

    def reset(self):
        # cleanup the subscribe table, since there are no subscription on startup
        self.commit("DELETE FROM subscribe");
        self.commit("DELETE FROM resource WHERE cid != ''");
        
    def close(self):
        if self.cursor:
            self.cursor.close()
            self.cursor = None
            
    def commit(self, *args):
        logger.debug('commit%r', args)
        self.cursor.execute(*args)
        self.conn.commit()
        
    def iterate(self, *args):
        logger.debug('iterate%r', args)
        return self.cursor.execute(*args)
        
    def fetchone(self, *args):
        logger.debug('fetchone%r', args)
        self.cursor.execute(*args)
        result = self.cursor.fetchone()
        logger.debug('fetchone%r=>\n  %r', args, result)
        return result
        
    def fetchall(self, *args):
        logger.debug('fetchall%r', args)
        self.cursor.execute(*args)
        result = self.cursor.fetchall()
        logger.debug('fetchall%r=>\n  %s', args, '\n  '.join(['%r'%(x,) for x in result]))
        return result

def uniqid():
    return str(int(time.time()) * 1000 + random.randint(0, 999))


class Handler():
    def __init__(self, db):
        self.db = db

    def POST(self, request):
        parent, ctype, entity, persistent = request['resource'], request.get('type', 'application/json'), \
            json.dumps(request.get('entity', {})), request.get('persistent', False)
        rid = request['id'] if 'id' in request else uniqid()
        resource = parent + '/' + rid
        cid = '' if persistent else self.id
        try:
            self.db.commit('INSERT INTO resource (rid, prid, type, entity, cid) VALUES (?, ?, ?, ?, ?)',
                (resource, parent, ctype, entity, cid))
        except:
            logger.exception('failed to insert resource')
            return dict(code='failed', reason='failed to insert this resource')
        self.NOTIFY(resource, 'POST')
        return dict(code='success', id=rid)
    
    def PUT(self, request):
        resource, attr, ignore = self._parse(request['resource'])
        ctype, entity, persistent = request.get('type', 'application/json'), \
            json.dumps(request.get('entity', {})), request.get('persistent', False)
        if attr:
            result = None
            try:
                result = self.db.fetchone('SELECT type, entity FROM resource WHERE rid=?', (resource,))
            except:
                logger.exception('failed to get resource')
            if not result:
                return dict(code='failed', reason='failed to get the resource')
            
            result = json.loads(result[1])
            result[attr] = request.get('entity', None);
            entity = json.dumps(result)
            try:
                self.db.commit('UPDATE resource SET entity=? WHERE rid=?', (entity, resource))
            except:
                logger.exception('failed to replace resource attribute')
                return dict(code='failed', reason='failed to replace resource attribute')
        else:
            parent = self.get_parent(resource)
            cid = '' if persistent else self.id
            try:
                self.db.commit('REPLACE INTO resource (rid, prid, type, entity, cid) VALUES (?, ?, ?, ?, ?)',
                    (resource, parent, ctype, entity, cid))
            except:
                logger.exception('failed to replace resource')
                return dict(code='failed', reason='failed to replace this resource')
        self.NOTIFY(resource, 'PUT')
        return dict(code='success')
    
    def GET(self, request):
        resource, attr, params = self._parse(request['resource'])
        if attr:
            result = None
            try:
                result = self.db.fetchone('SELECT type, entity FROM resource WHERE rid=?', (resource,))
                entity = json.loads(result[1])
                if attr in entity:
                    return dict(code="success", resource=request['resource'], entity=json.dumps(entity[attr]))
                else:
                    return dict(code="failed", reason="failed to get this resource attribute")
            except:
                logger.exception('failed to read resource')
            return dict(code='failed', reason='failed to get this resource')
        elif params:
            try:
                query, attrs = 'SELECT rid FROM resource WHERE prid=?', [resource]
                if 'like' in params:
                    query += " AND rid LIKE ?"
                    attrs.append(params['like'])
                if 'limit' in params:
                    query += " LIMIT " + params['limit']
                if 'offset' in params:
                    query += " OFFSET " + params['offset']
                if 'order' in params:
                    query += " " + params['order']
                result = self.db.fetchall(query, attrs)
            except:
                logger.exception('failed to read parent resource')
                return dict(code='failed', reason='failed to get child resources')
            response = [(row[0][len(resource)+1:] if row[0].startswith(resource) else row[0]) for row in result]
        else:
            try:
                result = self.db.fetchone('SELECT type, entity FROM resource WHERE rid=?', (resource,))
            except:
                logger.exception('failed to read resource')
                return dict(code='failed', reason='failed to get this resource')
            if result:
                ctype, entity = result[0], json.loads(result[1])
                entity = dict([(k, v) for k, v in entity.iteritems() if not k or k[0] != "_"])
                return dict(code='success', resource=resource, type=ctype, entity=entity)
            try:
                result = self.db.fetchall('SELECT rid FROM resource WHERE prid=?', (resource,))
            except:
                logger.exception('failed to read parent resource')
                return dict(code='failed', reason='failed to get child resources')
            response = [(row[0][len(resource)+1:] if row[0].startswith(resource) else row[0]) for row in result]
        if response:
           return dict(code='success', resource=resource, type='application/json', entity=response)
        return dict(code='failed', reason='no value found for this resource')
    
    def DELETE(self, request):
        resource = request['resource']
        result = self.db.fetchone('SELECT count(rid) FROM resource WHERE prid=?', (resource,))
        if result[0]:
            return dict(code='failed', reason='this parent resource has children')
        self.db.commit('DELETE FROM resource WHERE rid=?', (resource,))
        self.NOTIFY(resource, 'DELETE')
        return dict(code='success')
    
    def SUBSCRIBE(self, request):
        resource = request['resource']
        try:
            self.db.commit('REPLACE INTO subscribe (rid, cid) VALUES (?, ?)', (resource, self.id))
        except:
            logger.exception('failed to replace subscribe')
            return dict(code='failed', reason='failed to subscribe the client to the resource')
        return dict(code='success')
    
    def UNSUBSCRIBE(self, request):
        resource = request['resource']
        try:
            self.db.commit('DELETE FROM subscribe WHERE rid=? AND cid=?', (resource, self.id))
        except:
            logger.exception('failed to delete subscribe')
            return dict(code='failed', reason='failed to unsubscribe the client from the resource')
        return dict(code='success')
    
    # to be overridden by the sub-class if it supports NOTIFY
    def NOTIFY(self, request, method=None):
        pass 
        
    def get_parent(self, resource):
        index = resource.rfind('/')
        return resource[:index] if index >= 0 else ''
        
    def _parse(self, value):
        match = re.match(r'([^\[\?]+)(\[([^\]\?]*)\])?(\?.*)?$', value)
        if not match: return (value, None, None)
        groups = match.groups()
        return (groups[0], groups[2], dict([x.split('=', 1) for x in groups[3][1:].split('&')]) if groups[3] else None)
        
    
