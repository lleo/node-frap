#!/usr/bin/env node

var net = require('net')
  , Frap = require('../')
  , msg = {cmd: "print", args: ["hello", "world"]}

var sk = net.createConnection(7000, function() {
  var frap = new Frap(sk)

  frap.once('data', function(buf) {
    var recv_msg = JSON.parse(buf.toString('utf8'))
    console.log("recv:", recv_msg)
    sk.end()
  })

  frap.write(JSON.stringify(msg), 'utf8')
})
