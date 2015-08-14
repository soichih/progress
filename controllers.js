
//node
var fs = require('fs');

//contrib
var hsi = require('hpss').hsi;
var ejs = require('ejs');
var Email = require('email').Email;
var numeral = require('numeral');
var winston = require('winston');

//mine
var config = require('./config/config');
var scadm = require('sca-datamover');//.init(config.scadm);

var app = require('./server').app;
var logger = new winston.Logger(config.logger.winston);
var request_logger = new winston.Logger(config.logger.request);

scadm.init({logger: logger, progress: config.progress});

exports.request = function(req, res) {
    /*
    logger.info("handling user request");
    logger.info(req.body);
    logger.error("test error");
    */
    request_logger.info({headers: req.headers, body: req.body});

    var job = new scadm.job({name: 'just another isdp job'});

    //step 1
    job.task('Create a staging directory', function(task, cb) {
        fs.mkdir(config.isdp.stagedir+'/'+job.id, cb);
    });

    //step 2 - for each files requested
    req.body.files.forEach(function(file) {
        job.task('Download '+file+ ' from hsi', function(task, cb) {
            //console.log("calling hsi.get");
            hsi.get(file, config.isdp.stagedir+'/'+job.id, function(err, msgs) {
                if(!err) return cb();//all good
                //failed..
                var msg = "Failed to download "+file+" from sda. hsi return code: "+err.code;
                if(msgs) msg += "\n"+msgs.join("\n"); //add details from hsi
                
                //send error message to user
                fs.appendFile(config.isdp.stagedir+'/'+job.id+'/isdp_errors.txt', msg+'\n');

                //also deliver it upstream (so that it can be logged on the server side)
                err.msg = msg;
                cb(err, true); //true means to continue even with the error
            }, function(progress) {
                job.progress(progress, job.id+'.'+task.id); //post hsi generated progress
            });
        });
    });

    //step 3
    /*
    job.task('Creating tar ball', function(task, cb) {
        job.stagetar = config.isdp.stagedir+'/'+job.id+'.tar';
        scadm.tasks.tarfiles({
            path: job.id,
            dest: job.stagetar,
            cwd: config.isdp.stagedir,
            gzip: false
        }, cb);
    });
    */

    job.task('Creating a zip', function(task, cb) {
        job.stagezip = config.isdp.stagedir+'/'+job.id+'.zip';
        scadm.tasks.zipfiles({
            path: job.id,
            dest: job.stagezip,
            cwd: config.isdp.stagedir
        }, cb);
    });

    //step 4 
    job.task('Publishing zip on download server', function(task, cb) {
        job.publishzip = config.isdp.publishdir+'/'+job.id+'.zip';
        fs.symlink(
            job.stagezip, //src
            job.publishzip, //dst
            cb);
    });

    //step 5 (optional)
    if(req.body.notification_email) {
        job.task('Notify submitter', function(task, cb) {
            var stats = fs.statSync(job.stagezip);
            var html_template = fs.readFileSync('./t/html_notification.ejs').toString();
            var text_template = fs.readFileSync('./t/text_notification.ejs').toString();
            var params = {
                jobid: job.id,
                download_url: config.isdp.publishurl+'/'+job.id+'.zip',
                size: numeral(stats.size/(1024*1024)).format('0,0')
            }

            var email = new Email({ 
                from: config.isdp.notification_from,
                to: req.body.notification_email,
                subject: "Your zip file is ready to be downloaded",
                body:  ejs.render(html_template, params),
                altText: ejs.render(text_template, params),
                bodyType: 'html'
            });
            email.send(cb);
        });
    }

    res.json({status: 'requested', jobid: job.id});

    //finally, start the job
    job.run();
}

