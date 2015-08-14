
export HPSS_PRINCIPAL=doqqs
export HPSS_AUTH_METHOD=keytab
export HPSS_KEYTAB_PATH=/home/hayashis/test/gis/doqqs.keytab

export DEBUG=isdp:*
export PORT=12346 

nohup nodemon -i barn -i test index.js > nohup_server.out &
