#!/usr/bin/env node

var fs = require('fs')
  , path = require('path')
  , net = require('net')
  , Frap = require('frap')
  , log = console.log

var PORT = 6000

//Frap.VERBOSE = 1
//Frap.RFrameStream.VERBOSE = 1
//Frap.WFrameStream.VERBOSE = 1

var FILENAME, FILESTAT
try {
  FILENAME = process.argv[2]
  FILESTAT = fs.statSync(FILENAME)
}
catch (e) {
  log(e)
  process.exit(1)
}

log("FILENAME=%s", FILENAME)

var sk = net.connect(PORT, function(){
  var frap = new Frap(sk)
    , basename = path.basename(FILENAME)
    , namebuf = new Buffer(basename, 'utf8')

  function sendFile(frap, filename, filesize) {
    var rstream = fs.createReadStream(filename)
      , wstream = frap.createWriteStream(filesize)

    rstream.once('end', function(){
      wstream.destroySoon()
    })

    wstream.once('close', function(){
      log("file, %s, sent", filename)
      log("closing socket")
      sk.end()
    })

    rstream.pipe(wstream)
  }

  frap.sendFrame(namebuf)
  sendFile(frap, FILENAME, FILESTAT.size)
})

sk.on('end', function(){ log("good bye") })
