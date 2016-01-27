# SCA Progress Service


## Background

Progress reporting of job is critical to provide user accurate view of what the system is doing, has done, and will be doing, and gives user understanding of how long the job till take, even if it's just a ballpark estimate occasionally. The same information also allows other services to decide if it should send completion notification (there is no point of sending completion notification if the job only takes 10 seconds), or send more notifications (if a job takes 1 week to complete, maybe we should send *progress* notifications to let user know that we are working on it).

Job progress is inherently hierarchical. For example, portal might know that, the entire job consists of 3 big parts (1 to thaw/stage input, 2 to run the workflow, and 3 to do some post processing) although it might not know the details on each sub steps. Recursively, for each sub steps, it might know how many parallel jobs to run, but it might not know the detail on each job. So on..

This means that, when something queries the progress information, the parent node must aggregate information from its own children, and the children queries their own children, so on.. until it reaches the edge node.

To do this, parent of any sub-task can provide the child steps the "progress routing key". In above example, when portal starts the input stage, the portal will provide the progress routing key of "portal.job123.stage_input". When the input stage then execute staging of input file abc, it will add ".abc" to the routing key to create "portal.job123.stage_input.abc" as its child's routing key for its sub-process that takes care of staging file abc.

## Specifications

All progress update will be posted to a single "progress" AMQP queue with a message like following.

```
ex: progress, routing_key: "portal.job123.stage_input.abc"
{progress: 0.2, msg: "Thawing file ABC"}
```

"0.2" here means that the thawing of the specific file "123" is 20% complete. The node who is aware of the existence child job should post progress messages with "progress: 0" for all *sequential* child jobs before starting child jobs so that parent of the node can be informed that there are pending child jobs (each child job then reports non-0 progress). If all child jobs are executed in parallel, then there is no point of parent posting "progress: 0" message - since each child can post it.

At each parent node, service orchestrating the child process can post message like following to specify parent message, and weight for each child steps.

```
ex: progress, routing_key: "portal.job123.stage_input"
{msg: "Staging Input files for Job123", weight: 10}
ex: progress, routing_key: "portal.job123.qrprocess"
{msg: "Running QR process for Job123", weight: 100}
ex: progress, routing_key: "portal.job123.output_transfer"
{msg: "Transferring output files for Job123", weight: 2}
```

Progress percentage parameters are omitted in above sample because they are computed by aggregating their child's progress percentage ("output_transfer" might not have child process, and if so, the service orchestrating the workflow will update it with progress value) If there are tasks that parent itself must perform (like some init / cleanup process within the orchestrating service), then post the progress using sub-routing key such as "portal.job123.init" or "portal.job123.cleanup" - again any progress value specified on non-edge node will be overwritten by child node update.

You are safe to update the progress percentage on parent nodes if you know that no further updates to child node will happen.

weight parameter (optional - defaulted to 1) is used to compute the aggregated parent progress by adjusting each child's progress multiplied by the weight. This allows better estimation of overall progress percentage (and completion time estimate). 

### Progress Service

Progress service is responsible for receiving progress updates via AMQP, and it runs as a REST API server to handle requests from client applications. 

Progress service stores incoming progress message in Redis. Redis can be configured to persist data on disk (with reduced performance) if you want to the progress information to be persisted across restart of Redis server.

Progress Service provides following APIs

* /health

Just return a string if server is running

* (get) /status/:key

Load JSON data structure consisted of the current progress status tree.

Parameters
key: progress path to construct the tree under
depth: Depth of the progress tree to construct (default 1). Each parent node will have _children array containing child keys. Even if you 
decide not to load it.

* (post) /status/:key

REST interface equivalent of AMQP queue. The request will be immediately processed by the progress service.

Sample code

Node

```
var request = require('request');
request({
    method: "POST",
    url: config.progress.api+'/status/_sca.123.prep',
    /*
    headers: {
        'Authorization': 'Bearer '+config.progress.jwt,
    },
    */
    json: {status: "running", progress: 0.8, name: "Important Work", msg: "doing something important"},
}, function(err, res, body){
    if(cb) cb(err, body);
});

```

Bash

```
curl -X POST -H "Content-Type: application/json" -d "{\"status\": \"waiting\", \"progress\": 0, \"msg\":\"Downloading data from $dataurl\"}" $SCA_PROGRESS_URL

```

Matlab

```
webwrite(getenv('SCA_PROGRESS_URL'), struct('msg','Application almost done!','progress', 0.99), weboptions('MediaType','application/json'));
```

* (socket.io) socket.on('subscribe', function(key){})

Subscribe to provided "key" which should be a key for the root of the individual progress tree (like "_portal.job123")
You will start receiving 'update' event contaning the progress update
When the browser socket closes, the client will automatically be un-subscribed (you need to re-subscribe during 'connection' event)

### Progress Information GUI

Currently we have web UI written in Angular for progress UI where user can interact with the progress page by diggin down up to 4th level. The UI subscribes to update with socket.io and receives real time updates.

### Job Status

You can set "status" (and infact any other key/value) as part of progress update message.

```
{progress: 1, status: "finished", msg: "Job completed successfully"}
```

Progress UI expects following status, but you can set any status you'd like - especially if you have your own GUI.

* waiting: task is waiting to be executed
* running: task is currently running (making progress)
* finished: task has successfully completed
* failed: task has failed (job may continue.. )
* canceled: task was canceled by the user (user may restart it?)
* (paused: task was paused by the user)

## TODOS

I need to purge old progress records so that it won't clobber redis

Should I use Server-Sent-Event - instead of socket.io? socket.io might be a bit overkill.. but supported on more browsers? Problem is.. I need to pass jwt via the URL parameter since EventSource doesn't seems to allow me to set header. (inspiration for server side code is at http://html5doctor.com/server-sent-events/)

* Show aggregate progress bar of all child steps on parent
* Add link to sub-level progress if child has more than 4 level
* deploy to core-test1/test2

* peformance issue when there are a lot of child nodes
