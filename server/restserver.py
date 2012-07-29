# This is the Python restserver module used in the websocket server by
# restserver_wsh.py and AJAX server by ajaxserver.py.

import logging, sqlite3, json, time, random, re

logger = logging.getLogger('restserver')

def uniqid():
    return str(int(time.time()) * 1000 + random.randint(0, 999))

# This is the interface that is implemented by specific Database classes

class AbstractDatabase():
    # Get the resource data
    # @param rid (str) - the resource path
    # @return tuple (type, entity) if found or None
    def get(self, rid):
        raise NotImplementedError
    
    # Insert a resource and fail if it already exists
    # @param rid (str) - the resource path
    # @param ctype (str) - the content type of entity
    # @param entity - the resource entity representation
    # @param cid (str) - the context identifier for transient
    # @param overwrite (bool) - set to True to replace or update if found
    # @exception - if overwrite is False, and the resource id (rid) exists
    def insert(self, rid, ctype, entity, cid, overwrite=False):
        raise NotImplementedError
    
    # Append a resource as a child to the parent resource.
    # @param prid (str) - the parent resource path
    # @param ctype (str) - the content type of entity
    # @param entity - the resource entity representation
    # @param cid (str) - the context identifier for transient
    # @return child resource identity (str) as relative id instead of path
    # @exception - if a child resource id cannot be created after multiple attempts
    def append(self, prid, ctype, entity, cid):
        raise NotImplementedError
    
    # Delete a resource by its path
    # @param rid (str) - resource path to remove
    def delete(self, rid):
        raise NotImplementedError

    # Set the entity of a resource, assuming it exists.
    # @param rid (str) - the resource path to edit
    # @param ctype (str) - the content type of entity
    # @param entity - the resource entity representation
    def set_entity(self, rid, ctype, entity):
        raise NotImplementedError
    
    # Return the number of children of a resource
    # @param prid (str) - the parent resource path of which number of children is counted
    # @return number of children of the parent resource path
    def count_children(self, prid):
        raise NotImplementedError
    
    # Get zero or more resources, either children with optional criteria or for a context
    # @param prid (str) - the parent resource path whose children are used
    # @param cid (str) - optional context whose resources are used
    # @param params (dict) - optional criteria with attributes for 'like' (str),
    #   'limit' (int), 'offset' (int), 'order' (str, 'ASC' default or 'DESC')
    def get_all(self, prid=None, cid=None, params=None):
        raise NotImplementedError

    # Delete zero or more resources in a context or children of a parent resource.
    # @param cid (str) - context id to delete resources in this context
    # @param prid (str) - optional parent resource path when supplied in conjunction
    #   with cid to delete all resources within this parent.
    def delete_all(self, cid, prid=None):
        raise NotImplementedError

    # Set the resource path and listener context pair, or overwrite if exists.
    # @param rid (str) - the resource path
    # @param cid (str) - the context id
    def set_listener(self, rid, cid):
        raise NotImplementedError

    # Whether the resource path has a subscriber context?
    # @param rid (str) - the resource path
    # @return boolean indicating if a listener exists or not?
    def has_listener(self, rid):
        raise NotImplementedError
    
    # Get all the subscriber contexts on a resource path
    # @param rid (str) - the resource path
    # @return a list of context id (str) values
    def get_listeners(self, rid):
        raise NotImplementedError
    
    # Get all the resource paths of a listener context
    # @param cid (str) - the context id
    # @return a list of resource path (str) values
    def get_listener_resources(self, cid):
        raise NotImplementedError

    # Delete a subscription for a resource, or context, or both
    # @param cid (str) - the listener context id
    # @param rid (str) - the optional resource path
    def delete_listeners(self, cid, rid=None):
        raise NotImplementedError


