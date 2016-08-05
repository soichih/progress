'use strict';

//node
var fs = require('fs');
var spawn = require('child_process').spawn;

//contrib
var winston = require('winston');
var amqp = require('amqp');
var redis = require('redis');
var async = require('async');
var express = require('express');
var router = express.Router();

//mine
var config = require('./config');
var logger = new winston.Logger(config.logger.winston);

//polyfill?
function assert(condition, message) {
    if (!condition) throw new Error(message || "Assertion failed");
}

var db = null;
var progress_q = null;
var progress_ex = null; //for /update
var socket_io = null; //socket io

exports.set_socketio = function(_socket_io) {
    socket_io = _socket_io;
}

exports.init = function(cb) {
    var connected_once = false;
    
    //do initializations in series
    async.series([
        //connect to redis
        function(done) {
            logger.info("connecting to redis "+config.progress.redis.server+" "+config.progress.redis.port);
            db = redis.createClient(config.progress.redis.port, config.progress.redis.server);
            db.on('connect', done);
        },
        
        //connect to amqp
        function(done) {
            logger.info("connecting to amqp");
            var conn = amqp.createConnection(config.progress.amqp, {reconnectBackoffTime: 1000*10});
            conn.on('ready', function() {
                logger.info("amqp handshake complete");
                conn.exchange(config.progress.exchange, {autoDelete: false, durable: true, type: 'topic', confirm: true}, function(ex) {
                    progress_ex = ex;
                    logger.info("amqp connected to exchange:"+config.progress.exchange);
                    conn.queue(config.progress.queue, {durable: true, autoDelete: false}, function(q) {
                        progress_q = q;
                        logger.info("binding to queue:"+config.progress.queue);
                        q.bind(ex, '#');
    
                        //sometime amqp re-connect.. I don't need to redo the rest of init for that.
                        if(!connected_once) {
                            connected_once = false;
                            done();
                        }
                    });
                });
            });
            conn.on('error', function(err) {
                logger.warn("amqp received error.", err);
            });
        },

        //finally, subscribe to the progress_q
        function(done) {
            progress_q.subscribe({ack: true}, progress);
            done();
        }
    ], function(err, results) {
        logger.info("finished initializing controller");
        if(cb) cb();
    });
}

function get_node(key, cb) {
    //logger.debug("hgetall:"+key);
    db.hgetall(key, function(err, node) {
        if(err) return cb(err);
        if(node) {
            //fix field types (redis stores everything as string so I need to conver to int/float..
            if(node.progress) node.progress = parseFloat(node.progress);
            if(node.weight) node.weight = parseFloat(node.weight);
            if(node.start_time) node.start_time = parseInt(node.start_time);
            if(node.update_time) node.update_time = parseInt(node.update_time);
            if(node._children_pw) node._children_pw = parseFloat(node._children_pw);
            if(node._children_w) node._children_w = parseFloat(node._children_w);
            cb(null, node);
        } else {
            cb(null); //not found
        }
    });
}

function get_children(key, cb) {
    db.smembers(key+"._children", cb);
}

function set_node(key, node, cb) {
    node.key = key; 
    //can I move this elsewhere? and refactor this out?
    if(node.start_time === undefined) node.start_time = Date.now();
    node.update_time = Date.now(); //mark update time (TODO - so that we can purge old records later)
    db.hmset(key, node, cb);
}

function get_parent_key(key) {
    assert(key);
    var pos = key.lastIndexOf(".");
    if(pos === -1) return null;
    return key.substring(0, pos);
}

