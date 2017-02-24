
docker run \
    --name sca-progress1 \
    --net test \
    -v `pwd`/config:/app/api/config \
    --rm -it soichih/sca-progress
