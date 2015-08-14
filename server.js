'use strict';

var fs = require('fs');

var express = require('express');
var jwt = require('express-jwt');
var bodyParser = require('body-parser');

var config = require('./config/config');

var app = express();

var jwtac = jwt({secret: config.jwt.public_key});

app.use(bodyParser.json()); //parse application/json
app.use(config.logger.express);

var handlers = {
    health: function(req, res) {
        //TODO
        res.json({status: 'running'});
    },
    request: require('./controllers/request').request,
    _404: function(req, res) {
        var err = new Error('Not Found');
        err.status = 404;
        next(err);
    },
    _error: function(err, req, res, next) {
        console.dir(err);
        res.status(err.status || 500);
        res.json({message: err.message});
    },
}
//setup routes
app.get('/health', handlers.health);
app.post('/request', jwtac, handlers.request);

//some extra handlers
app.use(handlers._404); //for all else .. 404
app.use(handlers._error); 

function start() {
    var port = process.env.PORT || '8080';
    app.listen(port);
    console.log("Express server listening on port %d in %s mode", port, app.settings.env);
}

exports.start = start;
exports.app = app;