function update(key, node, updates, delta, cb) {
    //first aggreage child info (to calculate progress) then update the node received
    set_node(key, node, function(err) {
        if(err) return cb(err);
        logger.debug("updating "+key);

        //store updates in reverse order so that parent node goes before child
        //since we are travering from child to parent. sending parent first to socket.io
        //simplifies client task (I think it's so that missing parents can get inserted before child)
        updates.unshift(node);

        //find parent key by stipping the last segment of the key
        var parent_key = null;
        var pos = key.lastIndexOf(".");
        if(pos !== -1) parent_key = key.substring(0, pos);
        if(parent_key == null) return cb(null); //we've bubbled up to the root... all done

        logger.debug("parent "+parent_key);
        
        //find next parent edge
        var edge_key = parent_key;
        pos = parent_key.lastIndexOf(".");
        if(pos !== -1) edge_key = parent_key.substring(pos+1);
        if(edge_key[0] == "_") return cb(null); //parent_key that starts with _ is a root (like _portal) Don't bubble up to it

        //get parent to bubble up to
        get_node(parent_key, function(err, p) {
            if(err) return cb(err);
            var newparent = false;
            if(p === undefined) {
                newparent = true;
                p = {};
            }

            //copy parent to new_parent (so that I can compute delta later)
            var new_parent = {_children_pw: 0, _children_w: 0};
            for(var k in p) new_parent[k] = p[k];

            //apply delta
            new_parent._children_pw += delta.pw;
            new_parent._children_w += delta.w;

            //finally update parent progress (if computable)
            if(new_parent._children_w != 0) {
                new_parent.progress = new_parent._children_pw / new_parent._children_w;
            } else {
                //if children_w is 0, parent progress should be set to the average of children_p (but I don't have such info..)
            }

            var parent_delta = delta_calc(p, new_parent);
            if(newparent) parent_delta.w = 1;
            
            //always bubble up msg
            if(node.msg) new_parent.msg = node.msg;

            update(parent_key, new_parent, updates, parent_delta, function(err) {
                if(err) return cb(err);
        
                //lastly.. make sure my parent knows me
                get_children(parent_key, function(err, children) {
                    if(err) return cb(err);
                    if(!~children.indexOf(key))  {
                        db.sadd(parent_key+"._children", key); 
                    }
                    cb();
                });
            });

        });
    });
}

//calculate pw and w change
function delta_calc(old, _new) {
    var old_p = old.progress;
    if(old_p === undefined) old_p = 0; 
    var new_p = _new.progress;
    if(new_p === undefined) new_p = old_p;

    var old_w = old.weight;
    if(old_w === undefined) old_w = 1; 
    var new_w = _new.weight;
    if(new_w === undefined) new_w = old_w; 

    var old_pw = old_p * old_w;
    var new_pw = new_p * new_w;

    return {
        pw: new_pw - old_pw,
        w: new_w - old_w,
    }
}

function progress(p, headers, info, ack) {
    var key = info.routingKey;
    get_node(key, function(err, node) {
        if(err) throw err; //should I throw?
        var newnode = false;
        if(!node) {
            newnode = true;
            node = {}; //brand new
        }
        var delta = delta_calc(node, p);

        //new child is added
        if(newnode) {
            delta.w = p.weight; //use value specified by user if exists
            if(p.weight === undefined) delta.w = 1; //if not, assume 1
        }

        for(var k in p) node[k] = p[k]; //update values as requested
        var updates = []; //list updates to be emitted to subscribers(ui)
        update(key, node, updates, delta, function(err) {
            if(err) throw err;
            emit(updates);
            ack.acknowledge()
        });
    });
}

//emit updates via socket.io
function emit(updates) {
    if(socket_io && updates.length > 0) {
        var first_update = updates[0];
        //grab upto first non '_' key. (_test.fc1d66d80bd)
        var tokens = first_update.key.split(".");
        var room = "";
        for(var i = 0;i < tokens.length;++i) {
            if(room != "") room += ".";
            room += tokens[i];
            if(tokens[i][0] != "_") break;
        };
        socket_io.to(room).emit('update', updates);
    }
}

function get_state(key, depth, cb) {
    get_node(key, function(err, node) {
        if(err) return cb(err);

        //status not yet posted, or incorrect key
        if(node === undefined) return cb();

        depth--;
        if(depth > 0) {
            get_children(key, function(err, children) {
                if(err) return cb(err);
                if(children.length == 0) {
                    //doesn't have any children
                    cb(null, node);
                } else {
                    node.tasks = [];
                    async.eachSeries(children, function(child_key, next) {
                        get_state(child_key, depth, function(err, child_state) {
                            node.tasks.push(child_state);
                            next();
                        });
                    }, function(err) {
                        //TODO should I let client worry about ordering?
                        node.tasks.sort(function(a,b) {
                            return a.start_time - b.start_time;
                        });
                        cb(err, node);
                    });
                } 
            });
        } else {
            cb(null, node); //all done
        }
    });
}

