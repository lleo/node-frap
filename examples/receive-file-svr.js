#!/usr/bin/env node

var fs = require('fs')
  , net = require('net')
  , path = require('path')
  , Frap = require('frap')
  , nomnom = require('nomnom')
  , log = console.log

var VERBOSE=0
var opt = nomnom.script('receive-file-svr')
  .option('verbose', {
    abbr: 'v'
  , flag: true
  , help: 'show more output'
  , callback: function() {
    VERBOSE += 1
      if (VERBOSE>1) {
        Frap.VERBOSE += 1
        Frap.RFrameStream.VERBOSE += 1
        Frap.WFrameStream.VERBOSE += 1
      }
    }
  })
  .option('port', {
    abbr: 'p'
  , default: 6000
  , help: 'connect port; default 6000'
  })
  .option('directory', {
    abbr: 'd'
  , required: true
  , default: '.'
  , help: "directory to download the file into; default='.'"
  })
  .parse()

var stat

try {
  stat = fs.statSync(opt.directory)
}
catch (e) {
  log("directory, %s, does not exist", opt.directory)
  process.exit(1)
}

if (!stat.isDirectory()) {
  log("%s is not a directory", opt.directory)
  process.exit(1)
}

var svr = net.createServer(opt.port, function(sk){
  log("socket connected: %s:%d", sk.remoteAddress, sk.remotePort)
  var frap = new Frap(sk)
  
  frap.once('frame', function (buf) {
    var filename, fn = buf.toString('utf8')
    log("frame received: fn=%s", fn)
    filename = path.join(opt.directory, fn)
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
  }) //frap.once('frame')
})

svr.listen(opt.port)
