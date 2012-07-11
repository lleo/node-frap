#!/usr/bin/env node

var fs = require('fs')
  , net = require('net')
  , path = require('path')
  , Frap = require('frap')
  , log = console.log

var PORT = 6000

if (process.argv.length !== 3) {
  log("%s <directory>", path.basename(process.argv[1]))
  process.exit(1)
}

try {
  var DIR = process.argv[2]
    , stat = fs.statSync(DIR)
}
catch (e) {
  log("directory, %s, does not exist", DIR)
  process.exit(1)
}

if (!stat.isDirectory()) {
  log("%s is not a directory", DIR)
  process.exit(1)
}

var svr = net.createServer(PORT, function(sk){
  log("socket connected: %s:%d", sk.remoteAddress, sk.remotePort)
  var frap = new Frap(sk)
  
  frap.once('data', function (buf) {
    var filename, fn = buf.toString('utf8')
    log("frame received: fn=%s", fn)
    filename = path.join(DIR, fn)
    log("using filename, %s", filename)
    
    frap.once('begin', function (rstream, framelen) {
      log("begin event: framelen=%d", framelen)
      var wstream = fs.createWriteStream(filename)
      
      rstream.once('close', function(){
        log("rstream close")
        sk.end()
      })

      rstream.pipe(wstream)
    }) //frap.once('begin')
  }) //frap.once('data')
})

svr.listen(PORT)
