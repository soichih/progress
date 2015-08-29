'use strict';

//this is checked in to git as default
//nothing sensitive should go here (since it will be published via web server anyway)

angular.module('app.config', [])
.constant('appconf', {
    version: '0.0.1',
    title: 'Progress',

    api: 'https://soichi7.ppa.iu.edu/api/progress',
    socket: {
        base: 'https://soichi7.ppa.iu.edu',
        opts: {path: '/api/progress/socket.io'},
    }

    //default location to redirect after successful login
    //default_redirect_url: 'https://soichi7.ppa.iu.edu/profile', 

    //jwt_id: 'jwt'
});

