'use strict';

//node
var fs = require('fs');

//contrib
var express = require('express');
var bodyParser = require('body-parser');
var winston = require('winston');
var expressWinston = require('express-winston');
var compress = require('compression');

//mine
var config = require('./config/config');
var logger = new winston.Logger(config.logger.winston);
var controllers = require('./controllers');

//init express app
var app = express();
app.use(bodyParser.json()); 
app.use(expressWinston.logger(config.logger.winston));
app.use(compress());

//jwt auth is optional
if(config.express.jwt) app.use(require('express-jwt')(config.express.jwt));

//setup routes
app.get('/health', function(req, res) { res.json({status: 'running'}); });
app.get('/status', controllers.status);
app.post('/update', controllers.update);

//error handling
app.use(expressWinston.errorLogger(config.logger.winston)); 
app.use(function(err, req, res, next) {
    logger.error(err);
    logger.error(err.stack);
    res.status(err.status || 500);
    res.json({message: err.message, /*stack: err.stack*/}); //let's hide callstack for now
});
process.on('uncaughtException', function (err) {
    //TODO report this to somewhere!
    logger.error((new Date).toUTCString() + ' uncaughtException:', err.message)
    logger.error(err.stack)
    //process.exit(1); //some people think we should do this.. but I am not so sure..
})

exports.app = app;
exports.start = function(cb) {
    var port = process.env.PORT || config.express.port || '8080';
    var host = process.env.HOST || config.express.host || 'localhost';
    controllers.init(function() {
        var server = app.listen(port, host, function() {
            if(cb) cb();
            console.log("ISDP request handler listening on port %d in %s mode", port, app.settings.env);
        });

        //init socket.io
        var io = require('socket.io').listen(server);
        io.on('connection', function (socket) {
            socket.on('subscribe', function (key) {
                console.log("socket joining "+key);
                socket.join(key);
            });
            //socket will leave automatically upon disconnection.. 
            /*
            socket.on('unsubscribe', function(key) {
                socket.leave(key);
            });
            */
            //socket.emit('update', { hello: 'world', '/whatever': 'will get' });
            /*
            socket.emit('news', { hello2: 'world2'});
            socket.on('my other event', function (data) {
                logger.debug(data);
            });
            */
        });
        controllers.set_socketio(io);
    });
};

