#!/usr/bin/env node

var fs = require('fs')
  , path = require('path')
  , net = require('net')
  , Frap = require('frap')
  , nomnom = require('nomnom')
  , log = console.log

var VERBOSE=0
var opt = nomnom.script('send-file-cli')
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
  .option('filename', {
    abbr: 'f'
  , required: true
  , help: 'file to send'
  })
  .parse()

var sk = net.connect(opt.port, function(){
  var frap = new Frap(sk)
    , basename = path.basename(opt.filename)
    , namebuf = new Buffer(basename, 'utf8')
    , sent

  function sendFile(frap, filename) {
    fs.stat(filename, function (err, stat) {
      var rstream = fs.createReadStream(filename)
        , wstream = frap.createWriteStream(stat.size)

      wstream.once('close', function(){
        log("file, %s, sent", filename)
        log("closing socket")
        sk.end()
      })

      rstream.pipe(wstream)
    })
  }

  sent = frap.sendFrame(namebuf)
  if (!sent) {
    frap.once('drain', sendFile, frap, opt.filename)
    return
  }
  else
    sendFile(frap, opt.filename)
})

sk.on('end', function(){ log("good bye") })
