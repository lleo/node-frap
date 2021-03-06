#!/usr/bin/env node

var net = require('net')
  , Frap = require('..')
  , svr

svr = net.createServer().listen(7000)

svr.on('connection', function(sk){
  var frap = new Frap(sk, {emit: 'basic'})

  var id = sk.remoteAddress + ":" + sk.remotePort

  console.log("connection:", id)

  frap.pipe(frap)

  frap.once('close', function() {
    console.log("close:", id)
  })

  sk.on('end', function() {
    console.log("sk.on 'end':", id)
  })
})
