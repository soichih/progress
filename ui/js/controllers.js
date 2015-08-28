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
        sim = $interval(simulate, 300);
    }

    $scope.test_stop = function() {
        $interval.cancel(sim);
        $scope.running = false;
    }

    var progress = {};
    var mutex = false;
    function simulate() {
        if(mutex) return;
        mutex = true;
        //generate rangom progress data
        var key = $scope.testid;
        if(!progress[key]) {     
            var p = {name: "Test Job with id"+key};
            $http.post(appconf.api+'/update', {key: key, p:p});
            progress[key] = p;
        }
        key += "."+parseInt(Math.random()*4);
        if(!progress[key]) {     
            var p = {name: "Subtask(level1) with id"+key};
            $http.post(appconf.api+'/update', {key: key, p:p});
            progress[key] = p;
        }
        key += "."+parseInt(Math.random()*4);
        if(!progress[key]) {     
            var p = {name: "Subtask(level2) with id"+key};
            $http.post(appconf.api+'/update', {key: key, p:p});
            progress[key] = p;
        }
        key += "."+parseInt(Math.random()*4);

        //here is the edge
        if(progress[key]) {
            progress[key].progress+=Math.random()/3;
            progress[key].status = "running";
            if(progress[key].progress > 1) {
                progress[key].progress= 1;
                progress[key].status = "finished";
            }
        } else {
            progress[key] = {progress: 0, weight: 1, status: "waiting", msg: "hello", name: "random edge job doing random thing"};
        }
        //console.dir(progress[key]);
        
        $http.post(appconf.api+'/update', {key: key, p:progress[key]})
        .success(function() {
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

controllers.controller('DetailController', ['$scope', 'appconf', '$route', 'toaster', '$http', '$cookies', '$routeParams', '$location', '$interval', 
function($scope, appconf, $route, toaster, $http, $cookies, $routeParams, $location, $interval) {
    $scope.title = appconf.title;
    var key = $routeParams.key;

    //start refreshing the entire status (to keep it synced) 
    //TODO - for more fine grained update needs to be done via socket.io
    $interval(function() {
        $http.get(appconf.api+'/status?key='+key+'&depth=3')
        .success(function(data) {
            console.dir(data);
            $scope.status = data;
        })
        .error(function(err) {
            toaster.error("Failed to load progress information: "+err.message);
            $scope.status = null;
        });
    }, 1000);
}]);

controllers.directive('scaProgress', function() {
    return {
        restrict: 'E',
        scope: {
            detail: '=detail'
        },
        templateUrl: 't/progress.html'
    };
});
