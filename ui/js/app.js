'use strict';

var app = angular.module('app', [
    'app.config',
    'ngSanitize',
    'ngRoute',
    'ngAnimate',
    'ngCookies',
    'toaster',
    'angular-loading-bar',
    'angular-jwt',
    'btford.socket-io',
    'sca-shared',
]);

//just a service to load all users from auth service
app.factory('serverconf', ['appconf', '$http', function(appconf, $http) {
    return $http.get(appconf.api+'/config')
    .then(function(res) {
        return res.data;
    });
}]);


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

//load menu and profile by promise chaining
//http://www.codelord.net/2015/09/24/$q-dot-defer-youre-doing-it-wrong/
//https://www.airpair.com/angularjs/posts/angularjs-promises
app.factory('menu', ['appconf', '$http', 'jwtHelper', '$sce', function(appconf, $http, jwtHelper, $sce) {
    var menu = {
        /*
        header: {
            label: appconf.title,
            icon: $sce.trustAsHtml("<img src=\""+appconf.icon_url+"\">"),
            url: "#/",
        }
        */
    };

    return $http.get(appconf.shared_api+'/menu/top').then(function(res) {
        menu.top = res.data;
        //then load user profile (if we have jwt)
        var jwt = localStorage.getItem(appconf.jwt_id);
        if(!jwt)  return menu;
        var user = jwtHelper.decodeToken(jwt);//jwt could be invalid
        return $http.get(appconf.profile_api+'/public/'+user.sub);
    }, function(err) {
        console.log("failed to load menu");
    }).then(function(res) {
        //TODO - this function is called with either valid profile, or just menu if jwt is not provided... only do following if res is profile
        //if(res.status != 200) return $q.reject("Failed to load profile");
        menu._profile = res.data;
        return menu;
    }, function(err) {
        console.log("couldn't load profile");
    });
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

//configure httpProvider to send jwt unless skipAuthorization is set in config (not tested yet..)
app.config(['appconf', '$httpProvider', 'jwtInterceptorProvider', 
function(appconf, $httpProvider, jwtInterceptorProvider) {
    jwtInterceptorProvider.tokenGetter = function(jwtHelper, config, $http, toaster) {
        //don't send jwt for template requests
        //(I don't think angular will ever load css/js - browsers do)
        if (config.url.substr(config.url.length - 5) == '.html') {
            return null;
        }

        var jwt = localStorage.getItem(appconf.jwt_id);
        if(!jwt) return null; //not jwt

        //TODO - I should probably put this in $interval instead so that jwt will be renewed regardless
        //of if user access server or not.. (as long as the page is opened?)
        //(also, make it part of shared or auth module?)
        var expdate = jwtHelper.getTokenExpirationDate(jwt);
        var ttl = expdate - Date.now();
        if(ttl < 0) {
            toaster.error("Your login session has expired. Please re-sign in");
            localStorage.removeItem(appconf.jwt_id);
            return null;
        } else if(ttl < 3600*1000) {
            //console.dir(config);
            console.log("jwt expiring in an hour.. refreshing first");
            //jwt expring in less than an hour! refresh!
            return $http({
                url: appconf.auth_api+'/refresh',
                skipAuthorization: true,  //prevent infinite recursion
                headers: {'Authorization': 'Bearer '+jwt},
                method: 'POST'
            }).then(function(response) {
                var jwt = response.data.jwt;
                //console.log("got renewed jwt:"+jwt);
                localStorage.setItem(appconf.jwt_id, jwt);
                return jwt;
            });
        }
        return jwt;
    }
    $httpProvider.interceptors.push('jwtInterceptor');
}]);

