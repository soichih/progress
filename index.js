#!/usr/bin/node
'use strict';

var server = require('./server');
server.start();
console.log("waiting for incoming connections...");