function handle_get_status(req, res, next) {
    var key = req.params.key;
    var depth = req.query.depth||1;
    get_state(key, depth, function(err, state) {
        if(err) return next(err);
        if(!state) {
            res.json({
                key: req.params.key,
                missing: true,
            });
        } else res.json(state);
    });
}
router.get('/status/:key', handle_get_status); //DEPRECATED - use without /status
/**
 * @api {get} /:key             Get Progress
 * @apiGroup                    Status
 * @apiDescription              Returns all tasks that belongs to a user. 
 *
 * @apiParam {Number} [depth]   How deep you want to traverse the progress tree. Default to 1
 * 
 * @apiSuccessExample {json}    Success-Response:
 *      HTTP/1.1 200 OK
 *      {
 *          "msg":"doing 0.5098086714278907",
 *          "key":"_test.100",
 *          "weight":1,
 *          "start_time":1454074695846,
 *          "update_time":1454074834012,
 *          "tasks":    [
 *              {
 *                  "_total_weight":"0",
 *                  "_total_progress":"0.22608440299518406",
 *                  "msg":"doing 0.5098086714278907",
 *                  "key":"_test.100.1",
 *                  "weight":1,
 *                  "start_time":1454074695843,
 *                  "update_time":1454074834011
 *              }
 *          ]
 *      }
 *
 */
router.get('/:key', handle_get_status);

//TODO - let's make this public for now.. in the future, progress service can issue its own authentication token (like imagex service?)
function handle_post_status(req, res, next) {
    var key = req.params.key;
    var p = req.body;
    logger.debug("key:"+key+"\n"+JSON.stringify(p, null, 4));
    
    //REST API just post to AMQP.. and 
    progress_ex.publish(key, p, {}, function(err) {
        if(err) return next(err);
        res.json({status: 'published'});
    });
}
router.post('/status/:key', handle_post_status); //DEPRECATED - use without /status
/**
 * @api {post} /:key            Update Progress
 * @apiGroup                    Status
 * @apiDescription              Post a new progress update This API simply forward the request to AMQP server that this service listens to.
 *
 * @apiParam {Number} [weight]  Weight of the node (used to compute parent progress)
 * @apiParam {String} [name]    Name/title of the node
 * @apiParam {String} [msg]     Status message
 * @apiParam {Number} [progress] Progress of the node (0 to 1.0)
 * @apiParam {String} [status]  Status of this node. Please use one of following: waiting / running / finished / failed / canceled / (paused)
 *
 * @apiSuccessExample {json}    Success-Response:
 *      HTTP/1.1 200 OK
 *      {"status":"published"}
 *
 */
router.post('/:key', handle_post_status);

//recursively delete node (children first)
function delete_node(key, cb) {
    get_node(key, function(err, node) {
        if(err) return cb(err);
        if(!node) return cb("no such key:"+key);
        db.smembers(key+"._children", function(err, children){
            if(err) next(err);
            async.eachSeries(children, function(child, next) {
                delete_node(child, next);
            }, function(err) {
                if(err) next(err); //failed to delete one of the child
                //delete ._children
                db.del(key+"._children", function(err) {
                    //finally, delete myself
                    db.del(key, cb);
                });
            });
        });
    });
}

//TODO - I really need to implement access control - anyone can delete the whole _sca...
/**
 * @api {delete} /:key  Remove Progress 
 * @apiGroup            Status
 * @apiDescription      Remove all progress nodes under a key
 *
 * @apiSuccessExample {json}    Success-Response:
 *      HTTP/1.1 200 OK
 *      {"status":"removed _test.scott1 and its children"}                        
 */
router.delete('/:key', function(req, res, next) {
    var key = req.params.key;
    logger.debug("deleting "+key);
    delete_node(key, function(err, count) {
        if(err) return next(err);
        res.json({status: "removed "+key+" and its children"}); 
    });
});

exports.router  = router;


