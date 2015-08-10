# SCA Progress Service

## Specifications

### Progress Message
Progress reporting of job is critical to provide user accurate view of what the system is doing, has done, and will be doing, and gives user understanding of how long the job till take, even if it's just a ballpark estimate occasionally. The same information also allows other services to decide if it should send completion notification (there is no point of sending completion notification if the job only takes 10 seconds), or send more notifications (if a job takes 1 week to complete, maybe we should send *progress* notifications to let user know that we are working on it).

Job progress is inherently hierarchical. For example, portal might know that, the entire job consists of 3 big parts (1 to thaw/stage input, 2 to run the workflow, and 3 to do some post processing) although it might not know the details on each sub steps. Recursively, for each sub steps, it might know how many parallel jobs to run, but it might not know the detail on each job. So on..

This means that, when something queries the progress information, the parent node must aggregate information from its own children, and the children queries their own children, so on.. until it reaches the edge node.

To do this, parent of any sub-task can provide the child steps the "progress routing key". In above example, when portal starts the input stage, the portal will provide the progress routing key of "portal.job123.stage_input". When the input stage then execute staging of input file abc, it will add ".abc" to the routing key to create "portal.job123.stage_input.abc" as its child's routing key for its sub-process that takes care of staging file abc.

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

Progress parameters are omitted because it's computed by aggregating child's progress ("output_transfer" might not have child process, and if so, the service orchestrating the workflow will update it with progress value) If there are tasks that parent itself must perform (like some init / cleanup process within the orchestrating service), then post the progress using sub-routing key such as "portal.job123.init" or "portal.job123.cleanup" - again any progress value specified on non-edge node will be overwritten by child node update.

weight parameter (optional - defaulted to 1) is used to compute the aggregated parent progress by adjusting each child's progress multiplied by the weight. This allows better estimation of overall progress percentage (and completion time estimate). 

### Progress Information Aggregation

Once we have various system posting progress message, we need a service responsible for consuming such messages and aggregate them and make it available for other services. Such service will be responsible for following.
Persist incoming progress message from AMQP (key/value where key is routing key and value is the progress json stored in redis). It sets certain missing values automatically.

```
function set_node(key, node) {
  //init missing values
  if(node.progress === undefined) node.progress = 0;
  if(node.weight == undefined) node.weight = 1; //relative complexity relative to siblings
  if(node.start_time === undefined) node.start_time = Date.now();
  if(node.progress == 1) node.end_time = Date.now(); //mark completion time 
  
  //do redis update
}
```

It then call update() with parent node's routing key to recursively update progress information all the way up the hierarchy. 
```
function update(key) {
  var node = get_node(key);

	//handle case where parent node wasn't reported (children reported first?)
  if(node === undefined) {
    node = {}; //create an empty message object
    set_node(key, node); //let set_node set other missing fields
  }

  var children = query_children(key);
  if(children.length == 0) {
	//either this is an edge node, or children haven't reported yet
  } else {
	//do weighted aggregation
	var total_progress = 0;
	var total_weight = 0;
	children.forEach(function(child_key) {
		var child = get_node(child_key);
		total_progress += child.progress * child.weight;
		total_weight += child.weight;
	});
	node.progress = total_progress / total_weight;
  }
  
  //compute when this node should complete.
  node.eta = (Date.now() - node.start_time)*node.progress + Date.now();
  
  set_node(key, node);
  
  //now recurse up
  var parent_key = get_parent_key(key); //just strip the last token
  if(!is_root_key(parent_key)) { //top level key "portal." is just to group different types of progress - so I don't need to process this.
  	update(parent_key);
  }
}
```

set_node() above sets "start_time" at each parent node. This value can be used to estimate the time of completion by combining current time, and progress percentage. 

### Progress Information Publishing

The same service consuming & aggregating the progress message will allow internal services to query progress information. It can specify the "root" of progress routing key (like "portal.job123") and it will return the progress information on that node, and its children (depth can be specified by the client).

Once the progress information is loaded, client can then subscribe to all subsequent updates through socketio connection under a particular routing key.

### Progress Information GUI

We will implement an Angular directive for progress UI where user can interact (dig down to see progress information at deeper level). The directive can subscribe to progress/socketio to automatically update progress status. 


## TODOS

Should this service be responsible for the status of the jobs / tasks? Or should we have a separate service just for that? I tend to think we should make progress service responsible for keeping up with "status" information.. but I am not exactly sure.
