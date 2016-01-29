
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
            //fix field types
            if(node.progress) node.progress = parseFloat(node.progress);
            if(node.weight) node.weight = parseFloat(node.weight);
            if(node.start_time) node.start_time = parseInt(node.start_time);
            //if(node.end_time) node.end_time = parseInt(node.end_time);
            if(node.update_time) node.update_time = parseInt(node.update_time);
            if(node._total_progress) node._total_progress = parseFloat(node._total_progress);
            if(node._total_weight) node._total_weight = parseFloat(node._total_weight);
            cb(null, node);
        } else {
            cb(null); //not found
        }
    });
}

function get_children(key, cb) {
    //logger.debug("smembers:"+key+"._children");
    db.smembers(key+"._children", cb);
}

function set_node(key, node, cb) {
    //assert(cb.arguments.length == 1);
    //TODO - validate?

    node.key = key; 

    if(node._total_progress === undefined) node._total_progress = 0;
    if(node._total_weight === undefined) node._total_weight = 0;

    if(node.weight === undefined) node.weight = 1; //relative complexity relative to my siblings
    if(node.start_time === undefined) {
        node.start_time = Date.now();
        //logger.debug("setting start_time:"+node.start_time+" for "+key);
    }
    //if(node.progress == 1) node.end_time = Date.now(); //mark completion time 
    node.update_time = Date.now(); //mark update time (TODO - so that we can purge old records later)
    //logger.debug("hmset:"+key);
    db.hmset(key, node, cb);
}

function get_parent_key(key) {
    assert(key);
    var pos = key.lastIndexOf(".");
    if(pos === -1) return null;
    return key.substring(0, pos);
}

/*
function aggregate_children(key, node, cb) {
    get_children(key, function(err, children) {
        if(err) return cb(err);
        if(!children || children.length == 0) {
            //don't have any children
            cb();
        } else {
            //do weighted aggregation
            var total_progress = 0;
            var total_weight = 0;
            async.eachSeries(children, function(child_key, next) {
                get_node(child_key, function(err, child) {
                    if(err) return cb(err);
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
                if(err) return cb(err);
                //update my progress based on child's progress
                if(total_weight != 0) {
                    node.progress = total_progress / total_weight;
                }
                cb();
            });
        }
    });
}
*/

function update(key, node, updates, delta, cb) {
    //first aggreage child info (to calculate progress)
    //aggregate_children(key, node, function(err) {
    //    if(err) return cb(err); 
        //then update the node received
        set_node(key, node, function(err) {
            if(err) return cb(err);
    
            //store updates in reverse order so that parent node goes before child
            //since we are travering from child to parent. sending parent first to socket.io
            //simplifies client task (I think it's so that missing parents can get inserted before child)
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
                if(err) return cb(err);
                var parent_delta = {progress: 0, weight: 0};
                if(p === undefined) {
                    //parent doesn't exist yet.. create placeholder
                    p = {      
                        _total_progress: 0, 
                        _total_weight: 0, 
                        progress: 0, 
                        weight: 1
                    }; 
                    parent_delta.weight = 1;
                }
                
                //bubble up msg
                if(node.msg) p.msg = node.msg;
                //if(node.name) p.msg = node.name + " " +p.msg; //prefix with node name if available (not very often that this is useful)
                //console.log("parent before");
                //console.dir(p);

                //update parent total
                p._total_progress += delta.progress;
                p._total_weight += delta.weight;
                if(p._total_weight != 0) {
                    var new_progress = p._total_progress / p._total_weight;
                    //console.log("parent's new progress: "+new_progress);
                    parent_delta.progress = new_progress - p.progress;
                    p.progress = new_progress;
                }
                /*
                console.log("delta");
                console.dir(delta);
                console.log("parent(delta applied)");
                console.dir(p);
                console.log("parent-delta");
                console.dir(parent_delta);
                */

                update(parent_key, p, updates, parent_delta, function(err) {
                    if(err) return cb(err);
            
                    //lastly.. make sure my parent knows me
                    get_children(parent_key, function(err, children) {
                        if(err) return cb(err);
                        if(!~children.indexOf(key))  {
                            //logger.debug("sadd:"+parent_key+"._children "+key);
                            db.sadd(parent_key+"._children", key); 
                        }
                        cb();
                    });
                });

            });
        });
    //});
}

//handled new progress event from amqp
function progress(p, headers, info, ack) {
    var key = info.routingKey;
    //var updates = [];
    do_update(key, p, /*updates,*/ function(err) {
        if(err) throw err; //TODO - should I?
        ack.acknowledge()
    });
}

//amount of progress / weight change as seen by its parent
function compute_delta(o, n) {
    var d = {
        progress: (n.progress*n.weight) - (o.progress*o.weight),
        weight: n.weight - o.weight,
    };
    return d;
}


function do_update(key, p, /*updates,*/ cb) {
    get_node(key, function(err, node) {
        if(err) return cb(err);
        if(!node) {
            node = {weight: 0, progress: 0}; //new one
        }
        if(p.weight == undefined) p.weight = 1;
        if(p.progress == undefined) p.progress = 0;
        var delta = compute_delta(node, p);
        //console.log("delta is");
        //console.dir(delta);
        for(var k in p) node[k] = p[k]; //update values
        var updates = []; //list updates to be emitted to subscribers(ui)
        update(key, node, updates, delta, function(err) {
            if(err) return cb(err);
            emit(updates);
            cb();
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
        //logger.debug("emitting updates to "+room);
        //logger.debug(updates);
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
                //node._children = children;
                if(children.length == 0) {
                    //doesn't have any children
                    cb(null, node);
                } else {
                    node.tasks = [];
                    async.eachSeries(children, function(child_key, next) {
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
            });
        } else {
            cb(null, node); //all done
        }
    });
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
    
    progress_ex.publish(key, p, {}, function(err) {
        //logger.debug("published");
        if(err) return next(err);
        res.json({status: 'published'});
    });
    /*
    do_update(key, p, function(err) {
        if(err) return next(err);
        res.end();
    });
    */
});

exports.router  = router;

