#!/bin/sh

if [ ! -f './package.json' ]; then
  echo "wrong directory"
  exit 1
fi

PORT=7000
num_frames=$1
frame_size=$2

echo "Starting: bench/dev-null.js"
./bench/dev-null.js -p $PORT 2>dev-null.err >/dev/null &
SVRPID=$!
sleep 1

#./bench/line-send.js -R -p $PORT -n $num_frames -z $frame_size
./bench/frap-send.js -R -p $PORT -n $num_frames -z $frame_size

kill $SVRPID
sleep 1
