'use strict';

//this is checked in to git as default
//nothing sensitive should go here (since it will be published via web server anyway)

angular.module('app.config', [])
.constant('appconf', {
    version: '0.0.1',
    title: 'Progress',

    debug: false,

    api: 'https://soichi7.ppa.iu.edu/api/progress',
    socket: {
        base: 'https://soichi7.ppa.iu.edu',
        opts: {path: '/api/progress/socket.io'},
    },

    auth_api: '../api/auth',

    profile_api: '../api/profile',
    profile_url: '../profile',

    //shared servive api and ui urls (for menus and stuff)
    shared_api: '../api/shared',
    shared_url: '../shared',

    //default location to redirect after successful login
    //default_redirect_url: 'https://soichi7.ppa.iu.edu/profile', 

    jwt_id: 'jwt'
});

