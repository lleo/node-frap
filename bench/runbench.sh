#!/bin/sh

if [ ! -f './package.json' ]; then
  echo "wrong directory"
  exit 1
fi

./bench/raw-echo.js 2>&1 >raw-echo.out &
SVRPID=$!

num_frames=100000
frame_size=10

/usr/bin/time ./bench/line-send.js -n $num_frames -z $frame_size
/usr/bin/time ./bench/frap-send.js -n $num_frames -z $frame_size
/usr/bin/time ./bench/frap-send.js -n $num_frames -z $frame_size

kill $SVRPID
