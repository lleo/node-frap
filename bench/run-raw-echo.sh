#!/bin/sh

if [ ! -f './package.json' ]; then
  echo "wrong directory"
  exit 1
fi

PORT=7000
num_frames=$1
frame_size=$2

echo "Starting: examples/raw-echo.js"
./bench/raw-echo.js -p $PORT 2>raw-echo.err >/dev/null &
SVRPID=$!
sleep 1

#./bench/line-send.js -p $PORT -n $num_frames -z $frame_size
./bench/frap-send.js -p $PORT -n $num_frames -z $frame_size

kill $SVRPID
sleep 1
