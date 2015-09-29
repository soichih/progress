'use strict';

var app = angular.module('app', [
    'app.config',
    'ngSanitize',
    'ngRoute',
    'ngAnimate',
    'ngCookies',
    'toaster',
    'angular-loading-bar',
    'btford.socket-io',
    'progressControllers',
]);

//can't quite do the slidedown animation through pure angular/css.. borrowing slideDown from jQuery..
app.animation('.slide-down', ['$animateCss', function($animateCss) {
    return {
        enter: function(elem, done) {
            $(elem).hide().slideDown("slow", done);
        },
        leave: function(elem, done) {
            $(elem).slideUp("slow", done);
        }
    };
}]);

app.factory('socket', ['appconf', 'socketFactory', function(appconf, socketFactory) {
    //console.dir(appconf.socket);
    return socketFactory({
        //prefix: 'foo~', //what is this for?
        ioSocket: io.connect(appconf.socket.base, appconf.socket.opts)
    });
}]);

//show loading bar at the top
app.config(['cfpLoadingBarProvider', function(cfpLoadingBarProvider) {
    cfpLoadingBarProvider.includeSpinner = false;
}]);

//configure route
app.config(['$routeProvider', 'appconf', function($routeProvider, appconf) {
    $routeProvider
    .when('/home', {
        templateUrl: 't/home.html',
        controller: 'HomeController',
    })
    .when('/detail/:key', {
        templateUrl: 't/detail.html',
        controller: 'DetailController',
    })
    .otherwise({
        redirectTo: '/home'
    });
}]);


