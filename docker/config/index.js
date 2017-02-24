'use strict';

const fs = require('fs');
const winston = require('winston');

exports.progress = {
    //warning.. you don't get error message if your user/pass etc. are incorrect (it just keeps retrying silently..)
    amqp: {url: "amqp://guest:guest@rabbitmq-test1/test"},
    exchange: "progress",
    queue: "progress1",

    redis: {
        server: "redis-test1",
        //port: "6380"
    }
}

exports.express = {
    port: 8080,
}

exports.logger = {
    winston: {
        requestWhitelist: ['url', /*'headers',*/ 'method', 'httpVersion', 'originalUrl', 'query'],
        transports: [
            //display all logs to console
            new winston.transports.Console({
                timestamp: function() {
                    var d = new Date();
                    return d.toString(); //show timestamp
                },
                colorize: true,
                level: 'debug'
            }),
            /*
            //store all warnings / errors in error.log
            new (winston.transports.File)({ 
                filename: '/var/log/sca/error.log',
                level: 'warn'
            })
            */
        ]
    },
}


