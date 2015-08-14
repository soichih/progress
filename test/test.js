
var request = require('supertest');  
var winston = require('winston');
var expect = require('chai').expect;
var assert = require('assert');

var config = require('../config/config');

describe("routing", function() {
    var url = 'http://someurl.com';
    var app = require('../server').app;

    before(function(done) {
        //mongoose.connect(config.db.mongodb);                                                        
        done();
    });

    describe("health", function() {
        it("should return ok status", function(done) {
            request(app)
            .get('/health')
            .expect(200, {status: 'running'})
            .end(done) 
        });
    });

    describe("request", function() {
        it("should let me post request", function(done) {
            var req = {
                files: [
                    'intopo/historic/geopdf/250k/in_evansville_156913_1957_250000_geo.zip', 
                    'intopo/historic/geopdf/250k/in_evansville_156914_1957_250000_geo.zip',
                    'intopo/historic/geopdf/250k/in_evansville_156915_1957_250000_geo.zip',
                    'intopo/historic/geopdf/250k/in_evansville_156916_1957_250000_geo.zip',
                    'intopo/historic/geopdf/250k/in_evansville_156917_1957_250000_geo.zip',
                ]
            };

            request(app)
            .post('/request')
            //.set('Accept', 'application/json')
            .set('Authorization', 'Bearer '+config.test.jwt)
            .send(req)
            .expect(200, function(err, res) {
                console.dir(res.body);
                done();
            });
        });
    });

});
