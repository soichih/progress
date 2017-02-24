
#export DEBUG=isdp:*
#export PORT=12346 

#nohup nodemon ./progress.js &
pm2 delete progress
pm2 start api/progress.js --name sca-progress --watch --ignore-watch="\.log$ ui"
pm2 save
