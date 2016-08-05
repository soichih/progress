#!/bin/bash

api="https://soichi7.ppa.iu.edu/api/progress"

curl -H "Content-type: application/json" -X DELETE $api/_test.scott1

curl -X POST -H "Content-Type: application/json" \
    -d '{"name": "test instance", "status": "waiting", "msg":"root msg"}' $api/status/_test.scott1

#curl -X POST -H "Content-Type: application/json" \
#    -d '{"name": "task1", "status": "running", "msg":"initializing"}' $api/status/_test.scott1.task1

curl -X POST -H "Content-Type: application/json" \
    -d '{"name": "task", "status": "running", "msg":"initializing"}' $api/status/_test.scott1.task

curl -X POST -H "Content-Type: application/json" \
    -d '{"name": "0 weight sub task", "weight": 0, "status": "running", "msg":"ahahaha"}' $api/status/_test.scott1.task.subtask

curl -X POST -H "Content-Type: application/json" \
    -d '{"name": "subtask", "status": "finished", "progress": 1}' $api/status/_test.scott1.task.subtask


#curl -X POST -H "Content-Type: application/json" \
#    -d '{"name": "task prep", "status": "running", "progress": 1, "msg":"initializing", "weight": 0}' $api/status/_test.a100.prep

#curl -X POST -H "Content-Type: application/json" \
#    -d '{"name": "task prep", "status": "running", "progress": 0.50, "msg":"initializing"}' $api/status/_test.a100.task

#curl -X POST -H "Content-Type: application/json" \
#    -d '{"progress": 0.3, "msg":"running stuff"}' $api/status/_test.a100.prep

