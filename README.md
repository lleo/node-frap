Frap - Framing Wrapper
======================

  var net = require('net')
    , frap = require('frap')
    , svr = {}
  
  svr.sk = net.createServer().listen(7000)
  svr.chan = {}
  svr.sk.on('connection', funtion(sk){
    var chan = new frap.Channel(sk)
    svr.chan[chan.id] = chan
    chan.on('header', function(framelen, stream) {
      stream.on('data', function() {})
    })
  })
  
  //Echo w/partials (previous terminology)
  frap.on('frame', function(rstream, framelen) {
    wstream = frap.start(framelen)
    rstream.pipe(wstream)
  })
  
## API

### Constructor

  frap = new Frap(src) //src could be a net.Socket or any read/write Stream

  frap.on('frame', function(rstream, framelen) {
    rstream.on('data', function(buf){ ... })
  })
  
  frap.receive(cb) //cb(err, buf)
    This creates a receiver FSM that accumulates a large buffer of all
    buffers from each new frame stream.

  frap.receiveOnce(cb)
    Same as above but doesn't rearm the FSM accumulator.

  wstream = frap.start(framelen)
    Can not call start till framelen bytes written to wstream

  frap.send(buf, cb) //cb(err) if (!err) SUCESS!
    Tries to send a buf all at once. Basically it is this:
      frap.send(buf) {
        wstream = frap.start(buf.length)
        wstream.on('close', cb)
        wstream.on('error', cb)
        wstream.write(buf)
      }
