#!/bin/sh

if [ ! -f './package.json' ]; then
  echo "wrong directory"
  exit 1
fi

PORT=7000
num_frames=$1
frame_size=$2

echo "Starting: examples/echo-svr.js"
./examples/echo-svr.js 2>echo-svr.err >/dev/null &
SVRPID=$!
sleep 1

./bench/frap-send.js -p $PORT -n $num_frames -z $frame_size

kill $SVRPID
sleep 1
