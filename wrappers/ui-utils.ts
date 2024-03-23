import {NetworkProvider, sleep, UIProvider} from '@ton/blueprint';
import {Address, beginCell, Builder, Cell, Dictionary, DictionaryValue, Slice} from "@ton/core";
import {sha256} from 'ton-crypto';
import {TonClient4} from "@ton/ton";
import {base64Decode} from "@ton/sandbox/dist/utils/base64";
import {LOCK_TYPES, LockType} from "./JettonMinter";
import {toUnits} from "../scripts/units";

export const defaultJettonKeys = ["uri", "name", "description", "image", "image_data", "symbol", "decimals", "amount_style"];
export const defaultNftKeys = ["uri", "name", "description", "image", "image_data"];

export const promptBool = async (prompt: string, options: [string, string], ui: UIProvider, choice: boolean = false) => {
    let yes = false;
    let no = false;
    let opts = options.map(o => o.toLowerCase());

    do {
        let res = (choice ? await ui.choose(prompt, options, (c: string) => c) : await ui.input(`${prompt}(${options[0]}/${options[1]})`)).toLowerCase();
        yes = res == opts[0]
        if (!yes)
            no = res == opts[1];
    } while (!(yes || no));

    return yes;
}

export const promptAddress = async (prompt: string, provider: UIProvider, fallback?: Address) => {
    let promptFinal = fallback ? prompt.replace(/:$/, '') + `(default:${fallback}):` : prompt;
    do {
        let testAddr = (await provider.input(promptFinal)).replace(/^\s+|\s+$/g, '');
        try {
            return testAddr == "" && fallback ? fallback : Address.parse(testAddr);
        } catch (e) {
            provider.write(testAddr + " is not valid!\n");
            prompt = "Please try again:";
        }
    } while (true);

};

export const promptToncoin = async (prompt: string, provider: UIProvider) => {
    return promptAmount(prompt, 9, provider);
}

export const promptAmount = async (prompt: string, decimals: number, provider: UIProvider) => {
    let resAmount: bigint;
    do {
        const inputAmount = await provider.input(prompt);
        try {
            resAmount = toUnits(inputAmount, decimals);

            if (resAmount <= 0) {
                throw new Error("Please enter positive number");
            }

            return resAmount;
        } catch (e: any) {
            provider.write(e.message);
        }
    } while (true);
}

export const getLastBlock = async (provider: NetworkProvider) => {
    return (await (provider.api() as TonClient4).getLastBlock()).last.seqno;
}
export const getAccountLastTx = async (provider: NetworkProvider, address: Address) => {
    const res = await (provider.api() as TonClient4).getAccountLite(await getLastBlock(provider), address);
    if (res.account.last == null)
        throw (Error("Contract is not active"));
    return res.account.last.lt;
}
export const waitForTransaction = async (provider: NetworkProvider, address: Address, curTx: string | null, maxRetry: number, interval: number = 1000) => {
    let done = false;
    let count = 0;
    const ui = provider.ui();

    do {
        const lastBlock = await getLastBlock(provider);
        ui.write(`Awaiting transaction completion (${++count}/${maxRetry})`);
        await sleep(interval);
        const curState = await (provider.api() as TonClient4).getAccountLite(lastBlock, address);
        if (curState.account.last !== null) {
            done = curState.account.last.lt !== curTx;
        }
    } while (!done && count < maxRetry);
    return done;
}

const keysToHashMap = async (keys: string[]) => {
    let keyMap: { [key: string]: bigint } = {};
    for (let i = 0; i < keys.length; i++) {
        keyMap[keys[i]] = BigInt("0x" + (await sha256(keys[i])).toString('hex'));
    }
}

const contentValue: DictionaryValue<string> = {
    serialize: (src: string, builder: Builder) => {
        builder.storeRef(beginCell().storeUint(0, 8).storeStringTail(src).endCell());
    },
    parse: (src: Slice) => {
        const sc = src.loadRef().beginParse();
        const prefix = sc.loadUint(8);
        if (prefix == 0) {
            return sc.loadStringTail();
        } else if (prefix == 1) {
            // Not really tested, but feels like it should work
            const chunkDict = Dictionary.loadDirect(Dictionary.Keys.Uint(32), Dictionary.Values.Cell(), sc);
            return chunkDict.values().map(x => x.beginParse().loadStringTail()).join('');
        } else {
            throw (Error(`Prefix ${prefix} is not supported yet`));
        }
    }
};

export const parseContentCell = async (content: Cell) => {
    const cs = content.beginParse();
    const contentType = cs.loadUint(8);
    if (contentType == 1) {
        const noData = cs.remainingBits == 0;
        if (noData && cs.remainingRefs == 0) {
            throw new Error("No data in content cell!");
        } else {
            const contentUrl = noData ? cs.loadStringRefTail() : cs.loadStringTail();
            return contentUrl;
        }
    } else if (contentType == 0) {
        let contentKeys: string[];
        const contentDict = Dictionary.load(Dictionary.Keys.BigUint(256), contentValue, cs);
        const contentMap: { [key: string]: string } = {};

        for (const name of defaultJettonKeys) {
            // I know we should pre-compute hashed keys for known values... just not today.
            const dictKey = BigInt("0x" + (await sha256(name)).toString('hex'))
            const dictValue = contentDict.get(dictKey);
            if (dictValue !== undefined) {
                contentMap[name] = dictValue;
            }
        }
        return contentMap;
    } else {
        throw new Error(`Unknown content format indicator:${contentType}\n`);
    }
}

