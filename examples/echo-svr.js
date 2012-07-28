#!/usr/bin/env node

var net = require('net')
  , Frap = require('../')
  , svr

svr = net.createServer().listen(7000)

svr.on('connection', function(sk){
  var frap = new Frap(sk)

  var id = sk.remoteAddress + ":" + sk.remotePort
  console.log("connection:", id)

  frap.on('frame', function(bufs) {
    frap.sendFrame(bufs)
  })

  frap.once('close', function() {
    console.log("close:", id)
  })
})
