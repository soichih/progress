# isdp
ISDP multi-file download service

## TODOs

1) Currently it receives request via web and immediately start processing request. This means all simultaneously requests will be executed in parallel... instead, I need to do following.

* When a request comes, post to AMQP
* Write a separate handler that pulls request from AMQP one at a time and handle request

2) Currently doesn't handle invalid file path gracefully. Maybe I should skip missing ones and output a text file stating that files couldn't be downloaded?

3) Make sure an appropriate error message is generated (to who?) if incoming message is bogus.

4) Add a sensu check to make sure web-receiver and request handlers are running.