export const displayContentCell = async (contentCell: Cell, ui: UIProvider, jetton: boolean = true, additional?: string[]) => {
    const content = await parseContentCell(contentCell);

    if (content instanceof String) {
        ui.write(`Content metadata url:${content}\n`);
    } else {
        ui.write(`Content:${JSON.stringify(content, null, 2)}`);
    }
}

export const promptUrl = async (prompt: string, ui: UIProvider) => {
    let retry = false;
    let input = "";
    let res = "";

    do {
        input = await ui.input(prompt);
        try {
            let testUrl = new URL(input);
            res = testUrl.toString();
            retry = false;
        } catch (e) {
            ui.write(input + " doesn't look like a valid url:\n" + e);
            retry = !(await promptBool('Use anyway?(y/n)', ['y', 'n'], ui));
        }
    } while (retry);
    return input;
}

export const explorerUrl = (address: string, isTestnet: boolean) => {
    return (isTestnet ? 'https://testnet.tonscan.org/address/' : 'https://tonscan.org/address/') + address;
}

export const promptUserFriendlyAddress = async (prompt: string, provider: UIProvider, isTestnet: boolean) => {
    do {
        const s = await provider.input(prompt);
        if (Address.isFriendly(s)) {
            const address = Address.parseFriendly(s);
            if (address.isTestOnly && !isTestnet) {
                provider.write("Please enter mainnet address");
                prompt = "Please try again:";
            } else {
                return address;
            }
        } else {
            provider.write(s + " is not valid!\n");
            prompt = "Please try again:";
        }
    } while (true);
}

export const lockTypeToName = (lockType: LockType): string => {
    switch (lockType) {
        case 'unlock':
            return "Unlocked";
        case 'out':
            return "Can't send";
        case 'in':
            return "Can't receive";
        case 'full':
            return "Can't send and receive";
        default:
            throw new Error("Invalid argument!");
    }
}

export const promptLockType = async (prompt: string, provider: UIProvider): Promise<LockType> => {
    do {
        const s = await provider.input(prompt);
        if (LOCK_TYPES.indexOf(s) === -1) {
            provider.write(s + " is not valid!\n");
        } else {
            return s as LockType;
        }
    } while (true);
}

export const addressToString = (address: {
    isBounceable: boolean,
    isTestOnly: boolean,
    address: Address
}) => {
    return address.address.toString({
        bounceable: address.isBounceable,
        testOnly: address.isTestOnly
    })
}

export const base64toCell = (base64: string) => {
    const bytes = base64Decode(base64);
    const buffer = Buffer.from(bytes);
    return Cell.fromBoc(buffer)[0];
}

export const equalsMsgAddresses = (a: Address | null, b: Address | null) => {
    if (!a) return !b;
    if (!b) return !a;
    return a.equals(b);
}

export const sendToIndex = async (method: string, params: any, provider: NetworkProvider) => {
    const isTestnet = provider.network() !== 'mainnet';
    const mainnetRpc = 'https://toncenter.com/api/v3/';
    const testnetRpc = 'https://testnet.toncenter.com/api/v3/';
    const rpc = isTestnet ? testnetRpc : mainnetRpc;

    const apiKey = (provider.api() as any).api.parameters.apiKey!; // todo: provider.api().parameters.apiKey is undefined

    const headers = {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey
    };

    const response = await fetch(rpc + method + '?' + new URLSearchParams(params), {
        method: 'GET',
        headers: headers,
    });
    return response.json();
}

export const getAddressFormat = async (address: Address, provider: NetworkProvider, isTestnet: boolean) => {
    const result = await sendToIndex('wallet', {address: address}, provider);

    const nonBounceable = (result.status === "uninit") || (result.wallet_type && result.wallet_type.startsWith('wallet'));

    return {
        isBounceable: !nonBounceable,
        isTestOnly: isTestnet,
        address
    }
}

export const formatAddressAndUrl = async (address: Address, provider: NetworkProvider, isTestnet: boolean) => {
    const f = await getAddressFormat(address, provider, isTestnet);
    const addressString = addressToString(f);
    return addressString + ' ' + explorerUrl(addressString, isTestnet);
}

export const jettonWalletCodeFromLibrary = (jettonWalletCodeRaw: Cell) => {
    // https://docs.ton.org/tvm.pdf, page 30
    // Library reference cell — Always has level 0, and contains 8+256 data bits, including its 8-bit type integer 2
    // and the representation hash Hash(c) of the library cell being referred to. When loaded, a library
    // reference cell may be transparently replaced by the cell it refers to, if found in the current library context.

    const libraryReferenceCell = beginCell().storeUint(2, 8).storeBuffer(jettonWalletCodeRaw.hash()).endCell();

    return new Cell({exotic: true, bits: libraryReferenceCell.bits, refs: libraryReferenceCell.refs});
}

export const assert = (condition: boolean, error: string, ui: UIProvider) => {
    if (!condition) {
        ui.write(error);
        throw new Error();
    }
}