class Sqlite3Database():
    def __init__(self, database="restserver"):
        self.database = database
        self._connect()
        self._create()
        self.reset()
    
    def _connect(self):
        filename = "../" + self.database + ".db"
        self.conn = sqlite3.connect(filename, check_same_thread=False)
        self.cursor = self.conn.cursor()
    
    def _create(self):
        try:
            self.commit('''CREATE TABLE resource (
                rid varchar(1024) PRIMARY KEY NOT NULL DEFAULT '',
                prid varchar(1024) NOT NULL DEFAULT '',
                type varchar(64) NOT NULL DEFAULT 'application/json',
                entity blob,
                cid varchar(25)
            )''')
            self.commit('''CREATE TABLE subscribe (
                rid varchar(1024) NOT NULL DEFAULT '',
                cid varchar(25) NOT NULL DEFAULT '',
                PRIMARY KEY (rid, cid)
            )''')
            logger.debug('Database created')
        except sqlite3.OperationalError:
            logger.debug('Database already created')
    
    def reconnect(self):
        try: self.close()
        except: pass
        try: self._connect()
        except: pass

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
    
    # interface of restdbapi.ResourceDatabase

    def get(self, rid):
        return self.fetchone('SELECT type, entity FROM resource WHERE rid=?', (rid,))
    
    def insert(self, rid, prid, ctype, entity, cid, overwrite=False):
        if not overwrite:
            self.commit('INSERT INTO resource (rid, prid, type, entity, cid) VALUES (?, ?, ?, ?, ?)',
                (rid, prid, ctype, entity, cid))
        else:
            self.commit('REPLACE INTO resource (rid, prid, type, entity, cid) VALUES (?, ?, ?, ?, ?)',
                (rid, prid, ctype, entity, cid))

    def append(self, prid, ctype, entity, cid):
        attempt = 1000
        while attempt > 0:
            rid = uniqid()
            resource = prid + '/' + rid
            try:
                self.insert(resource, prid, ctype, entity, cid)
                return rid
            except:
                logger.info('failed to insert resource')
            attempt -= 1
        if attempt <= 0:
            raise ValueError('failed to insert child to this resource')
    
    def delete(self, rid):
        return self.commit('DELETE FROM resource WHERE rid=?', (rid,))
    
    def set_entity(self, rid, ctype, entity):
        self.commit('UPDATE resource SET type=?, entity=? WHERE rid=?', (ctype, entity, rid))
    
    def count_children(self, prid):
        return self.fetchone('SELECT count(rid) FROM resource WHERE prid=?', (prid,))
    
    def get_all(self, prid=None, cid=None, params=None, select_what='rid'):
        if params is None:
            if prid is not None and cid is not None:
                return self.fetchall('SELECT %s FROM resource WHERE prid=? AND cid=?'%(select_what,), (prid, cid))
            elif prid is not None:
                return self.fetchall('SELECT %s FROM resource WHERE prid=?'%(select_what,), (prid,))
            elif cid is not None:
                return self.fetchall('SELECT %s FROM resource WHERE cid=?'%(select_what,), (cid,))
        else: # params
            query, attrs = 'SELECT %s FROM resource WHERE prid=?'%(select_what,), [prid]
            if 'like' in params:
                query += " AND rid LIKE ?"
                attrs.append(params['like'])
            # TODO: if order is specified then it fails in sqlite3.
            # hack to get all values and then apply DESC order if present
            if 'order' not in params or params['order'].upper() != "DESC": # no order, use asc default
                # TODO: fix the security risk here, sanitize params
                if 'limit' in params:
                    query += " LIMIT " + params['limit']
                if 'offset' in params:
                    query += " OFFSET " + params['offset']
                result = self.fetchall(query, attrs)
            else: # order is desc
                result = self.fetchall(query, attrs)
                result.reverse()
                limit = int(params['limit']) if 'limit' in params else len(result)
                offset = int(params['offset']) if 'offset' in params else 0
                result[:] = result[offset:offset+limit]
            return result

    def delete_all(self, cid, prid=None):
        if prid is not None:
            self.commit('DELETE FROM resource WHERE prid=? AND cid=?', (prid, cid))
        else:
            self.commit('DELETE FROM resource WHERE cid=?', (cid,))

    def set_listener(self, rid, cid):
        self.commit('REPLACE INTO subscribe (rid, cid) VALUES (?, ?)', (rid, cid))

    def has_listener(self, rid):
        return not not self.fetchone('SELECT rid FROM subscribe WHERE rid=?', (rid,))
    
    def get_listeners(self, rid):
        return self.fetchall('SELECT cid FROM subscribe WHERE rid=?', (rid,))
    
    def get_listener_resources(self, cid):
        return self.fetchall('SELECT rid FROM subscribe WHERE cid=?', (cid,))
    
    def delete_listeners(self, cid, rid=None):
        if rid is not None:
            self.commit('DELETE FROM subscribe WHERE rid=? AND cid=?', (rid, cid))
        else:
            self.commit('DELETE FROM subscribe WHERE cid=?', (cid, ))


