#!/usr/bin/env node

var net = require('net')
  , Frap = require('frap').Frap
  , cli = {}

Frap.VERBOSE = 1
Frap.RFrameStream.VERBOSE = 1
Frap.WFrameStream.VERBOSE = 1

var msg = {cmd: "print", args: ["hello", "world"]}

var sk = net.createConnection(7000, function() {
  var frap = new Frap(sk)

  frap.once('data', function(buf) {
    var recv_msg = JSON.parse(buf.toString('utf8'))
    console.log("recv:", recv_msg)
    frap.end()
  })

  frap.sendFrame(new Buffer(JSON.stringify(msg), 'utf8'))
})
