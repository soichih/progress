#!/bin/bash

api="https://soichi7.ppa.iu.edu/api/progress/status/"

curl -X POST -H "Content-Type: application/json" \
    -d '{"status": "running", "progress": 1, "msg":"whatevere"}' \
    $api/_sca.5680359590aee1d71f40c7ba.5686b94a6893a91907de070c

#curl -X POST -H "Content-Type: application/json" \
#    -d '{"status": "finished", "progress": 1, "msg":"something"}' \
#    $api/_sca.5680359590aee1d71f40c7ba.5686b94a6893a91907de070c.service

