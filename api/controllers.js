
//node
var fs = require('fs');
var spawn = require('child_process').spawn;

//contrib
var winston = require('winston');
var amqp = require('amqp');
var redis = require('redis');
var async = require('async');

//mine
var config = require('./config/config');
var logger = new winston.Logger(config.logger.winston);

//polyfill?
function assert(condition, message) {
    if (!condition) throw new Error(message || "Assertion failed");
}

var db = null;
var progress_q = null;

exports.init = function(cb) {
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
                    logger.info("amqp connected to exchange:"+config.progress.exchange);
                    conn.queue(config.progress.queue, {durable: true, autoDelete: false}, function(q) {
                        progress_q = q;
                        logger.info("binding to queue:"+config.progress.queue);
                        q.bind(ex, '#');
                        
                        done();
                    });
                });
            });
            conn.on('error', function(err) {
                logger.warn("amqp received error.", err);
            });
        },

        //finally, subscribe to the progress_q
        function(done) {
            //console.log("subscriging to progress queue");
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
            if(node._update_time) node._update_time = parseInt(node._update_time);
            db.smembers(key+"._children", function(err, children) {
                node._children = children;
                cb(null, node);
            });
        } else {
            //return empty object if key is not found
            cb(null, {});
        }
    });
}

function set_node(key, node, cb) {
    //assert(cb.arguments.length == 1);
    //TODO - validate?

    if(node.progress === undefined) node.progress = 0;
    if(node.weight == undefined) node.weight = 1; //relative complexity relative to siblings
    if(node.start_time === undefined) node.start_time = Date.now();
    if(node.progress == 1) node.end_time = Date.now(); //mark completion time 

    node._update_time = Date.now(); //mark update time (so that we can remove old records later)

    //console.log("setting node: "+key);
    //console.dir(node);
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
                //console.dir(child);
                if(child) { //child went missing?
                    total_progress += child.progress * child.weight;
                    total_weight += child.weight;
                    //console.log("aggregating");
                    //console.log("total_progess:"+total_progress);
                    //console.log("total_weight:"+total_weight);
                }
                next();
            });
        }, function(err) {
            //update my progress based on child's progress
            node.progress = total_progress / total_weight;
            cb();
        });
    }
}

function get_state(key, depth, cb) {
    get_node(key, function(err, node) {
        if(err) throw err;
        node._key = key; //debug
        //console.dir(node);
        depth--;
        if(depth > 0) {
            //get_children(key, function(err, children) {
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
                        cb(err, node);
                    });
                } 
            //});
        } else {
            cb(null, node); //all done
        }
    });
}

function update(key, node, cb) {
    console.log("updating "+key);
    console.dir(node);

    //assert(node); //shouldn't be null
    aggregate_children(key, node, function() {
        set_node(key, node, function(err) {
            if(err) throw err;

            //find parent key
            var parent_key = null;
            var pos = key.lastIndexOf(".");
            if(pos !== -1) parent_key = key.substring(0, pos);
            //console.log("parent of "+key+" is "+parent_key);
            if(parent_key == null) return cb(null); //we've bubbled up to the root... all done
            
            //find next parent edge
            var edge_key = parent_key;
            pos = parent_key.lastIndexOf(".");
            if(pos !== -1) edge_key = parent_key.substring(pos+1);
            //console.log("edge of "+parent_key+" is "+edge_key);
            if(edge_key[0] == "_") return cb(null); //parent_key that starts with _ is a root (like _portal) Don't bubble up to it
            
            //ok.. now we've got a work to do
            db.sadd(parent_key+"._children", key); //make sure parents knows about me
            get_node(parent_key, function(err, p) {
                if(err) throw err;
                //handle case where parent node wasn't reported (children reported first?)
                //console.log("recursing to "+parent_key);
                update(parent_key, p, cb);
            });
        });
    });
}

//handled new progress event
function progress(message, headers, info, ack) {
    console.log("message received key:"+info.routingKey);
    console.dir(message);

    var key = info.routingKey;
    //message._children = []; //don't have to aggregate children on the node specified (only worry about parents)
    update(key, message, function(err) {
        //somehow can't send ack.acknowlege as cb.. (something to do with 'this'?)
        ack.acknowledge()
    });
}

//return current progress status
exports.status = function(req, res) {
    if(!req.query.key) throw new Error("please specify key param");
    var key = req.query.key;
    var depth = req.query.depth || 1;

    get_state(key, depth, function(err, state) {
        res.json(state);
    });
}