# inmemory

import sets
from collection import OrderedDict

class Resource():
    '''
    The data model contains these pieces.
    Hierarchical resources rooted at root.
    A resource has id, parent, children to represent hierarchy.
    A resource has ctype, entity and cid to represent its data.
        The entity is not None for valid resources, but may be ''.
    A resource has xchildren to represent children that should be
        deleted when all listeners are removed on this resource.
    A resource has listeners of zero or more listener cid.
    A dict from context cid to OrderedDict of resources created by the context.
    A dict from context cid to OrderedDict of resources that context has subscribed to.
    '''
    def __init__(self):
        self.children = OrderedDict() # child rid (str) to Resource
        self.xchildren = sets.Set()   # set of child rid (str)
        self.listeners = sets.Set()   # set of listener context id (str)
        self.clear()
        
    def clear(self):
        self.id = self.parent = self.ctype = self.entity = self.context = None
        self.children.clear()
        self.xchildren.clear()
        self.listeners.clear()
    
    def __str__(self, indent=''):
        result = [indent + (self.id or 'root')]
        for rid, child in self.children.iteritems():
            result.append(child.__str__(indent+'  '))
        return '\n'.join(result)

    def locate(self, ridparts, create=False):
        if isinstance(ridparts, basestring):
            ridparts = ridparts.split('/')[1:]
        resource = self
        for part in ridparts:
            if part in resource.children:
                resource = resource.children.get(part)
            elif create:
                child = resource.children[part] = Resource()
                child.id, child.parent = part, resource
                resource = child
            else:
                return None
        return resource
    

class Context():
    def __init__(self):
        self.resources = dict() # cid (str) to odict of rid (str) to Resource
        self.subscribes = dict() # cid (str) to odict of rid (str) to Resource
    
    def clear(self):
        self.resources.clear()
        self.subscribes.clear()
        
    def __str__(self):
        return 'Created resources:\n  ' + '\n  '.join(['%s:\n    %s'%(cid, '\n    '.join(rids)) for cid, rids in self.resources.iteritems()]) + '\nSubscribed resources:\n  ' + '\n  '.join(['%s:\n    %s'%(cid, '\n    '.join(rids)) for cid, rids in self.subscribes.iteritems()])
    
    def add(self, cid, rid, resource):
        resource.context = cid
        if cid not in self.resources:
            self.resources[cid] = OrderedDict()
        resources = self.resources[cid]
        resources[rid] = resource
    
    def remove(self, cid, rid, resource):
        resource.context = None
        if cid in self.resources:
            resources = self.resources[cid]
            if rid in resources:
                del resources[rid]
                
    def subscribe(self, cid, rid, resource):
        if cid not in self.subscribes:
            self.subscribes[cid] = OrderedDict()
        subscribes = self.subscribes[cid]
        subscribes[rid] = resource
        resource.listeners.add(cid)
    
    def unsubscribe(self, cid, rid, resource):
        if cid in self.subscribes:
            subscribes = self.subscribes[cid]
            if rid in subscribes:
                del subscribes[rid]
        resource.listeners.discard(cid)


