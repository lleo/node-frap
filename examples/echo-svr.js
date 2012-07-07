#!/usr/bin/env node

var net = require('net')
  , Frap = require('frap').Frap
  , svr = {frap: {}}

svr.sk = net.createServer().listen(7000)

svr.sk.on('connection', function(sk){
  var frap = new Frap(sk)

  console.log("connection:", frap.id)

  svr.frap[frap.id] = frap

  frap.on('frame', function(buf) {
    //simple echo
    console.log("recv:", buf.toString('utf8'))
    frap.sendFrame(buf)
  })

  frap.on('end', function() {
    console.log("end:", frap.id)
    delete svr.frap[frap.id]
  })
})
