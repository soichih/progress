#!/bin/bash

curl -H "Accept: application/json" \
    -H "Content-type: application/json" \
    -X GET http://localhost:12346/health

curl -H "Accept: application/json" \
    -H "Content-type: application/json" \
    -X GET http://localhost:12346/test
