#!/bin/bash

api="https://soichi7.ppa.iu.edu/api/progress"

curl -H "Content-type: application/json" -X DELETE $api/_test.scott1

curl -X POST -H "Content-Type: application/json" \
    -d '{"name": "test instance", "status": null, "msg":"root msg"}' $api/status/_test.scott1


