#!/bin/bash

api="https://soichi7.ppa.iu.edu/api/progress"

curl -H "Content-type: application/json" -X DELETE $api/_test.a100

curl -X POST -H "Content-Type: application/json" \
    -d '{"name": "sca-backup-thaw", "status": "waiting", "msg":"root msg"}' $api/status/_test.a100

curl -X POST -H "Content-Type: application/json" \
    -d '{"status": "running", "msg":"initializing"}' $api/status/_test.a100

curl -X POST -H "Content-Type: application/json" \
    -d '{"name": "task prep", "status": "running", "progress": 0.05, "msg":"initializing", "weight": 0}' $api/status/_test.a100.prep

#following updates weight to 1 on progress server!!!!!!!!!!!!
curl -X POST -H "Content-Type: application/json" \
    -d '{"progress": 0.3, "msg":"running stuff"}' $api/status/_test.a100.prep

