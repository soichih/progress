'use strict';

app.controller('HeaderController', ['$scope', 'appconf', '$route', 'toaster', '$http', 'menu',
function($scope, appconf, $route, toaster, $http, menu) {
    $scope.title = appconf.title;
    //serverconf.then(function(_c) { $scope.serverconf = _c; });
    //menu.then(function(_menu) { $scope.menu = _menu; });
    $scope.menu = menu;
}]);

app.controller('AboutController', ['$scope', 'appconf', '$route', 'toaster', '$http', '$cookies', '$routeParams', '$location', '$interval',
function($scope, appconf, $route, toaster, $http, $cookies, $routeParams, $location, $interval) {

    ///////////////////////////////////////////////////////////////////////////////////////////////
    // TODO only allows this to developer / admin
    //
    var sim = null;
    $scope.running = false;
    $scope.test_start = function() {
        $scope.running = true;
        //create some random id
        $scope.testid = '_test.xxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random()*16|0, v = c == 'x' ? r : (r&0x3|0x8);
            return v.toString(16);
        });
        sim = $interval(simulate, 200);
    }

    $scope.test_stop = function() {
        $interval.cancel(sim);
        $scope.running = false;
    }

    var progress = {};
    var mutex = false;
    var count = 0;
    function simulate() {
        if(mutex) return;
        mutex = true;
        count++;
        //generate rangom progress data
        var key = $scope.testid;
        if(!progress[key]) {     
            var p = {name: "Test Job with id"+key, msg: "Created task", status: "running"};
            $http.post(appconf.api+'/status/'+key, p);
            progress[key] = p;
        }
        key += "."+parseInt(Math.random()*3);
        if(!progress[key]) {     
            var p = {name: "Subtask with id"+key, msg: "Sub task created", status: "running"};
            $http.post(appconf.api+'/status/'+key, p);
            progress[key] = p;
        }
        key += "."+parseInt(Math.random()*3);
        if(!progress[key]) {     
            var p = {name: "Sub-Subtask with id"+key, msg: "Sub-sub task created", status: "running"};
            $http.post(appconf.api+'/status/'+key, p);
            progress[key] = p;
        }
        key += "."+parseInt(Math.random()*3);

        //here is the edge
        if(progress[key]) {
            progress[key].progress+=Math.random()/3;
            progress[key].status = "running";
            if(progress[key].progress > 1) {
                progress[key].progress= 1;
                progress[key].status = "finished";
                progress[key].msg = "updates made "+count;
                /*
                if(key == $scope.testid) {
                    toaster.success("Simulation finished");
                    $scope.test_stop();
                }
                */
            }
        } else {
            progress[key] = {progress: 0, weight: 1, status: "waiting", msg: "hello", name: "Doing nothing particularly useful.."};
        }
        //console.dir(progress[key]);
        
        $http.post(appconf.api+'/status/'+key, progress[key])
        .success(function() {
            //console.log("update posted");
            $scope.msg_key = key;
            $scope.msg = progress[key];
            mutex = false;
        })
        .error(function(err) {
            //timeout doesn't get here.. if server is down
            toaster.error(err);
            mutex = false;
        });
    }
}]);

