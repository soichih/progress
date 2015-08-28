'use strict';

var app = angular.module('scaApp', [
    'app.config',
    'ngSanitize',
    'ngRoute',
    'ngAnimate',
    'ngCookies',
    'toaster',
    'angular-loading-bar',
    'progressControllers' 
]);

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
