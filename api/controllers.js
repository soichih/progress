
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
    if(!config.statusPrec) {
        config.statusPrec = function statusPrec(status) {
            //TODO - I should make this configurable.. or make so that the latest status takes precedence?
            switch(status) {
            case "running": return 4;
            case "failed": return 3;
            case "canceled": return 2;
            case "finished": return 1;
            case "waiting": return 0;
            default:
                return -1;
            }
        }
    }

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
                conn.exchange(config.progress.exchange, {autoDelete: false, durable: true, type: 'topic'}, function(ex) {
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
    db.hgetall(key, function(err, node) {
        if(err) return cb(err);
        if(node) {
            //fix field types
            if(node.progress) node.progress = parseFloat(node.progress);
            if(node.weight) node.weight = parseInt(node.weight);
            if(node.start_time) node.start_time = parseInt(node.start_time);
            if(node.end_time) node.end_time = parseInt(node.end_time);
            if(node.update_time) node.update_time = parseInt(node.update_time);

            //get childlist
            db.smembers(key+"._children", function(err, children) {
                if(err) return cb(err);
                node._children = children;
                cb(null, node);
            });
        } else {
            cb(null); //not found
        }
    });
}

function set_node(key, node, cb) {
    //assert(cb.arguments.length == 1);
    //TODO - validate?

    node.key = key; 
    if(node.weight === undefined) node.weight = 1; //relative complexity relative to siblings
    if(node.start_time === undefined) {
        node.start_time = Date.now();
        logger.debug("setting start_time:"+node.start_time+" for "+key);
    }
    if(node.progress == 1) node.end_time = Date.now(); //mark completion time 
    node.update_time = Date.now(); //mark update time (TODO - so that we can purge old records later)
    db.hmset(key, node, cb);
}

function get_parent_key(key) {
    assert(key);
    var pos = key.lastIndexOf(".");
    if(pos === -1) return null;
    return key.substring(0, pos);
}

function aggregate_children(key, node, cb) {
    if(!node._children || node._children.length == 0) {
        //don't have any children
        cb();
    } else {
        //do weighted aggregation
        var total_progress = 0;
        var total_weight = 0;
        async.eachSeries(node._children, function(child_key, next) {
            get_node(child_key, function(err, child) {
                if(err) throw err;
                if(child !== undefined) { //child could go missing?
                    //aggregate progess
                    if(child.progress) {
                        total_progress += child.progress * child.weight;
                    }
                    total_weight += child.weight;
                }
                next();
            });
        }, function(err) {
            //update my progress based on child's progress
            if(total_weight != 0) {
                node.progress = total_progress / total_weight;
            }
            cb();
        });
    }
}

function get_state(key, depth, cb) {
    get_node(key, function(err, node) {
        if(err) throw err;

        //status not yet posted, or incorrect key
        if(node === undefined) return cb();

        depth--;
        if(depth > 0) {
            if(node._children.length == 0) {
                //doesn't have any children
                cb(null, node);
            } else {
                node.tasks = [];
                async.eachSeries(node._children, function(child_key, next) {
                    //console.log("getting state from "+child_key);
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
        } else {
            cb(null, node); //all done
        }
    });
}

function update(key, node, updates, cb) {
    //first aggreage child info (to calculate progress)
    aggregate_children(key, node, function() {
        
        //then update the node received
        set_node(key, node, function(err) {
            if(err) throw err;
    
            //store updates in reverse order so that parent node goes before child
            //since we are travering from child to parent. sending parent first to socket.io
            //simplifies client task
            updates.unshift(node);

            //find parent key
            var parent_key = null;
            var pos = key.lastIndexOf(".");
            if(pos !== -1) parent_key = key.substring(0, pos);
            if(parent_key == null) return cb(null); //we've bubbled up to the root... all done
            
            //find next parent edge
            var edge_key = parent_key;
            pos = parent_key.lastIndexOf(".");
            if(pos !== -1) edge_key = parent_key.substring(pos+1);
            if(edge_key[0] == "_") return cb(null); //parent_key that starts with _ is a root (like _portal) Don't bubble up to it

            //get parent to bubble up to
            get_node(parent_key, function(err, p) {
                if(err) throw err;
                
                //handle case where parent node wasn't reported (children reported first?)
                if(p === undefined) p = {_children: []}; 
                
                //make sure my parent knows me
                if(!~p._children.indexOf(key))  {
                    db.sadd(parent_key+"._children", key); 
                    p._children.push(key);
                }

                //bubble up msg
                if(node.msg) p.msg = node.msg;
                //if(node.name) p.msg = node.name + " " +p.msg; //prefix with node name if available (not very often that this is useful)
    
                //finally recurse up to the parent
                update(parent_key, p, updates, cb);
            });
        });
    });
}

//handled new progress event
function progress(p, headers, info, ack) {
    var key = info.routingKey;
    var updates = [];
    do_update(key, p, updates, function() {
        ack.acknowledge()
    });
}

function do_update(key, p, updates, cb) {
    get_node(key, function(err, node) {
        if(err) return cb(err);
        if(!node) node = {}; //new one
        logger.debug(p);
        for(var k in p) node[k] = p[k]; //merge
        update(key, node, updates, function(err) {
            emit(updates);
            cb();
        });
    });
}

function emit(updates) {
    //send socket_io update to appriate room
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

//return current progress status
router.get('/status/:key', /*jwt({secret: config.express.jwt.pub, credentialsRequired: false}),*/ function(req, res, next) {
    //if(!req.query.key) throw new Error("please specify key param");
    var key = req.params.key;
    var depth = req.query.depth || 1;
    get_state(key, depth, function(err, state) {
        if(err) return next(err);
        res.json(state);
    });
});

//let's make this public for now.. in the future, progress service can issue its own authentication token (like imagex service?)
router.post('/status/:key', /*jwt({secret: config.express.jwt.pub, credentialsRequired: false}),*/ function(req, res, next) {
    var key = req.params.key;
    var p = req.body;
    logger.debug("key:"+key+"\n"+JSON.stringify(p, null, 4));
    /*
    progress_ex.publish(key, p, function(err) {
        if(err) return next(err);
        res.end();
    });
    */
    var updates = [];
    do_update(key, p, updates, function() {
        res.end();
    });
});

exports.router  = router;