class InmemoryDatabase():
    def __init__(self, **kwargs):
        self.root = Resource()
        self.context = Context()
    
    def __str__(self):
        return '<Database\n%s\n%s\n/>'%(self.root, self.context)
    
    def reconnect(self):
        pass

    def reset(self):
        self.context.clear()
        self.root.clear()
        
    def close(self):
        pass
    

    # interface of restdbapi.ResourceDatabase

    def get(self, rid):
        logger.debug("get\n%s"%(self,))
        resource = self.root.locate(rid)
        return (resource.ctype, resource.entity) if resource and resource.entity is not None else None
    
    def insert(self, rid, prid, ctype, entity, cid, overwrite=False):
        if not overwrite:
            resource = self.root.locate(rid)
            if resource and resource.entity is not None:
                raise ValueError('resource already exists')
        ridparts = rid.split('/')[1:]
        leaf = ridparts[-1]
        parent = self.root.locate(ridparts[:-1], create=True)
        if leaf not in parent.children:
            parent.children[leaf] = Resource()
        resource = parent.children[leaf]
        
        resource.id, resource.parent = leaf, parent
        resource.ctype, resource.entity = ctype, entity
        
        if cid: # set resource context
            if cid == 'xref:parent':
                parent.xchildren.add(leaf)
            else:
                self.context.add(cid, rid, resource)
        else: # clear if previously it was set
            parent.xchildren.discard(leaf)
            self.context.remove(cid, rid, resource)
        logger.debug("insert\n%s"%(self,))

    def append(self, prid, ctype, entity, cid):
        parent = self.root.locate(prid, create=True)

        attempt = 1000
        while attempt > 0:
            leaf = uniqid()
            if leaf not in parent.children:
                break
            attempt -= 1
        if attempt <= 0:
            raise ValueError('failed to insert child to this resource')

        resource = parent.children[leaf] = Resource()
        resource.id, resource.parent = leaf, parent
        resource.ctype, resource.entity = ctype, entity
        
        if cid:
            if cid == 'xref:parent':
                parent.xchildren.add(leaf)
            else:
                self.context.add(cid, prid + '/' + leaf, resource)
        logger.debug("append\n%s"%(self,))
        return leaf
    
    def delete(self, rid):
        logger.debug("delete\n%s"%(self,))
        if isinstance(rid, Resource):
            resource = rid
        else:
            resource = self.root.locate(rid)
        if resource:
            if resource.context:
                self.context.remove(resource.context, rid, resource)
            resource.ctype = resource.entity = None
            resource.parent.xchildren.discard(resource.id)
            if len(resource.listeners) == 0 and len(resource.children) == 0:
                resource.parent.children.pop(resource.id, None)
                resource.parent = None
    
    def set_entity(self, rid, ctype, entity):
        resource = self.root.locate(rid)
        if resource and resource.entity is not None:
            resource.ctype, resource.entity = ctype, entity
        else:
            raise ValueError('resource not found')
        logger.debug("set_entity\n%s"%(self,))
    
    def count_children(self, prid):
        logger.debug("count_children\n%s"%(self,))
        parent = self.root.locate(prid)
        return len(parent.children) if parent else 0
    
    def get_all(self, prid=None, cid=None, params=None):
        logger.debug("get_all\n%s"%(self,))
        if params is None:
            if prid is not None and cid is not None:
                if cid == 'xref:parent':
                    parent = self.root.locate(prid)
                    if parent:
                        return [(prid + '/' + leaf) for leaf in parent.xchildren]
                else:
                    raise ValueError('context must be xref:parent')
            elif prid is not None:
                parent = self.root.locate(prid)
                if parent:
                    return [(prid + '/' + leaf) for leaf in parent.children]
            elif cid is not None:
                if cid in self.context.resources:
                    resources = self.context.resources[cid]
                    return [rid for rid in resources]
        else: # params
            parent = self.root.locate(prid)
            if parent:
                iterator = (rid for rid, resource in parent.children.iteritems() if resource.entity is not None)
                length = len(list(iterator))
                if 'like' in params: # like only on last part
                    leaf = params['like'].split('/')[-1].replace('%', '(.*)')
                    iterator = (x for x in iterator if re.search(leaf, x))
                if 'order' in params and params['order'].upper() == 'DESC':
                    iterator = reversed(iterator)
                start, end = 0, length
                if 'offset' in params:
                    start = int(params['offset'])
                if 'limit' in params:
                    end = start + int(params['limit'])
                return [rid for index, rid in enumerate(iterator) if index >= start and index < end]
        return []

    def delete_all(self, cid, prid=None):
        logger.debug("delete_all\n%s"%(self,))
        if prid is not None:
            if cid == 'xref:parent':
                parent = self.root.locate(prid)
                if parent:
                    parent.xchildren.clear()
        else:
            if cid in self.context.resources:
                resources = self.context.resources[cid]
                for rid, resource in resources.iteritems():
                    self.delete(resource)
            self.context.resources.pop(cid, None)

    def set_listener(self, rid, cid):
        resource = self.root.locate(rid, create=True)
        self.context.subscribe(cid, rid, resource)
        logger.debug("set_listener\n%s"%(self,))

    def has_listener(self, rid):
        logger.debug("has_listener\n%s"%(self,))
        resource = self.root.locate(rid)
        return True if resource and len(resource.listeners) > 0 else False
    
    def get_listeners(self, rid):
        logger.debug("get_listeners\n%s"%(self,))
        resource = self.root.locate(rid)
        return [cid for cid in resource.listeners] if resource else []
    
    def get_listener_resources(self, cid):
        logger.debug("get_listener_resources\n%s"%(self,))
        if cid in self.context.subscribes:
            subscribes = self.context.subscribes[cid]
            return [rid for rid in subscribes]
        return []
    
    def delete_listeners(self, cid, rid=None):
        logger.debug("delete_listeners\n%s"%(self,))
        if rid is not None:
            resource = self.root.locate(rid)
            if resource:
                self.context.unsubscribe(cid, rid, resource)
        else:
            if cid in self.context.subscribes:
                subscribes = self.context.subscribes[cid]
                for rid, resource in subscribes:
                    resource.listeners.discard(cid)
                self.context.subscribes.pop(cid, None)
    


