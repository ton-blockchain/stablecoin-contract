func -SPA -o ./build/jetton-wallet.fif stdlib.fc op-codes.fc params.fc jetton-utils.fc jetton-wallet.fc
func -SPA -o ./build/jetton-minter.fif stdlib.fc op-codes.fc params.fc jetton-utils.fc jetton-minter.fc

fift -s build/print-hex.fif
