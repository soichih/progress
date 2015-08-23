'use strict';

var controllers = angular.module('progressControllers', [ 'ui.bootstrap' ]);
controllers.controller('DetailController', ['$scope', 'appconf', '$route', 'toaster', '$http', '$cookies', '$routeParams', '$location',
function($scope, appconf, $route, toaster, $http, $cookies, $routeParams, $location) {
    $scope.title = appconf.title;
    /*
    $scope.test = function() {
        $http.get(appconf.api+'/verify')
        .success(function(data, status, headers, config) {
            toaster.success("You are logged in!");
            $scope.jwt_dump = JSON.stringify(data, null, 4);
            console.dir(data);
        })
        .error(function(data, status, headers, config) {
            toaster.error(data.message);
        }); 
    }
    */
    $http.get('https://soichi7.ppa.iu.edu/api/progress/status?key=_portal.test123&depth=2')
    .success(function(data) {
        console.dir(data);
        $scope.status = data;
    });
}]);

//see http://plnkr.co/edit/T0BgQR?p=info
controllers.directive('progressTree', function() {
    /*
    return {
        template: '<ul><choice ng-repeat="choice in tree"></choice></ul>',
        replace: true,
        transclude: true,
        restrict: 'E',
        scope: {
            tree: '=ngModel'
        }
    };
    */
    return { 
        restrict: 'E',
        //In the template, we do the thing with the span so you can click the 
        //text or the checkbox itself to toggle the check
        template: '<li>' +
          '<span ng-click="choiceClicked(choice)">' +
            '<input type="checkbox" ng-checked="choice.checked"> {{node.name}}' +
          '</span>' +
        '</li>',
        link: function(scope, elm, attrs) {
            /*
          scope.choiceClicked = function(choice) {
            choice.checked = !choice.checked;
            function checkChildren(c) {
              angular.forEach(c.children, function(c) {
                c.checked = choice.checked;
                checkChildren(c);
              });
            }
            checkChildren(choice);
          };
            */
          
          //Add children by $compiling and doing a new choice directive
          if (scope.tasks) {
            var tasks = $compile('<progressTree ng-model="scope.tasks"></choice-tree>')(scope)
            elm.append(childChoice);
          }
        }
    };

});