# postgresql

import psycopg2

class PostgreSQLDatabase():
    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self._connect()
        self._create()
        self.reset();

    def _connect(self):
        self.conn = psycopg2.connect(
            database=self.kwargs.get("database", "restserver"),
            user=self.kwargs.get("user", "postgres"),
            password=self.kwargs.get("password", "artisy"),
            host=self.kwargs.get("host", "localhost"))
        self.cursor = self.conn.cursor()
    
    def reconnect(self):
        # TODO: following experimental code to reset connection on rollback
        logger.error("reconnect")
        try: self.close()
        except: pass
        try: self._connect()
        except: pass
        
    def rollback(self):
        if self.conn:
            try: self.conn.rollback()
            except: pass
    
    def semicolon(self, value):
        return value.replace('?', '%s') + ";"
    
    def _create(self):
        try:
            self.commit('''CREATE TABLE resource (
                rid varchar(1024) PRIMARY KEY NOT NULL DEFAULT '',
                prid varchar(1024) NOT NULL DEFAULT '',
                type varchar(64) NOT NULL DEFAULT 'application/json',
                entity text,
                cid varchar(25)
            );''')
            # TODO: should use entity bytea instead of text
            self.commit('''CREATE TABLE subscribe (
                rid varchar(1024) NOT NULL DEFAULT '',
                cid varchar(25) NOT NULL DEFAULT '',
                PRIMARY KEY (rid, cid)
            );''')
            logger.debug('Database created')
        except psycopg2.ProgrammingError:
            self.rollback()
            logger.debug('Database already created')
        

    def reset(self):
        # cleanup the subscribe table, since there are no subscription on startup
        try:
            self.commit("DELETE FROM subscribe;")
            self.commit("DELETE FROM resource WHERE cid != '';")
        except:
            self.rollback()
            raise
        
    def close(self):
        if self.cursor:
            self.cursor.close()
            self.cursor = None
        if self.conn:
            self.conn.close()
            self.conn = None
            
    def commit(self, *args):
        logger.debug('commit%r', args)
        try:
            self.cursor.execute(self.semicolon(args[0]), *args[1:])
            self.conn.commit()
        except:
            self.rollback()
            raise
        
    def iterate(self, *args):
        # TODO: do not use on psycopg2, because execute return None.
        logger.debug('iterate%r', args)
        try:
            return self.cursor.execute(self.semicolon(args[0]), *args[1:])
        except:
            self.rollback()
            raise
        
    def fetchone(self, *args):
        logger.debug('fetchone%r', args)
        try:
            self.cursor.execute(self.semicolon(args[0]), *args[1:])
            result = self.cursor.fetchone()
            logger.debug('fetchone%r=>\n  %r', args, result)
            return result
        except:
            self.rollback()
            raise
        
    def fetchall(self, *args):
        logger.debug('fetchall%r', args)
        try:
            self.cursor.execute(self.semicolon(args[0]), *args[1:])
            result = self.cursor.fetchall()
            logger.debug('fetchall%r=>\n  %s', args, '\n  '.join(['%r'%(x,) for x in result]))
            return result
        except:
            self.rollback()
            raise
    
    # interface of restdbapi.ResourceDatabase
    
    def get(self, rid):
        return self.fetchone('SELECT type, entity FROM resource WHERE rid=?', (rid,))
    
    
    def insert(self, rid, prid, ctype, entity, cid, overwrite=False):
        if not overwrite:
            self.commit('INSERT INTO resource (rid, prid, type, entity, cid) VALUES (?, ?, ?, ?, ?)',
                (rid, prid, ctype, entity, cid))
        else:
            try:
                self.commit('INSERT INTO resource (rid, prid, type, entity, cid) VALUES (?, ?, ?, ?, ?)',
                    (rid, prid, ctype, entity, cid))
            except:
                self.commit('UPDATE resource SET prid=?, type=?, entity=?, cid=? WHERE rid=?',
                    (prid, ctype, entity, cid, rid))
    
    
    def append(self, prid, ctype, entity, cid):
        attempt = 1000
        while attempt > 0:
            rid = uniqid()
            resource = prid + '/' + rid
            try:
                self.insert(resource, prid, ctype, entity, cid)
                return rid
            except:
                logger.info('failed to insert resource')
            attempt -= 1
        if attempt <= 0:
            raise ValueError('failed to insert child to this resource')
    
    
    def delete(self, rid):
        return self.commit('DELETE FROM resource WHERE rid=?', (rid,))
    
    
    def set_entity(self, rid, ctype, entity):
        self.commit('UPDATE resource SET type=?, entity=? WHERE rid=?', (ctype, entity, rid))
    

    def count_children(self, prid):
        return self.fetchone('SELECT count(rid) FROM resource WHERE prid=?', (prid,))
    
    
    def get_all(self, prid=None, cid=None, params=None, select_what="rid"):
        if params is None:
            if prid is not None and cid is not None:
                return self.fetchall('SELECT %s FROM resource WHERE prid=? AND cid=?'%(select_what,), (prid, cid))
            elif prid is not None:
                return self.fetchall('SELECT %s FROM resource WHERE prid=?'%(select_what,), (prid,))
            elif cid is not None:
                return self.fetchall('SELECT %s FROM resource WHERE cid=?'%(select_what,), (cid,))
        else: # params
            query, attrs = 'SELECT %s FROM resource WHERE prid=?'%(select_what,), [prid]
            if 'like' in params:
                query += " AND rid LIKE ?"
                attrs.append(params['like'])
            # TODO: if order is specified then it fails in sqlite3.
            # hack to get all values and then apply DESC order if present
            if 'order' not in params or params['order'].upper() != "DESC": # no order, use asc default
                # TODO: fix the security risk here, sanitize params
                if 'limit' in params:
                    query += " LIMIT " + params['limit']
                if 'offset' in params:
                    query += " OFFSET " + params['offset']
                result = self.fetchall(query, attrs)
            else: # order is desc
                result = self.fetchall(query, attrs)
                result.reverse()
                limit = int(params['limit']) if 'limit' in params else len(result)
                offset = int(params['offset']) if 'offset' in params else 0
                result[:] = result[offset:offset+limit]
            return result

    
    def delete_all(self, cid, prid=None):
        if prid is not None:
            self.commit('DELETE FROM resource WHERE prid=? AND cid=?', (prid, cid))
        else:
            self.commit('DELETE FROM resource WHERE cid=?', (cid,))

    
    def set_listener(self, rid, cid):
        try:
            self.commit('INSERT INTO subscribe (rid, cid) VALUES (?, ?)', (rid, cid))
        except:
            logger.debug('failed to insert subscribe, probably already exists')

    
    def has_listener(self, rid):
        return not not self.fetchone('SELECT rid FROM subscribe WHERE rid=?', (rid,))
    
    
    def get_listeners(self, rid=None):
        return self.fetchall('SELECT cid FROM subscribe WHERE rid=?', (rid,))
    
    
    def get_listener_resources(self, cid):
        return self.fetchall('SELECT rid FROM subscribe WHERE cid=?', (cid,))
    
    
    def delete_listeners(self, cid, rid=None):
        if rid is not None:
            self.commit('DELETE FROM subscribe WHERE rid=? AND cid=?', (rid, cid))
        else:
            self.commit('DELETE FROM subscribe WHERE cid=?', (cid, ))
    


