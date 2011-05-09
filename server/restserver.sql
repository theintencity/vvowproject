/*
Each resource for the REST interface is identified by the resource URL (rid), and
is presented by the entity in the given type (e.g., "application/json"). The entity
is a blob to allow both text and binary data. If client id is supplied then this resource
is deleted when the client with that id is disconnected. This allows the client
to create transient or persistent resources.
*/

drop table resource;
create table resource (
    rid varchar(512) PRIMARY KEY NOT NULL DEFAULT '',
    prid varchar(512) NOT NULL DEFAULT '',
    type varchar(64) NOT NULL DEFAULT 'application/json',
    entity blob,
    cid varchar(25)
);

/*
Each subscriber for a resource is stored in the subscribe table which contains
resource URL (rid) and client information. When the client disconnects all
its subscriptions are deleted. When a resource is deleted, the subscriptions stay
active, in case the resource is recreated and if the resource does not have a cid.
If you subscribe for a resource URL /a/b then you will receive any change in that
or its immediate children, e.g., /a/b/c but not another item parallel to it,
e.g., /a/e. To avoid overloading the server subscribe to very specific resource
instead of general ones.
*/

drop table subscribe;
create table subscribe (
    rid varchar(512) NOT NULL DEFAULT '',
    cid varchar(25) NOT NULL DEFAULT '',
    PRIMARY KEY (rid, cid)
);
