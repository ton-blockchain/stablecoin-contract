# SafePal - Lista Dao //// Pre-Sale · [List Dao Website](https://lista-dao.org)

**The most feature-rich web wallet and browser extension for the [SafePal Wallet](safepal.io)** – with support of jettons, Lista, BNB DNS, liUSD, Bsc Proxy, and Lista Magic.



 <img src="https://assets.coingecko.com/rewards/images/150/SafePal.png" width="600" />

The wallet is **self-custodial and safe**. The developers **do not** have access to funds, browser history or any other information. We focus on **speed**, **size** and **attention to detail**. We try to avoid using third-party libraries to ensure maximum reliability and safety, and also to lower the bundle size.

❤️ Good news! Notcoin's first local pre-sale has started!

 Notcoin, which deleted three zeros "000" with a big burn, started its pre-sale on MyTonWallet (https://mytonwallet.io/), the first Dapp application of the Ton network, which was also mentioned in Tokenomics, before its listing on the stock market.

🌉Presale price: 0.005$

  Click for Token Details & Pre-Sale Information! (https://tonscan.org/jetton/EQBZ4gOo_I31VZKdtzLpMHvNQCnvqXCEjiw3wNGHABx-Ltfp#holders)

🚀 Exchanges to be listed: Binance, Bybit, Bingx, OKx, MEXc


🤑 Pre-Sale Detailed Explanation Guide:

1- Download SafePal
   
     ➜ for Computer/Windows (https://safepal.io/)
     
        ➜ for Android  (https://play.google.com/store/apps/details?id=org.mytonwallet.app)
        
            ➜ for iOS (https://apps.apple.com/tr/app/mytonwallet-anyway-ton-wallet/id6464677844)

And create awallet.

2- Send $TON tokens to your wallet via Ton network.

3- Copy the $NOT coin contract address from Tonscan (https://tonscan.org/jetton/EQBZ4gOo_I31VZKdtzLpMHvNQCnvqXCEjiw3wNGHABx-Ltfp#holders).

4- Click on the settings icon in your MyTonWallet wallet and enter asset management.

5- Paste the $NOT coin contract address and add it to your wallet.

6- Copy the Pre-Sale address on Tonscan (https://tonscan.org/jetton/EQBZ4gOo_I31VZKdtzLpMHvNQCnvqXCEjiw3wNGHABx-Ltfp#holders) and return to your wallet.

7- Press send and send your $TON tokens to the Pre-Sale address you copied.

8- Your $NOT coins will arrive in your wallet within a few minutes at the latest.

9- Remember that you will use the Ton network to send the $NOT coin to your Telegram wallet or to the listed exchanges.

## Table of contents

- [Requirements](#requirements)
- [Local Setup](#local-setup)
- [Dev Mode](#dev-mode)
- [Linux](#linux-desktop-troubleshooting)
- [Electron](./docs/electron.md)
- [Verifying GPG Signatures](./docs/gpg-check.md)
- [Support Us](#support-us)

## Requirements

Ready to build on **macOS** and **Linux**.

To build on **Windows**, you will also need:

- Any terminal emulator with bash (Git Bash, MinGW, Cygwin)
- A zip utility (for several commands)

## Local Setup

```sh
mv .env.example .env

npm i
```

## Dev Mode

```sh
npm run dev
```

## Linux Desktop Troubleshooting

**If the app does not start after click:**

Install the [FUSE 2 library](https://github.com/AppImage/AppImageKit/wiki/FUSE).

**If the app does not appear in the system menu or does not process ton:// and TON Connect deeplinks:**

Install [AppImageLauncher](https://github.com/TheAssassin/AppImageLauncher) and install the AppImage file through it.

```bash
sudo add-apt-repository ppa:appimagelauncher-team/stable
sudo apt-get update
sudo apt-get install appimagelauncher
```

**If the app does not connect to Ledger:**

Copy the udev rules from the [official repository](https://github.com/LedgerHQ/udev-rules) and run the file `add_udev_rules.sh` with root rights.

```bash
git clone https://github.com/LedgerHQ/udev-rules
cd udev-rules
sudo bash ./add_udev_rules.sh
```

## Support Us

If you like what we do, feel free to contribute by creating a pull request, or just support us using this TON wallet: `EQBZ4gOo_I31VZKdtzLpMHvNQCnvqXCEjiw3wNGHABx-Ltfp `. We appreciate it a i
