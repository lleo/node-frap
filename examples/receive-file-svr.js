#!/usr/bin/env node

var fs = require('fs')
  , net = require('net')
  , path = require('path')
  , Frap = require('..')
  , log = console.log

var PORT = 6000

if (process.argv.length !== 3) {
  log("%s <directory>", path.basename(process.argv[1]))
  process.exit(1)
}

try {
  var DL_DIR = process.argv[2]
    , stat = fs.statSync(DL_DIR)
}
catch (e) {
  log("directory, %s, does not exist", DL_DIR)
  process.exit(1)
}

if (!stat.isDirectory()) {
  log("%s is not a directory", DL_DIR)
  process.exit(1)
}

var svr = net.createServer(PORT, function(sk){
  log("socket connected: %s:%d", sk.remoteAddress, sk.remotePort)
  var frap = new Frap(sk)

  var state = 'filename'
    , filename
  frap.on('data', function (buf) {
    if (state !== 'filename') return

    filename = buf.toString('utf8')
    log("using filename, %s", filename)

    state = 'filedata'
  })
  frap.on('header', function (framelen) {
    if (state !== 'filedata') return

    var rstream = frap.createReadFrameStream(framelen)

    var dl_filename = path.join(DL_DIR, filename)
      , wstream = fs.createWriteStream(dl_filename)

    rstream.once('close', function(){
      state = 'filename'
      wstream.destroySoon()
    })

    wstream.once('close', function() { rstream.resume() })

    //rstream.pipe(wstream)
    rstream.pipe(wstream, {end: false})
  })
})

svr.listen(PORT)
