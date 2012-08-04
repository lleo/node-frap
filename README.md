Frap - Framing Wrapper
======================

On the receiver socket, the buffer from each individual 'data' event is not
guaranteed to be the same as the Buffer sent by the senders `write()` call.
To get that you must use a Framing Protocol between the sender and receiver
(see FRAMING_PROTOCOLS.md).

This `Frap` module provides just a framing protocol.

## Example: Send a JSON object

### [echo-svr.js](examples/echo-svr.js)

```js
var svr = net.createServer().listen(7000)

svr.on('connection', function(sk){
  var frap = new Frap(sk)
  frap.on('data', function(buf) {
    //simple echo
    frap.write(buf)
  })
})
```
  
### [send-msg.js](examples/send-msg.js)

```js
var msg = {cmd: "print", args: ["hello", "world"]}
  , sk = net.createConnection(7000, function() {
  , frap = new Frap(sk)

  frap.on('data', function(buf) {
    var recv_msg = JSON.parse(buf.toString('utf8'))
    console.log("recv:", msg)
    sk.end()
  })

  frap.write(JSON.stringify(msg), 'utf8')
})
```

## Example: Send a file

### [send-file-cli.js](examples/send-file-cli.js)

```js
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

  frap.write(namebuf)
  sendFile(frap, FILENAME, FILESTAT.size)
})
```

### [receive-file-svr.js](examples/receive-file-svr.js)

```js
var svr = net.createServer(PORT, function(sk){
  var frap = new Frap(sk)

  var state = 'filename'
    , filename
  frap.on('data', function (buf) {
    if (state !== 'filename') return

    filename = buf.toString('utf8')
    log("using filename, %s", filename)

    state = 'filedata'
  })
  frap.on('header', function (rstream, framelen) {
    if (state !== 'filedata') return

    var dl_filename = path.join(DL_DIR, filename)
      , wstream = fs.createWriteStream(dl_filename)

    rstream.once('close', function(){
      state = 'filename'
      wstream.destroySoon()
    })

    rstream.pipe(wstream)
  })
}
```

## API

### Constructor `Frap(sk, [options])`

`sk` is usually a net.Socket, but it can be any read/write Stream.

`options` is an optional argument. It must be an object. The following
properties are recognized:

* `emit` is either `'data'`, `'frame'`, or `'basic'`. It defaults to `'data'`.

  If you set it to `'basic'` buffers will not be accumulated to emit `'frame'`
  and/or `'data'` events. There is two reasons for this: First, for a
  large frame, megabytes or gigabytes large, the `Frap` object would have to
  collect the incoming Buffers until a complete frame was received. Second, in
  order for a `'data'` event to be emitted those collected buffers would have
  to be joined into a new, rather large, Buffer; an expensive operation.

### Properties

* `draining`

  Has value `true` when waiting for a `'drain'` event, `false` otherwise.

* `writing`

  Has value `true` if `this.draining` or a `WriteFrameStream` is active,
  `false` otherwise.

### Events

* Event: `'data'`

  `function (buf) { }`

  Where `buf` is a single Buffer object.

  `'data'` events are the same as `'frame'` events except that they have
  had the buffers concatenated into a single buffer. This concatenation
  operation is expensive so if there is no listeners for `'data'` events
  the concatenation will not occur.

  `write()` is the complement of `'data'` events.

  Disabled if `options.emit === 'basic' or 'frame'` passed to constructor.

* Event: `'frame'`

  `function (bufs, framelen)`

  Where `bufs` is an array of Buffer objects. and `framelen` is an integer
  number of bytes of the frame size and the sum of the lengths of each of the
  Buffer objects in `bufs`.

  `sendFrame()` is the complement of `'frame'` events.

  Disabled if `options.emit === 'basic'` is passed to constructor. You might
  want to disable `'frame'` events to stop this library from accumulating
  very large number buffers in memory for very large _frames_.

* Event: `'header'`

  `function (framelen) { }`

  Emitted when a header is encountered in the input stream.

  Typically you only listen to this event when you want to treat an incoming
  frame as a stream. You do that by calling `createReadFrameStream()` inside
  the handler for this event.

* Event: `'part'`

  `function (buf, pos, framelen) { }`

  Emitted for each buffer in the input stream. `pos` is the position where
  the buffer starts within the _frame_. `framelen` is for the current
  processing frame.

  Typically end users do not listen to this event.

* Event: `'drain'`

  `function () { }`

  Emitted when the source stream flushes all the pending writes.

* Event: `'error'`

  `function (err) { }`

  A simple pass thru of any `'error'` event from the input data stream.

* Event: `'end'`

  `function () { }`

  Emitted when `end()` is called.

* Event: `'close'`

  `function (had_error) { }`

  Emitted when `destroy()` is called.

### Frap Methods

* `sendFrame(buf0, buf1, ..., bufN)`

  Arguments `buf0, buf1, ..., bufN` are `Buffer` objects. The lengths of these
  buffers are summed to determine the _frame_ length.

  This is can be more efficient than concatenating these buffers and using
  `write()` to send the whole large buffer as one frame.

### Stream Methods

* `write(buf)`
* `write(str, enc)`

  Write a new _frame_ with `buf.length` as the _frame_ length.

* `setEncoding(enc)`

  Inherited from FrapReader. All 'data' events will be converted from `Buffer`
  to `String` via `Buffer#toString(enc)`.

* `pause()`

  Suspend emitting `'data'`, `'frame'`, `'header'` or `'part'` events. It will
  also call `pause()` on the underlying source stream (`sk` from the
  constructor).

* `resume()`

  Resume emitting `'data'`, `'frame'`, `'header'` or `'part'` events. It will
  also call `resume()` on the underlying source stream (`sk` from the
  constructor).

* `pipe(dst)`

  A specialized pipe for `Frap` objects. If `dst` is a `Frap` object, then the
  current `Frap` object will be piped into the `dst` `Frap` object using 
  `ReadFrameStream` and `WriteFrameStream`, rather than buffering up an entire
  frame and writing that into the `dst` object. This is much more space
  efficient, though potentially slower until the _frames_ get large enough
  where the `Read/WriteFrameStream` overhead is less than the `Buffer#concat()`
  overhead.

  If `dst` is not an `instanceof Frap`, then it will use the default Stream
  pipe implementation.

* `end()`

  Stop the `Frap` object from emitting any new `'data'`, `'frame'`, `'header'`
  or `'part'` events and allow any unsent data to drain.

* `destroy()`

  Close this Stream regardless of any unsent data. Emit a 'close' event.

* `destroySoon()`

  Close this Stream. Allow any unsent data to drain. Then Emit a 'close'
  event.

### Misc Methods

* `createReadFrameStream(framelen)`

  Create and return a RFrameStream object. Only one may exist at a time for
  each `Frap` object, otherwise it will throw an `AssertionError`.

* `createWriteFrameStream(framelen)`

  Create and return a WFrameStream object. Only one may exist at a time for
  each `Frap` object, otherwise it will throw an `AssertionError`.

### FrapReader (Frap inherits from FrapReader)

* `parse(buf)`

  Parse Buffer, `buf`, and emit resulting `'data'`, `'frame'`, `'header'`, and
  `'part'` events.
