

test: .PHONY
	mocha test/T??-*.js

bench: bench-large bench-medium bench-small

bench-large:
	@make -f bench.mk NF=20 FZ=100000000

bench-medium:
	@make -f bench.mk NF=20000 FZ=100000

bench-small:
	@make -f bench.mk NF=100000 FZ=100

clean:
	@rm *.err

.PHONY:
