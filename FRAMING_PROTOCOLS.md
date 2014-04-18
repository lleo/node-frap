(If you understand framing protocols and the need for them with sockets, skip
this *Problem*/*Solution* section.)

## Problem

When your _sender_ writes a series of buffers to a socket, the _receiver_
receives data by way of one, or more, `'data'` socket events; each event with a
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

