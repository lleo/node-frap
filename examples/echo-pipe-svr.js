#!/usr/bin/env node

var net = require('net')
  , Frap = require('frap').Frap
  , svr = {frap: {}}
  , log = console.log
  , VERBOSE = false

svr.sk = net.createServer().listen(7000)

svr.sk.on('connection', function(sk){
  var frap = new Frap(sk)

  log("connection:", frap.id)

  svr.frap[frap.id] = frap

  frap.on('begin', function(rstream, framelen) {
    rstream.once('end', function(){
      if (VERBOSE) log("%s rstrem.once 'end': pausing frap", frap.id)
      frap.pause()
    })

    //Setup echo pipe
    var wstream = frap.createWriteStream(framelen)

    wstream.once('close', function(){
      if (VERBOSE) log("%s wstream.once 'finished': resuming frap", frap.id)
      frap.resume()
    })

    rstream.pipe(wstream)
  })

  frap.on('end', function() {
    log("%s frap end:", frap.id)
    delete svr.frap[frap.id]
  })
})
