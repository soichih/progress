'use strict';

var config = require('../config/config');
var scadm = require('sca-datamover');//.init(config.scadm);
var hsi = require('hpss').hsi;
var fs = require('fs');
var ejs = require('ejs');
var Email = require('email').Email;

var numeral = require('numeral');

/*
var async = require('async');
var uuid = require('uuid');
*/

exports.request = function(req, res) {
    //create a request handler
    //var dm_request = new scadm.request(req.body);
    //var req = scadm.find_request_by_uuid('846f3b46-e46f-49b6-8607-f6911435ff64');

    /*
    console.log("user requested a new job");
    console.dir(req);
    console.dir(req.body);
    */

    var job = new scadm.job({name: 'just another isdp job'});

    //step 1
    job.task('Create a staging directory', function(task, cb) {
        fs.mkdir(config.isdp.stagedir+'/'+job.id, cb);
    });

    //step 2 - for each files requested
    req.body.files.forEach(function(file) {
        job.task('Download '+file+ ' from hsi', function(task, cb) {
            //console.log("calling hsi.get");
            hsi.get(file, config.isdp.stagedir+'/'+job.id, cb, function(progress) {
                job.progress(progress, task.id); //post an extra progress reports
            });
        });
    });

    //step 3
    job.task('Creating tar ball', function(task, cb) {
        job.stagetar = config.isdp.stagedir+'/'+job.id+'.tar.gz';
        scadm.tasks.tarfiles({
            path: job.id,
            dest: job.stagetar,
            cwd: config.isdp.stagedir,
            gzip: true
        }, cb);
    });

    //step 4 
    job.task('Publishing tar ball on download server', function(task, cb) {
        job.publishtar = config.isdp.publishdir+'/'+job.id+'.tar.gz';
        fs.symlink(
            job.stagetar, //src
            job.publishtar, //dst
            cb);
    });

    //step 5
    job.task('Notify submitter', function(task, cb) {
        var stats = fs.statSync(config.isdp.stagedir+'/'+job.id+'.tar.gz');
        //console.dir(stats);
        //console.dir(config.isdp.publishurl);
        var html_template = fs.readFileSync('./t/html_notification.ejs').toString();
        var text_template = fs.readFileSync('./t/text_notification.ejs').toString();
        var params = {
            jobid: job.id,
            download_url: config.isdp.publishurl+'/'+job.id+'.tar.gz',
            size: numeral(stats.size/(1024*1024)).format('0,0')
        }

        var email = new Email({ 
            from: "hayashis@iu.edu",
            to: req.body.notification_email,
            subject: "Your tar ball is ready to be downloaded",
            body:  ejs.render(html_template, params),
            altText: ejs.render(text_template, params),
            bodyType: 'html'
        });
        email.send(cb);
    });

    res.json({status: 'requested', jobid: job.id});

    //finally, start the job
    job.run();
}

