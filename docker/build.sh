docker build -t soichih/sca-progress ..
if [ ! $? -eq 0 ]; then
    echo "failed to build"
    exit
fi
docker tag soichih/sca-progress soichih/sca-progress:1.0.0
docker push soichih/sca-progress
