'use strict';

//node
var fs = require('fs');

//contrib
var express = require('express');
var bodyParser = require('body-parser');
var winston = require('winston');
var expressWinston = require('express-winston');

//mine
var config = require('./config/config');
var controllers = require('./controllers');

//init express app
var app = express();
app.use(bodyParser.json()); 
app.use(expressWinston.logger(config.logger.winston));

//jwt auth is optional
if(config.express.jwt) app.use(require('express-jwt')(config.express.jwt));

//setup routes
app.get('/health', function(req, res) { res.json({status: 'running'}); });
app.post('/request', controllers.request);

/*
app.get('/test', function(req, res) {
    throw new Error("test error");
});
*/

//error handling
app.use(expressWinston.errorLogger(config.logger.winston)); 
app.use(function(err, req, res, next) {
    res.status(err.status || 500);
    res.json({message: err.message, /*stack: err.stack*/}); //let's hide callstack for now
});

exports.app = app;
exports.start = function() {
    var port = process.env.PORT || config.express.port || '8080';
    app.listen(port);
    console.log("ISDP request handler listening on port %d in %s mode", port, app.settings.env);
};


