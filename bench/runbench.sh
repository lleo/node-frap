#!/bin/sh

if [ ! -f './package.json' ]; then
  echo "wrong directory"
  exit 1
fi

# Prefered Usage: ./bench/runbench 200000 100
#

PORT=7000
num_frames=$1
frame_size=$2

echo "Starting: bench/raw-echo.js"
./bench/raw-echo.js -p $PORT 2>raw-echo.err >/dev/null &
SVRPID=$!

sleep 1

./bench/line-send.js -p $PORT -n $num_frames -z $frame_size
./bench/frap-send.js -p $PORT -n $num_frames -z $frame_size

kill $SVRPID

#echo-pipe-svr.js is hard coded to listen on 7000
echo "Starting: examples/echo-pipe-svr.js"
./examples/echo-pipe-svr.js 2>echo-pipe-svr.err >/dev/null &
SVRPID=$!

sleep 1

./bench/frap-send.js -p $PORT -n $num_frames -z $frame_size

kill $SVRPID

#echo-svr.js is hard coded to listen on 7000
echo "Starting: examples/echo-svr.js"
./examples/echo-svr.js 2>echo-svr.err >/dev/null &
SVRPID=$!

sleep 1

./bench/frap-send.js -p $PORT -n $num_frames -z $frame_size

kill $SVRPID

sleep 1

echo "Starting: bench/dev-null.js"
./bench/dev-null.js -p $PORT 2>dev-null.err >/dev/null &
SVRPID=$!

sleep 1

./bench/line-send.js -R -p $PORT -n $num_frames -z $frame_size
./bench/frap-send.js -R -p $PORT -n $num_frames -z $frame_size

kill $SVRPID
