
//var winston = require('winston');
var expect = require('chai').expect;
var assert = require('assert');
var request = require('supertest');  
var amqp = require('amqp');
var uuid = require('node-uuid');
var winston = require('winston');

//mine
var config = require('../api/config/config');
var logger = new winston.Logger(config.logger.winston);
var controllers = require('../api/controllers');
var app = require('../api/server').app;

describe("update", function() {
    var conn = null;
    var ex = null;
    //var id = uuid.v4();

    before(function(done) {
        var conn = amqp.createConnection(config.progress.amqp, {reconnectBackoffTime: 1000*10});
        conn.on('ready', function() {
            logger.info("amqp handshake complete");
            var ex = conn.exchange(config.progress.exchange, {autoDelete: false, durable: true, type: 'topic'}, function(ex) {
                logger.info("amqp connected to exchange:"+config.progress.exchange);

                ex.publish("_portal.test123", {name: "test123 job", status: "waiting"});
                ex.publish("_portal.test123.1", {name: "test123 task 1", status: "waiting"});
                ex.publish("_portal.test123.1", {status: "running", progress: 0.5});

                ex.publish("_portal.test123.2", {name: "test123 task 2", status: "waiting"});
                ex.publish("_portal.test123.2.c", {status: "finished", progress: 1});
                ex.publish("_portal.test123.2.a", {status: "failed", progress: 0.1});

                ex.publish("_portal.test123.2.b", {status: "canceled", progress: 0.2});
                ex.publish("_portal.test123.2.b.i", {status: "waiting"});
                ex.publish("_portal.test123.2.b.ii", {status: "waiting"});

                ex.publish("_portal.test123.3", {name: "test123 task 3", status: "waiting"});
                ex.publish("_portal.test123.3.b", {status: "paused", progress: 0.2});

                ex.publish("_portal.test123.4", {name: "test123 task 3", status: "waiting"});
                ex.publish("_portal.test123.5", {name: "test123 test 4!", weight: 100, status: "waiting", progress: 0.9});

                //lastly, initialize the controller
                controllers.init();
                setTimeout(done, 1000);
            });
        });
        conn.on('error', function(err) {
            logger.warn("amqp received error.", err);
        });
    });

    describe("progress", function() {
        it("#test123", function(done) {
            request(app).get('/status?key=_portal.test123&depth=2')
            //.set('Accept', 'application/json')
            //.set('Authorization', 'Bearer '+config.test.jwt)
            .expect(200, function(err, res) {
                console.log(JSON.stringify(res.body, null, 4));
                done();
            });
        });
    });

});

/*
describe("routing", function() {
    var url = 'http://someurl.com';
    var app = require('../server').app;

    before(function(done) {
        //mongoose.connect(config.db.mongodb);                                                        
        done();
    });

    describe("health", function() {
        it("make sure invalid url returns 404", function(done) {
            request(app).get('/_nosuchthing')
            .expect(404, done);
        });

        it("should return ok status", function(done) {
            request(app).get('/health')
            .expect(200, {status: 'running'})
            .end(done) 
        });
    });

    describe("request", function() {
        this.timeout(30*1000);
        it("should let me post request", function(done) {
            var req = {
                notification_email: "hayashis@iu.edu",
                files: [
                    'intopo/historic/geopdf/250k/in_evansville_156913_1957_250000_geo.zip', 
                    'intopo/historic/geopdf/250k/in_evansville_156914_1957_250000_geo.zip',
                    'intopo/historic/geopdf/250k/in_evansville_156915_1957_250000_geo.zip',
                    'intopo/historic/geopdf/250k/in_evansville_156916_1961_250000_geo.zip',
                    'intopo/historic/geopdf/250k/in_evansville_156917_1954_250000_geo.zip',
                ]
            };

            app.post('/request-test', require('../controllers').request);

            request(app).post('/request-test')
            //.set('Accept', 'application/json')
            //.set('Authorization', 'Bearer '+config.test.jwt)
            .send(req)
            .expect(200, function(err, res) {
                console.dir(res.body);
                setTimeout(done, 15*1000);
            });
        });
    });
});
*/
