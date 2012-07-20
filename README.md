Frap - Framing Wrapper
======================

(If you understand framing protocols and the need for them with sockets, skip
this *Problem*/*Solution* section.)

## Problem

When your _sender_ writes a series of buffers to a socket, the _receiver_
receives data by way of on, or more, `'data'` socket events; each event with a
single `Buffer` as the event input. Each received Buffer is not guaranteed to
be just one of the _sender_'s socket `write()` calls worth of data, or even an
integer number of the _sender_'s `write()` data. Sockets just guarantee the
same number of bytes will be received as was sent and in the same order, but
sockets do not guarantee the data will be received as the same _chunks_ as
they were sent.

You need to put some data in the stream of bytes that tells the receiver when
these _chunks_ begin and end. This is called a *framing* protocol. Henceforth
_chunk_ will be called _frame_, and a _frame_ is defined as an ordered
sequence of bytes your _sender_ transmits and _receiver_ receives.

## Solution

There are two common solutions:

1. _Frame Separator_: Put an identifier between each _frame_. That identifier
can not occur inside the _frame_. Then parse each input blob of bytes looking
for the identifier. Then emit an event for the received _frame_. Often in
nodejs people are sending utf8 encoded strings of JSON objects so a common
identifier is a single newline charater.

2. _Frame Header_: Put a fixed binary header at the beginning of each _frame_
telling the _receiver_ how many bytes are in the frame. A simple header need
only be 4 bytes encoded as a unsigned 32bit integer in big-endian format (aka
network order). The receiver reads this integer as the "frame length" and just
reads the next "frame length" bytes off the socket as the _frame_.

Typically (or at least in non-dynamic languages) _Frame Header_ solutions are
faster and easier to implement. However, the V8 Javascript engine Node.js
is based on has quite fast string manipulation, and the Buffer objects are
a "bolt on" to the V8 engine. So scanning thru input strings for newline
characters is pretty fast and splicing/joining those string similarly speedy.
Splicing/joining Buffer object do not have any special optimizations. So my
tests show that _frames_ have to be on the order of 100,000 bytes long before
the _Frame Header_ method is faster.

Regardless of performance, the _Frame Header_ approach is better if your
_frames_ do not contain only strings, and/or you do not want to enforce the
_Frame Separator_ rule that a _frame_ may not contain the identifier.

## Examples

### [echo-svr.js](exampels/echo-svr.js)

    var svr = net.createServer().listen(7000)
    
    svr.on('connection', function(sk){
      var frap = new Frap(sk)
      frap.on('frame', function(bufs) {
        //simple echo
        frap.sendFrame(bufs)
      })
    })
  
### [send-msg.js](examples/send-msg.js)

    var msg = {cmd: "print", args: ["hello", "world"]}
      , sk = net.createConnection(7000, function() {
      frap = new Frap(sk)
    
      frap.on('data', function(buf) {
        var recv_msg = JSON.parse(buf.toString('utf8'))
        console.log("recv:", msg)
        frap.end() //does not end the socket
        sk.end()
      })
    
      frap.write(msg, 'utf8')
    })

### [send-file-cli.js](examples/send-file-cli.js)

    var sk = net.connect(PORT, function(){
      var frap = new Frap(sk)
        , basename = path.basename(FILENAME)
        , namebuf = new Buffer(basename, 'utf8')
    
      function sendFile(frap, filename, filesize) {
        var rstream = fs.createReadStream(filename)
          , wstream = frap.createWriteStream(filesize)
      
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

### [receive-file-svr.js](examples/receive-file-svr.js)

    var svr = net.createServer(PORT, function(sk){
      var frap = new Frap(sk)
    
      frap.once('data', function (buf) {
        var filename, fn = buf.toString('utf8')
        filename = path.join(DL_DIR, fn)
        console.log("using filename, %s", filename)
    
        frap.once('header', function (rstream, framelen) {
          var wstream = fs.createWriteStream(filename)
    
          rstream.once('close', function(){
            sk.end()
          })
    
          rstream.pipe(wstream)
        })
      })
    })

## API

### Constructor `Frap(sk, [options])`

`sk` is usually a net.Socket, but it can be any read/write Stream.

`options` is an optional argument. It must be an object. The following
properties are recognized:

* `noframes` is an boolean. If `true`, buffers will not be accumulated to emit
  `'frame'` and `'data'` events. There is two reasons for this: First, for a
  large frame, megabytes or gigabytes large, the `Frap` object would have to
  collect the incoming Buffers until a complete frame was received. Second, in
  order for a `'data'` event to be emitted those collected buffers would have
  to be joined into a new, rather large, Buffer; an expensive operation.

### Events

* Event: `'frames`

  `function (bufs, framelen)`

  Where `bufs` is an array of Buffer objects. and `framelen` is an integer
  number of bytes of the frame size and the sum of the lengths of each of the
  Buffer objects in `bufs`.

  `sendFrame()` is the complement of `'frame'` events.

  Disabled if `options.noframe === true` passed to constructor. You might
  want to disable `'frame'` events to stop this library from accumulating
  very large number buffers in memory.

* Event: `'data'`

  `function (buf) { }`
  
  Where `buf` is a single Buffer object.

  `'data'` events are the same as `'frame'` events except that they have
  had the buffers concatenated into a single buffer. This concatenation
  operation is expensive so if there is no listeners for `'data'` events
  the concatenation will not occur.

  `write()` is the complement of `'data'` events.

  Disabled if `options.noframe === true` passed to constructor.

* Event: `header`

  `function (rstream, framelen) { }`

  Emitted when a header is encountered in the input stream.

* Event: `part`

  `function (buf, pos) { }`

  Emitted for each buffer in the input stream. `pos` is the position where
  the buffer starts within the _frame_.

* Event: `drain`

  `function () { }`

  Emitted when the source stream flushes all the pending writes.

* Event: `error`

  `function (err) { }`

  A simple pass thru of any `'error'` event from the input data stream.

* Event: `end`

  `function () { }`

  Emitted when `end()` is called.

* Event: `close`

  `function (had_error) { }`

  Emitted when `destroy()` is called.

### Frap Methods

* `sendFrame(bufs)`
* `sendFrame(buf0, buf1, ..., bufN)`

  `bufs` may be an array of `Buffer` objects, or `buf0, buf1, ..., bufN` are
  `Buffer` objects. The lengths of these buffers are summed to determine the
  _frame_ length.

  This is can be more efficient than concatenating these buffers and using
  `write()` to send the whole large buffer as one frame.

### Stream Methods

* `write(buf)`
* `write(str, enc)`

  Write a new _frame_ with `buf.length` as the _frame_ length.

* `pause()`

  Suspend emitting 'data', 'frame', 'begin' or 'part' events. It will also
  call `pause()` on the underlying source stream (`sk` from the constructor).

* `resume()`

  Resume emitting 'data', 'frame', 'begin' or 'part' events. It will also
  call `resume()` on the underlying `sk` object (from the constructor).

* `pipe(dst)`

  A specialized pipe for `Frap`. If `dst` is a `Frap` object, then the current
  `Frap` object will be piped into the `dst` `Frap` object using each
  _partial_ data buffer, rather than buffering up an entire frame and writing
  that into the `dst` object. This is much more efficient. * * If `dst` is not
  an `instanceof Frap`, then it will use the default Stream pipe.

* `end()`
* `end(buf)`
* `end(str, enc)`

  Stop the `Frap` object from emitting any new 'data', 'frame', 'begin' or
  'part' events and allow any unsent data to drain.

* `destroy()`

  Close this Stream regardless of any unsent data. Emit a 'close' event.

* `destroySoon()`

  Close this Stream. Allow any unsent data to drain. Then Emit a 'close'
  event.

### Misc Methods

* `enableEmitFrame()`

  Start accumulating partial buffers to emit 'frame' and 'data' events.

* `disableEmitFrame()`

  Disable the accumulation of partial buffers and no longer emit 'frame' and
  'data' events.

* `createReadStream(framelen)`

  Create and return a RFrameStream object. Only one may exist at a time for
  each `Frap` object, otherwise it will throw an `AssertionError`.

* `createWriteStream(framelen)`

  Create and return a WFrameStream object. Only one may exist at a time for
  each `Frap` object, otherwise it will throw an `AssertionError`.
