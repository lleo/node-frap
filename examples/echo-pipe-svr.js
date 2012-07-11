#!/usr/bin/env node

var net = require('net')
  , Frap = require('frap').Frap
  , svr = {}
  , log = console.log

if (process.env['FRAP_VERBOSE']) {
  Frap.VERBOSE = 1
  Frap.RFrameStream.VERBOSE = 1
  Frap.WFrameStream.VERBOSE = 1
}

svr.sk = net.createServer().listen(7000)

svr.sk.on('connection', function(sk){
  var frap = new Frap(sk, true)

  log("connection:", frap.id)

  frap.pipe(frap)
  
  frap.once('close', function() {
    log("close:", frap.id)
  })
  
  sk.on('end', function() {
    log("sk.on 'end'", frap.id)
  })
})
