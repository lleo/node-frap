#!/usr/bin/env node

var net = require('net')
  , Frap = require('frap').Frap
  , cli = {}

cli.msg = {cmd: "print", args: ["hello", "world"]}

cli.sk = net.createConnection(7000, function() {
  cli.frap = new Frap(cli.sk)

  cli.frap.on('frame', function(buf) {
    var msg = JSON.parse(buf.toString('utf8'))
    console.log("recv:", msg)
    cli.frap.end()
  })

  cli.frap.sendFrame(new Buffer(JSON.stringify(cli.msg), 'utf8'))
  if (sent)
    frap.once('drain', function(){log("on drain: sent message")})
  else
    log("immediate: sent message")
})
