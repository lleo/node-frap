
bench: raw-echo echo-pipe echo null

raw-echo:
	@./bench/run-raw-echo.sh $(NF) $(FZ)

echo-pipe:
	@./bench/run-echo-pipe.sh $(NF) $(FZ)

echo:
	@./bench/run-echo.sh $(NF) $(FZ)

null:
	@./bench/run-null.sh $(NF) $(FZ)

clean:
	rm *.err
