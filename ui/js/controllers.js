'use strict';

var controllers = angular.module('progressControllers', [ 'ui.bootstrap' ]);

controllers.controller('HomeController', ['$scope', 'appconf', '$route', 'toaster', '$http', '$cookies', '$routeParams', '$location', '$interval',
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
            $http.post(appconf.api+'/update', {key: key, p:p});
            progress[key] = p;
        }
        key += "."+parseInt(Math.random()*3);
        if(!progress[key]) {     
            var p = {name: "Subtask with id"+key, msg: "Sub task created", status: "running"};
            $http.post(appconf.api+'/update', {key: key, p:p});
            progress[key] = p;
        }
        key += "."+parseInt(Math.random()*3);
        if(!progress[key]) {     
            var p = {name: "Sub-Subtask with id"+key, msg: "Sub-sub task created", status: "running"};
            $http.post(appconf.api+'/update', {key: key, p:p});
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
        
        $http.post(appconf.api+'/update', {key: key, p:progress[key]})
        .success(function() {
            console.log("update posted");
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

controllers.controller('DetailController', 
['$scope', 'appconf', '$route', 'toaster', '$http', '$cookies', '$routeParams', '$location', '$interval', 'socket', 
function($scope, appconf, $route, toaster, $http, $cookies, $routeParams, $location, $interval, socket) {
    //console.log("initialzing detailcontroller");

    $scope.debug = appconf.debug;
    $scope.title = appconf.title;
    $scope.rootkey = $routeParams.key;

    function load_data() {
        //console.log("requesting full status");
        $http.get(appconf.api+'/status?key='+$scope.rootkey+'&depth=4')
        .success(function(data) {
            $scope.status = data;
            //console.dir(data);
            update_catalog($scope.status);
        })
        .error(function(err) {
            toaster.error("Failed to load progress information: "+err.message);
            $scope.status = null;
        });
    }

    //create a catalog pointing to different nodes in $scope.status
    var catalog = {};
    function update_catalog(node) {
        catalog[node.key] = node;
        if(node.tasks) node.tasks.forEach(update_catalog);
    }
    
    //start refreshing the entire status (to keep it synced) 
    //for more fine grained update comes via socket.io
    $interval(load_data, 1000*60*3); //every 3 minutes?

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
    
    socket.on('connect', function() {
        //grab key up to non _ token (like _test.f771b6c2b8f)
        var tokens = $scope.rootkey.split(".");
        var room = "";
        for(var i = 0;i < tokens.length;++i) {
            if(room != "") room += ".";
            room += tokens[i];
            if(tokens[i][0] != "_") break;
        };
        socket.emit('subscribe', room); //no cb?
    });

    load_data(); //now load the first data

    socket.on('update', function (data) {
        $scope.$apply(function() {
            var prev = $scope.status;
            data.forEach(function(update) {
                console.log(update.key);

                if(update.key.indexOf($scope.rootkey) == -1) {
                    console.log("received unwanted key :"+update.key);
                    return;
                }
                //console.log(update);
                var node = catalog[update.key];
                if(!node) {
                    if(prev.tasks === undefined) prev.tasks = [update];
                    else prev.tasks.push(update);
                    catalog[update.key] = update;
                    prev = update;
                } else {
                    for(var key in update) node[key] = update[key]; //apply update
                    prev = node;
                }
            });
        });
    });
}]);

controllers.directive('scaProgress', function() {
    return {
        restrict: 'E',
        scope: {
            detail: '=detail'
        },
        templateUrl: 't/scaprogress.html'
    };
});

