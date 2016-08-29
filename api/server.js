'use strict';

//node
var fs = require('fs');

//contrib
var express = require('express');
var bodyParser = require('body-parser');
var winston = require('winston');
var expressWinston = require('express-winston');
var compress = require('compression');
var cors = require('cors');

//mine
var config = require('./config');
var logger = new winston.Logger(config.logger.winston);
var controllers = require('./controllers');

//init express app
var app = express();
app.use(cors());
app.use(bodyParser.json()); 
app.use(expressWinston.logger(config.logger.winston));
app.use(compress());

//if(config.express.jwt) app.use(require('express-jwt')(config.express.jwt));

//setup routes
app.get('/health', function(req, res) { res.json({status: 'ok'}); });
/*
app.get('/status', controllers.status);
app.post('/update', controllers.update);
*/
app.use('/', require('./controllers').router);

//error handling
app.use(expressWinston.errorLogger(config.logger.winston)); 
app.use(function(err, req, res, next) {
    if(typeof err == "string") err = {message: err};

    //log error..
    logger.info(err);

    if(err.stack) err.stack = "hidden"; //don't sent call stack to UI - for security reason
    res.status(err.status || 500);
    res.json(err);
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
            console.log("progress service API listening on port %d in %s mode", port, app.settings.env);
        });

        //init socket.io
        var io = require('socket.io').listen(server);
        io.on('connection', function (socket) {
            socket.on('join', function (key) {
                console.log("socket.io join "+key);
                socket.join(key);
            });
            socket.on('leave', function (key) {
                console.log("socket.io leave "+key);
                socket.leave(key);
            });
        });
        controllers.set_socketio(io);
    });
};

