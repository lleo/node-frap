#!/usr/bin/env node

var net = require('net')
  , log = console.log

var PORT = 7000

var svr = net.createServer(function(sk){
  var id = sk.remoteAddress + ":" + sk.remotePort
  log("connect %s", id)
  sk.pipe(sk)
  sk.on('close', function(){ log("closed %s", id) })
}).listen(PORT)

log("listening on %d", PORT)