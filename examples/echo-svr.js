#!/usr/bin/env node

var net = require('net')
  , Frap = require('frap').Frap
  , svr = {frap: {}}

svr.sk = net.createServer().listen(7000)

svr.sk.on('connection', function(sk){
  var frap = new Frap(sk)

  console.log("connection:", frap.id)

  frap.on('data', function(buf) {
    frap.write(buf)
  })

  frap.once('close', function() {
    console.log("close:", frap.id)
  })
})