app.controller('DetailController', 
['$scope', 'appconf', '$route', 'toaster', '$http', '$cookies', '$routeParams', '$location', '$interval', 'socket', 
function($scope, appconf, $route, toaster, $http, $cookies, $routeParams, $location, $interval, socket) {
    //console.log("initialzing detailcontroller");

    $scope.debug = appconf.debug;
    $scope.title = appconf.title;
    $scope.rootkey = $routeParams.key;

    load_data(); 

    function load_data() {
        //console.log("requesting full status");
        $http.get(appconf.api+'/status/'+$scope.rootkey+'?depth=5')
        .success(function(data) {
            $scope.status = data;
            //update_catalog($scope.status);
            socket.on('update', process_updates);
        })
        .error(function(err) {
            toaster.error("Failed to load progress information: "+err.message);
            $scope.status = {};
        });
    }

    /*
    //create a catalog pointing to different nodes in $scope.status
    var catalog = {};
    function update_catalog(node) {
        catalog[node.key] = node;
        if(node.tasks) node.tasks.forEach(update_catalog);
    }
    */
    
    //TODO - I am not sure if this is really necessary?
    //start refreshing the entire status (to keep it synced) 
    //for more fine grained update comes via socket.io
    $interval(load_data, 1000*60*10);

    $scope.progressClass = function(status) {
        switch(status) {
        case "running":
            return "";
        case "finished":
            return "progress-bar-success";
        case "canceled":
        case "paused":
            return "progress-bar-warning";
        case "failed":
            return "progress-bar-danger";
        default:
            return "progress-bar-info";
        }
    }

    //holds flags to show sub task tree
    $scope.show_tasks = {};
    $scope.toggleShowTasks = function(task) {
        if(!task.tasks) return; //no tasks. nothing to show
        var key = task.key;
        if($scope.show_tasks[key] === undefined) {
            $scope.show_tasks[key] = false; //false by default
        }
        $scope.show_tasks[key] = !$scope.show_tasks[key];
        //console.dir($scope.show_tasks);
    }

   
    //I might already be connected to socket.io if user gets here via route change
    if(!socket.connected) {
        socket.on('connect', function() {
            socket.connected = true;
            subscribe();
        });
    } else {
        subscribe();
    }

    function subscribe() {
        //grab key up to non _ token (like _test.f771b6c2b8f)
        var tokens = $scope.rootkey.split(".");
        var room = "";
        for(var i = 0;i < tokens.length;++i) {
            if(room != "") room += ".";
            room += tokens[i];
            if(tokens[i][0] != "_") break;
        };
        console.log("joining room: "+room);
        socket.emit('join', room); //no cb?
        $scope.$on('$routeChangeStart', function(next, current) { 
            console.log("leaving room: "+room);
            socket.emit('leave', room);
            socket.removeAllListeners();
        });
    }
 
    function process_updates(updates) {
        console.dir(updates);
        $scope.$apply(function() {
            if(!$scope.status) $scope.status = {};  
            var node = $scope.status;
            //handle root
            var update = updates.shift();
            for(var key in update) node[key] = update[key]; //apply update
            //handle child tasks
            updates.forEach(function(update) {
                //search the key under tasks
                if(node.tasks == undefined) {
                    //first child
                    //console.log("first ever child for ");
                    //console.dir(node);
                    node.tasks = [update];
                    node = update;
                } else {
                    //look for next task
                    var found = false;
                    node.tasks.forEach(function(task) {
                        if(task.key == update.key) {
                            found = true;
                            node = task;
                            for(var key in update) node[key] = update[key]; //apply update
                        }
                    }); 
                    //first time seen
                    if(!found) {
                        //console.log("couldn't find "+update.key);
                        node.tasks.push(update);
                        node = update;
                    }
                }
                
                //console.log(update.key);
                /* this should never happen now.. 
                if(update.key.indexOf($scope.rootkey) == -1) {
                    console.log("received key("+update.key+") that's outside of my rootkey:"+$scope.rootkey);
                    return;
                }
                */
                //console.log(update);
                /*
                var node = catalog[update.key];
                if(node) {
                    for(var key in update) node[key] = update[key]; //apply update
                    parent = node;
                } else {
                    if(parent.tasks === undefined) parent.tasks = [update];
                    else parent.tasks.push(update);
                    catalog[update.key] = update;
                    parent = update;
                }
                */
            });
            console.dir($scope.status);
        });
    }
}]);

app.directive('scaProgress', function() {
    return {
        restrict: 'E',
        scope: {
            detail: '=detail'
        },
        templateUrl: 't/scaprogress.html'
    };
});

