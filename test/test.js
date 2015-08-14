
//var winston = require('winston');
var expect = require('chai').expect;
var assert = require('assert');
var request = require('supertest');  

var config = require('../config/config');

/*
describe("config", function() {
    describe("directories", function() {
        it("stagedir should be writable", function(done) {
        });
    });
});
*/

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

        /* I am not sure if I am testing what I think I am testing..
        it("error check", function(done) {
            app.get('/errortest', function(req, res) {
                throw new Error("test error");
            });
            request(app).get('/errortest')
            .expect(500)
            .end(done) 
        });
        */

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
