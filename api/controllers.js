
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
var progress_ex = null; //for /update

exports.init = function(cb) {
    if(!config.statusPrec) {
        config.statusPrec = function statusPrec(status) {
            switch(status) {
            case "failed": return 4;
            case "finished": return 3;
            case "canceled": return 2;
            case "running": return 1;
            case "waiting": return 0;
            default:
                return -1;
            }
        }
    }
    
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

            //get childlist
            db.smembers(key+"._children", function(err, children) {
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

    //if(node.progress === undefined) node.progress = 0;
    if(node.weight == undefined) node.weight = 1; //relative complexity relative to siblings
    if(node.start_time === undefined) node.start_time = Date.now();
    if(node.progress == 1) node.end_time = Date.now(); //mark completion time 

    node._update_time = Date.now(); //mark update time (so that we can remove old records later)

    logger.debug("setting node: "+key);
    logger.debug(node);
    db.hmset(key, node, cb);
}

function get_parent_key(key) {
    assert(key);
    var pos = key.lastIndexOf(".");
    if(pos === -1) return null;
    return key.substring(0, pos);
}

//decide precedence for each status

function aggregate_children(key, node, cb) {
    if(!node._children || node._children.length == 0) {
        //don't have any children
        //logger.debug("no child for "+key);
        //console.dir(node);
        cb();
    } else {
        //do weighted aggregation
        var total_progress = 0;
        var total_weight = 0;
        var status = null;
        async.eachSeries(node._children, function(child_key, next) {
            //logger.debug("getting child:"+child_key);
            get_node(child_key, function(err, child) {
                if(err) throw err;
                //console.dir(child);
                if(child !== undefined) { //child could go missing?
                    //aggregate progess
                    if(child.progress) {
                        total_progress += child.progress * child.weight;
                    }
                    total_weight += child.weight;

                    //aggregate status
                    if(!status) {
                        //simple case..
                        status = child.status; 
                    } else {
                        if(config.statusPrec(status) < config.statusPrec(child.status)) status = child.status;
                    }
                }
                next();
            });
        }, function(err) {
            //update my progress based on child's progress
            if(total_weight != 0) {
                node.progress = total_progress / total_weight;
            }
            node.status = status;
            cb();
        });
    }
}

function get_state(key, depth, cb) {
    get_node(key, function(err, node) {
        if(err) throw err;

        //status not yet posted, or incorrect key
        if(node === undefined) return cb();

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
                        node.tasks.sort(function(a,b) {
                            return a.start_time - b.start_time;
                        });
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
    //logger.debug("updating "+key);
    //logger.debug(node);
    //assert(node); //shouldn't be null

    //first aggreage child info (to calculate progress)
    aggregate_children(key, node, function() {
        
        //then update the node received
        set_node(key, node, function(err) {
            if(err) throw err;
    
            //logger.debug("processing parent");

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
            
            //make sure my parent knows me
            //logger.debug("adding "+key+" to "+parent_key+"._children");
            db.sadd(parent_key+"._children", key); 

            //finally, bubble up to the parent
            get_node(parent_key, function(err, p) {
                if(err) throw err;
                //logger.debug("got parent "+parent_key);
                //logger.debug(p);
                //handle case where parent node wasn't reported (children reported first?)
                if(p === undefined) p = {_children: [key]}; //parent don't exist yet.. but it needs to know about me at least so that progress can bubble up
                update(parent_key, p, cb);
            });
        });
    });
}

//handled new progress event
function progress(message, headers, info, ack) {
    //logger.info("message received key:"+info.routingKey);
    //logger.info(message);

    var key = info.routingKey;
    //message._children = []; //don't have to aggregate children on the node specified (only worry about parents)
    update(key, message, function(err) {
        //somehow can't send ack.acknowlege as cb.. (something to do with 'this'?)
        ack.acknowledge()
    });
}

//return current progress status
exports.status = function(req, res, next) {
    if(!req.query.key) throw new Error("please specify key param");
    var key = req.query.key;
    var depth = req.query.depth || 1;

    get_state(key, depth, function(err, state) {
        if(err) return next(err);
        res.json(state);
    });
}

exports.update = function(req, res, next) {
    var key = req.body.key;
    var p = req.body.p;
    /* routing through amqp somehow locks up (or kills?) the app
    progress_ex.publish(key, p, function(err) {
        if(err) return next(err);
        res.end();
    });
    */
    //logger.debug(p);
    update(key, p, function(err) {
        if(err) return next(err);
        res.end();
    });
}