# request handler

class Handler():
    def __init__(self, db):
        self.db = db

    def POST(self, request):
        parent, ctype, entity, persistent = request['resource'], request.get('type', 'application/json'), \
            json.dumps(request.get('entity', {})), request.get('persistent', False)
        rid = ''
        cid = self.id if not persistent else '' if persistent == True else str(persistent)
        if 'id' in request: # one attempt
            rid = request.get('id')
            resource = parent + '/' + rid
            try:
                self.db.insert(resource, parent, ctype, entity, cid)
            except:
                logger.error('failed to insert resource, probably exists')
                return dict(code='failed', reason='failed to insert this resource')
        else: # multiple attempts
            try:
                rid = self.db.append(parent, ctype, entity, cid)
                resource = parent + '/' + rid
            except:
                logger.error('failed to insert resource, probably exists')
                return dict(code='failed', reason='failed to insert this resource')
        self.NOTIFY(resource, 'POST')
        return dict(code='success', id=rid)
    
    def PUT(self, request):
        resource, attr, ignore = self._parse(request['resource'])
        ctype, entity, persistent, partial = request.get('type', 'application/json'), \
            json.dumps(request.get('entity', {})), request.get('persistent', False), \
            request.get('partial', False)
        exists = True
        if attr or partial:
            result = None
            try:
                result = self.db.get(resource)
            except:
                logger.exception('failed to get resource')
            if not result:
                return dict(code='failed', reason='failed to get the resource')
            
            result = json.loads(result[1])
            if attr:
                result[attr] = request.get('entity', None);
            else:
                for attr, value in json.loads(entity).items():
                    result[attr] = value
            entity = json.dumps(result)
            try:
                self.db.set_entity(resource, 'application/json', entity)
            except:
                logger.exception('failed to replace resource attribute')
                return dict(code='failed', reason='failed to replace resource attribute')
        else:
            try:
                result = self.db.get(resource)
                if not result:
                    exists = False
            except:
                exists = False
                logger.exception('failed to get resource')

            parent = self.get_parent(resource)
            cid = self.id if not persistent else '' if persistent == True else str(persistent)
            try:
                self.db.insert(resource, parent, ctype, entity, cid, overwrite=True)
            except:
                logger.exception('failed to replace resource')
                return dict(code='failed', reason='failed to replace this resource')
        self.NOTIFY(resource, 'PUT' if exists else 'PUT-POST')
        return dict(code='success')
    
    def GET(self, request):
        resource, attr, params = self._parse(request['resource'])
        if attr:
            result = None
            try:
                result = self.db.get(resource,)
                entity = json.loads(result[1])
                if attr in entity:
                    return dict(code="success", resource=request['resource'], entity=json.dumps(entity[attr]))
                else:
                    return dict(code="failed", reason="failed to get this resource attribute")
            except:
                logger.exception('failed to read resource')
            return dict(code='failed', reason='failed to get this resource')
        elif params:
            deep = params.get('deep', '1')
            try:
                what = 'rid, type, entity' if deep == '2' else 'count(rid)' if deep == '0' else 'rid'
                result = self.db.get_all(prid=resource, params=params, select_what=what)
            except:
                logger.exception('failed to read parent resource')
                return dict(code='failed', reason='failed to get child resources')
            if deep == '0':
                response = {"count": result[0][0]}
            elif deep == '2':
                response = [{"rid": (row[0][len(resource)+1:] if row[0].startswith(resource) else row[0]), "type": row[1], "entity": json.loads(row[2])} for row in result]
            else:
                response = [(row[0][len(resource)+1:] if row[0].startswith(resource) else row[0]) for row in result]
        else:
            try:
                result = self.db.get(resource)
            except:
                logger.exception('failed to read resource')
                return dict(code='failed', reason='failed to get this resource')
            if result:
                ctype, entity = result[0], json.loads(result[1])
                entity = dict([(k, v) for k, v in entity.iteritems() if not k or k[0] != "_"])
                return dict(code='success', resource=resource, type=ctype, entity=entity)
            try:
                result = self.db.get_all(prid=resource)
            except:
                logger.exception('failed to read parent resource')
                return dict(code='failed', reason='failed to get child resources')
            response = [(row[0][len(resource)+1:] if row[0].startswith(resource) else row[0]) for row in result]
        if response:
           return dict(code='success', resource=resource, type='application/json', entity=response)
        return dict(code='failed', reason='no value found for this resource')
    
    def DELETE(self, request):
        resource = request['resource']
        try:
            result = self.db.get(resource)
        except:
            logger.exception('failed to find resource to delete')
            return dict(code='failed', reason='failed to find resource to delete')
        # TODO: why did I need to do prevent deleting if it has children?
        #if result[0]:
        #    return dict(code='failed', reason='this parent resource has children')
        self.db.delete(resource)
        self.NOTIFY(resource, 'DELETE')
        return dict(code='success')
    
    def SUBSCRIBE(self, request):
        resource = request['resource']
        try:
            self.db.set_listener(resource, self.id)
        except:
            logger.exception('failed to replace subscribe')
            return dict(code='failed', reason='failed to subscribe the client to the resource')
        return dict(code='success')
    
    def UNSUBSCRIBE(self, request):
        resource = request['resource']
        try:
            self.db.delete_listeners(self.id, resource)
        except:
            logger.exception('failed to delete subscribe')
            return dict(code='failed', reason='failed to unsubscribe the client from the resource')
        return dict(code='success')
    
    # to be overridden by the sub-class if it supports NOTIFY
    def NOTIFY(self, request, method=None):
        pass 

    def notifier(self, request, method=None):
        if method: # notification due to POST, PUT or DELETE (or PUT-POST)
            resource = request
            # TODO: change 'from': self.id in the php code too.
            notify = {'notify': method if method != 'PUT-POST' else 'PUT', 'resource': resource, 'type': None, 'entity': None, 'from': self.id}
            if method == 'PUT' or method == 'POST' or method == 'PUT-POST':
                try:
                    result = self.db.get(resource)
                except:
                    logger.exception('failed to get this resource')
                    raise ValueError('failed to get this resource')
                if result:
                    notify['type'], entity = result[0], json.loads(result[1])
                    notify['entity'] = dict([(k, v) for k, v in entity.iteritems() if not k or k[0] != "_"])
            # TODO: also send to parent resource
        else:
            notify = {'notify': 'NOTIFY', 'resource': request['resource'], 'data': request['data'], 'from': self.id}
    
        param = json.dumps(notify)
        # param = str_replace("\/", "/", $param);
        
        try:
            result = self.db.get_listeners(notify['resource'])
        except:
            logger.exception('failed to get this resource subscribers')
            raise ValueError('failed to get this resource subscribers')
        
        for row in result:
            yield (row[0], param)
        
        if method in ('POST', 'PUT', 'DELETE', 'PUT-POST'):
            parent = self.get_parent(notify['resource'])
            change = {'notify': 'UPDATE', 'resource': parent, 'type': notify['type'], 'entity': notify['entity']}
            child = notify['resource']
            index = child.rfind('/')
            if index >= 0:
                child = child[index+1:]
            change[{'POST': 'create', 'PUT': 'update', 'DELETE': 'delete', 'PUT-POST': 'create'}.get(method)] = child
            result = self.db.get_listeners(parent)
            param = json.dumps(change)
            # param = str_replace("\/", "/", $param);
            
            logger.debug('%s change=%r param=%r', self.id, change, param)
            for row in result:
                yield (row[0], param)
        
    
    def close(self):
        logger.info('%s connection closed', self.id)
        subscribes = self.db.get_listener_resources(self.id)
        self.db.delete_listeners(cid=self.id)
        resources = self.db.get_all(cid=self.id)
        self.db.delete_all(cid=self.id)
        for row in resources:
            self.NOTIFY(row[0], 'DELETE')
        try:
            for row in subscribes:
                one = self.db.has_listener(rid=row[0])
                if not one: # no more subscribers for this resource, delete all xref:parent children
                    children = self.db.get_all(cid='xref:parent', prid=row[0])
                    self.db.delete_all(cid='xref:parent', prid=row[0])
                    for row1 in children:
                        self.NOTIFY(row1[0], 'DELETE')
        except:
            logger.exception('failed to cleanup on close')
    
    def get_parent(self, resource):
        index = resource.rfind('/')
        return resource[:index] if index >= 0 else ''
        
    def _parse(self, value):
        match = re.match(r'([^\[\?]+)(\[([^\]\?]*)\])?(\?.*)?$', value)
        if not match: return (value, None, None)
        groups = match.groups()
        return (groups[0], groups[2], dict([x.split('=', 1) for x in groups[3][1:].split('&')]) if groups[3] else None)
        
    
