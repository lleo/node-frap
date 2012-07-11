Frap - Framing Wrapper
======================

### server.js

    var net = require('net')
      , Frap = require('frap').Frap
      , svr = {frap: {}}
    
    svr.sk = net.createServer().listen(7000)
    
    svr.sk.on('connection', function(sk){
      var frap = new Frap(sk)
      svr.frap[frap.id] = frap
      frap.on('frame', function(bufs) {
        //simple echo
        frap.sendFrame(bufs)
      })
      frap.on('end', function() {
        delete svr.frap[frap.id]
      })
    })
  
### client.js

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
    })

## API

### Constructor `Frap(sk, [noframes])`

`sk` is usually a net.Socket, but it can be any read/write Stream.

`noframes` is an optional boolean. If `true`, buffers will not be accumulated
to emit `'frame'` and `'data'` events. There is two reasons for this: First,
for a large frame, megabytes or gigabytes large, the `Frap` object would have
to collect the incoming Buffers untill a complete frame was received. Second,
in order for a `'data'` event to be emitted those collected buffers would have
to be joined into a new, rather large, Buffer; a rather expensive operation.

### Events

* Event: `'data'`
  `function (buf) { }`
  Where `buf` is a single Buffer object.

* Event: `'frames`
  `function (bufs, framelen)`
  Where `bufs` is an array of Buffer objects. and `framelen` is an integer
  number of bytes of the frame size and the sum of the lengths of each of the
  Buffer objects in `bufs`.

* Event: `begin`
  `function (rstream, framelen) { }`

* Event: `part`
  `function (buf, pos) { }`

* Event: `drain`
  `function () { }`

* Event: `error`
  `function (err) { }`

* Event: `end`
  `function () { }`

* Event: `close`
  `function (had_error) { }`

### Frap Methods

* `sendFrame(bufs)`
* `sendFrame(buf0, buf1, ..., bufN)`
  `bufs` may be an array of `Buffer` objects, or `buf0, buf1, ..., bufN` are
  `Buffer` objects. The lengths of these buffers are summed to determine the
  frame length, and a frame is sent of that length with these buffers.

  This is more efficient than concatenating these buffers and using `write()`
  to send the whole large buffer as one frame.

### Stream Methods

* `write(buf)`
* `write(str, enc)`
  Write a new frame with `buf.length` as the frame length.

* `pause()`
  Suspend emitting 'data', 'frame', 'begin' or 'part' events. It will also
  call `pause()` on the underlying `sk` object (from the constructor).

* `resume()`
  Resume emitting 'data', 'frame', 'begin' or 'part' events. It will also
  call `resume()` on the underlying `sk` object (from the constructor).

* `pipe(dst)`
  A specialized pipe for `Frap`. If `dst` is a `Frap` object, then the current
  `Frap` object will be piped into the `dst` `Frap` object using each _partial_
  data buffer, rather than buffering up an entire frame and writing that into
  the `dst` object. This is much more efficient.
  
  If `dst` is not an `instanceof Frap`, then it will use the default Stream pipe.

* `end()`
* `end(buf)`
* `end(str, enc)`
  End the `Frap` object from emitting any new 'data', 'frame', 'begin' or 'part'
  events and allow any unsent data to drain.

* `destroy()`
  Close this Stream regardless of any unsent data. Emit a 'close' event.

* `destroySoon()`
  Close this Stream. Allow any unsent data to drain. Then Emit a 'close' event.

### Misc Methods

* `enableEmitFrame()`
  Start accumulating partial buffers to emit 'frame' and 'data' events.

* `disableEmitFrame()`
  Disable the accumulation of partial buffers and no longer emit 'frame' and
  'data' events.

* `createReadStream(framelen)`
  Create and return a RFrameStream object. Only one may exist at a time for
  each `Frap` object, other wise it will throw an `AssertionError`.

* `createWriteStream(framelen)`
  Create and return a WFrameStream object. Only one may exist at a time for
  each `Frap` object, other wise it will throw an `AssertionError`.
